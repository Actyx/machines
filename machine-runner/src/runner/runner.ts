import {
  Actyx,
  CancelSubscription,
  EventKey,
  EventsOrTimetravel,
  Metadata,
  MsgType,
  OnCompleteOrErr,
  Tags,
} from '@actyx/sdk'
import EventEmitter from 'events'
import {
  MachineEvent,
  StateRaw,
  StateFactory,
  CommandDefinerMap,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
} from '../design/state.js'
import { Destruction } from '../utils/destruction.js'
import { NOP } from '../utils/index.js'
import {
  CommandFiredAfterLocked,
  CommandIssuanceStatus,
  RunnerInternals,
  StateAndFactory,
  UnknownEventID,
} from './runner-internals.js'
import { MachineEmitter, MachineEmitterEventMap } from './runner-utils.js'

export type MachineRunner = {
  id: symbol
  events: MachineEmitter
  destroy: () => unknown
  isDestroyed: () => boolean

  get: () => StateOpaque | null
  initial: () => StateOpaque

  noAutoDestroy: () => MachineRunnerIterableIterator
} & MachineRunnerIterableIterator

export namespace MachineRunner {
  type AllEventMap = MachineEmitterEventMap
  export type EventListener<Key extends keyof AllEventMap> = AllEventMap[Key]
}

export type SubscribeFn<RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple> =
  (
    callback: (
      data: EventsOrTimetravel<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>,
    ) => Promise<void>,
    onCompleteOrErr?: OnCompleteOrErr,
  ) => CancelSubscription

export type PersistFn<RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple> = (
  events: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>[],
) => Promise<Metadata[]>

export const createMachineRunner = <
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  Payload,
>(
  sdk: Actyx,
  tags: Tags<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>,
  initialFactory: StateFactory<any, RegisteredEventsFactoriesTuple, any, Payload, any>,
  initialPayload: Payload,
) => {
  const subscribeMonotonicQuery = {
    query: tags,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persist: PersistFn<RegisteredEventsFactoriesTuple> = (e) => sdk.publish(tags.apply(...e))

  const subscribe: SubscribeFn<RegisteredEventsFactoriesTuple> = (callback, onCompleteOrErr) =>
    sdk.subscribeMonotonic<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>(
      subscribeMonotonicQuery,
      callback,
      onCompleteOrErr,
    )

  return createMachineRunnerInternal(subscribe, persist, initialFactory, initialPayload)
}

export const createMachineRunnerInternal = <
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  Payload,
>(
  subscribe: SubscribeFn<RegisteredEventsFactoriesTuple>,
  persist: PersistFn<RegisteredEventsFactoriesTuple>,
  factory: StateFactory<any, RegisteredEventsFactoriesTuple, any, Payload, any>,
  payload: Payload,
): MachineRunner => {
  const internals = RunnerInternals.make(factory, payload, (events) => {
    if (internals.commandLock) {
      console.error('Command issued after locked')
      return Promise.resolve(CommandFiredAfterLocked)
    }

    const newCommandIssuanceStatus: CommandIssuanceStatus = {
      issuedEventIds: events.map((_) => UnknownEventID),
      incomingEventIds: new Set(),
    }

    internals.commandLock = newCommandIssuanceStatus

    const isActual = newCommandIssuanceStatus === internals.commandLock

    const persistResult = persist(events)

    persistResult.then((metadata) => {
      if (!isActual) return
      newCommandIssuanceStatus.issuedEventIds = metadata.map((metadata) => metadata.eventId)
      emitter.emit('change', StateOpaque.make(internals, internals.current))
    })

    persistResult.catch((err) => {
      emitter.emit(
        'log',
        `error publishing ${err} ${events.map((e) => JSON.stringify(e)).join(', ')}`,
      )
      if (!isActual) return
      internals.commandLock = null
      emitter.emit('change', StateOpaque.make(internals, internals.current))
    })

    emitter.emit('change', StateOpaque.make(internals, internals.current))
    return persistResult
  })

  const destruction = Destruction.make()

  // Actyx Subscription management
  const emitter = new EventEmitter() as MachineEmitter
  destruction.addDestroyHook(() => emitter.emit('destroyed'))

  let refToUnsubFunction = null as null | (() => void)

  const unsubscribeFromActyx = () => {
    refToUnsubFunction?.()
    refToUnsubFunction = null
  }
  destruction.addDestroyHook(unsubscribeFromActyx)

  const restartActyxSubscription = () => {
    unsubscribeFromActyx()

    if (destruction.isDestroyed()) return

    refToUnsubFunction = subscribe(
      async (d) => {
        try {
          if (d.type === MsgType.timetravel) {
            emitter.emit('log', 'Time travel')
            RunnerInternals.reset(internals)
            emitter.emit('audit.reset')

            restartActyxSubscription()
          } else if (d.type === MsgType.events) {
            //

            internals.caughtUp = false

            for (const event of d.events) {
              // TODO: Runtime typeguard for event
              // https://github.com/Actyx/machines/issues/9
              emitter.emit('debug.eventHandlingPrevState', internals.current.data)

              internals.commandLock?.incomingEventIds.add(event.meta.eventId)

              const pushEventResult = RunnerInternals.pushEvent(internals, event)

              emitter.emit('debug.eventHandling', {
                event,
                handlingReport: pushEventResult,
                mechanism: internals.current.factory.mechanism,
                factory: internals.current.factory,
                nextState: internals.current.data,
              })

              // Effects of handlingReport on emitters
              ;(() => {
                if (pushEventResult.executionHappened) {
                  if (emitter.listenerCount('audit.state') > 0) {
                    emitter.emit('audit.state', {
                      state: StateOpaque.make(internals, internals.current),
                      events: pushEventResult.triggeringEvents,
                    })
                  }
                }

                if (!pushEventResult.executionHappened && pushEventResult.discardable) {
                  emitter.emit('audit.dropped', {
                    state: internals.current.data,
                    event: pushEventResult.discardable,
                  })
                }
              })()
            }

            if (d.caughtUp) {
              // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
              internals.caughtUp = true
              internals.caughtUpFirstTime = true
              emitter.emit('log', 'Caught up')
              emitter.emit('change', StateOpaque.make(internals, internals.current))
            }
          }
        } catch (error) {
          console.error(error)
        }
      },
      (err) => {
        RunnerInternals.reset(internals)
        emitter.emit('audit.reset')
        emitter.emit('change', StateOpaque.make(internals, internals.current))

        emitter.emit('log', 'Restarting in 1sec due to error')
        unsubscribeFromActyx()
        setTimeout(() => restartActyxSubscription, 10000)
      },
    )
  }

  // First run of the subscription
  restartActyxSubscription()

  // AsyncIterator part
  // ==================

  // Self API construction

  const getSnapshot = (): StateOpaque | null => {
    console.log('internals.caughtUpFirstTime', internals.caughtUpFirstTime)
    return internals.caughtUpFirstTime ? StateOpaque.make(internals, internals.current) : null
  }

  const api = {
    id: Symbol(),
    events: emitter,
    get: getSnapshot,
    initial: (): StateOpaque => StateOpaque.make(internals, internals.initial),
    destroy: destruction.destroy,
    isDestroyed: destruction.isDestroyed,
    noAutoDestroy: () =>
      MachineRunnerIterableIterator.make({
        events: emitter,
      }),
  }

  const defaultIterator: MachineRunnerIterableIterator = MachineRunnerIterableIterator.make({
    events: emitter,
    inheritedDestruction: destruction,
  })

  const self: MachineRunner = {
    ...api,
    ...defaultIterator,
  }

  return self
}

export type MachineRunnerIterableIterator = AsyncIterable<StateOpaque> &
  AsyncIterableIterator<StateOpaque> &
  AsyncIterator<StateOpaque, null> & {
    peek: () => Promise<IteratorResult<StateOpaque, null>>
  }

namespace MachineRunnerIterableIterator {
  export const make = ({
    events,
    inheritedDestruction: inheritedDestruction,
  }: {
    events: MachineEmitter
    inheritedDestruction?: Destruction
  }): MachineRunnerIterableIterator => {
    const destruction =
      inheritedDestruction ||
      (() => {
        const destruction = Destruction.make()

        // Destruction iis
        const onDestroy = () => {
          destruction.destroy()
          events.off('destroyed', onDestroy)
        }
        events.on('destroyed', onDestroy)

        return destruction
      })()

    const nextValueAwaiter = NextValueAwaiter.make({
      events,
      destruction,
    })

    const onThrowOrReturn = async (): Promise<IteratorResult<StateOpaque, null>> => {
      destruction.destroy()
      return nextValueAwaiter.consume()
    }

    const iterator: MachineRunnerIterableIterator = {
      peek: (): Promise<IteratorResult<StateOpaque>> => nextValueAwaiter.peek(),
      next: (): Promise<IteratorResult<StateOpaque>> => nextValueAwaiter.consume(),
      return: onThrowOrReturn,
      throw: onThrowOrReturn,
      [Symbol.asyncIterator]: (): AsyncIterableIterator<StateOpaque> => iterator,
    }

    return iterator
  }
}

/**
 * Object to help "awaiting" next value
 */
export type NextValueAwaiter = ReturnType<typeof NextValueAwaiter['make']>

namespace NextValueAwaiter {
  export const make = ({
    events,
    destruction,
  }: {
    events: MachineEmitter
    destruction: Destruction
  }) => {
    let store: null | StateOpaque | RequestedPromisePair = null

    const onChange: MachineEmitterEventMap['change'] = (state) => {
      if (destruction.isDestroyed()) return

      if (Array.isArray(store)) {
        store[1](intoIteratorResult(state))
        store = null
      } else {
        store = state
      }
    }

    events.on('change', onChange)

    destruction.addDestroyHook(() => {
      events.off('change', onChange)
      if (Array.isArray(store)) {
        store[1](Done)
        store = null
      }
    })

    return {
      consume: (): Promise<IteratorResult<StateOpaque, null>> => {
        if (destruction.isDestroyed()) return Promise.resolve(Done)

        if (store && !Array.isArray(store)) {
          const retVal = Promise.resolve(intoIteratorResult(store))
          store = null
          return retVal
        } else {
          const promisePair = store || createPromisePair()
          store = promisePair
          return promisePair[0]
        }
      },

      peek: (): Promise<IteratorResult<StateOpaque, null>> => {
        if (destruction.isDestroyed()) return Promise.resolve(Done)

        if (store && !Array.isArray(store)) {
          const retVal = Promise.resolve(intoIteratorResult(store))
          return retVal
        } else {
          const promisePair = store || createPromisePair()
          store = promisePair
          return promisePair[0]
        }
      },
    }
  }

  type RequestedPromisePair = [
    Promise<IteratorResult<StateOpaque, null>>,
    (_: IteratorResult<StateOpaque, null>) => unknown,
  ]

  const createPromisePair = (): RequestedPromisePair => {
    const pair: RequestedPromisePair = [undefined as any, NOP]
    pair[0] = new Promise<IteratorResult<StateOpaque, null>>((resolve) => (pair[1] = resolve))
    return pair
  }

  const intoIteratorResult = (value: StateOpaque): IteratorResult<StateOpaque, null> => ({
    done: false,
    value,
  })

  export const Done: IteratorResult<StateOpaque, null> = { done: true, value: null }
}

export interface StateOpaque<
  StateName extends string = string,
  Payload = unknown,
  Commands extends CommandDefinerMap<object, any, MachineEvent.Any[]> = object,
> extends StateRaw<StateName, Payload> {
  is<
    DeductStateName extends string,
    DeductPayload,
    DeductCommands extends CommandDefinerMap<object, any, MachineEvent.Any[]> = object,
  >(
    factory: StateFactory<any, any, DeductStateName, DeductPayload, DeductCommands>,
  ): this is StateOpaque<DeductStateName, DeductPayload, DeductCommands>

  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
  ): State<StateName, StatePayload, Commands> | undefined

  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    Then extends (arg: State<StateName, StatePayload, Commands>) => any,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
    then: Then,
  ): ReturnType<Then> | undefined

  cast(): State<StateName, Payload, Commands>
}

export namespace StateOpaque {
  export const isExpired = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ) =>
    stateAndFactoryForSnapshot.factory !== internals.current.factory ||
    stateAndFactoryForSnapshot.data !== internals.current.data

  export const isCommandLocked = (internals: RunnerInternals.Any): boolean =>
    !!internals.commandLock

  export const make = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ): StateOpaque => {
    // Captured data at snapshot call-time
    const commandLockAtSnapshot = internals.commandLock
    const stateAtSnapshot = stateAndFactoryForSnapshot.data
    const factoryAtSnapshot = stateAndFactoryForSnapshot.factory as StateFactory.Any
    const caughtUpAtSnapshot = internals.caughtUp
    const caughtUpFirstTimeAtSnapshot = internals.caughtUpFirstTime
    const queueLengthAtSnapshot = internals.queue.length
    const commandEnabledAtSnapshot =
      !commandLockAtSnapshot &&
      caughtUpAtSnapshot &&
      caughtUpFirstTimeAtSnapshot &&
      queueLengthAtSnapshot === 0

    // TODO: write unit test on expiry
    const isExpired = () => StateOpaque.isExpired(internals, stateAndFactoryForSnapshot)

    const is: StateOpaque['is'] = (factory) => factoryAtSnapshot.mechanism === factory.mechanism

    const as: StateOpaque['as'] = <
      StateName extends string,
      StatePayload,
      Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    >(
      factory: StateFactory<any, any, StateName, StatePayload, Commands>,
      then?: any,
    ) => {
      if (factoryAtSnapshot.mechanism === factory.mechanism) {
        const mechanism = factory.mechanism

        const commands = commandEnabledAtSnapshot
          ? convertCommandMapToCommandSignatureMap<any, unknown, MachineEvent.Any[]>(
              mechanism.commands,
              {
                isExpired,
                getActualContext: () => ({
                  self: stateAndFactoryForSnapshot.data.payload,
                }),
                onReturn: (events) => internals.commandEmitFn(events),
              },
            )
          : undefined

        const snapshot = {
          payload: stateAtSnapshot.payload,
          type: stateAtSnapshot.type,
          commands,
        }
        return then ? then(snapshot) : snapshot
      }
      return undefined
    }

    const cast: StateOpaque['cast'] = () => {
      const mechanism = factoryAtSnapshot.mechanism
      const commands = commandEnabledAtSnapshot
        ? convertCommandMapToCommandSignatureMap<any, unknown, MachineEvent.Any[]>(
            mechanism.commands,
            {
              isExpired,
              getActualContext: () => ({
                self: stateAndFactoryForSnapshot.data.payload,
              }),
              onReturn: (events) => internals.commandEmitFn(events),
            },
          )
        : undefined

      const snapshot = {
        payload: stateAtSnapshot.payload,
        type: stateAtSnapshot.type,
        commands,
      }
      return snapshot
    }

    return {
      is,
      as,
      cast,
      payload: stateAtSnapshot.payload,
      type: stateAtSnapshot.type,
    }
  }
}

export type State<
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
> = StateRaw<StateName, StatePayload> & {
  commands?: ToCommandSignatureMap<Commands, any, MachineEvent.Any[]>
}

export namespace State {
  export type Minim = State<string, any, CommandDefinerMap<any, any, MachineEvent.Any>>

  export type NameOf<T extends State.Minim> = T extends State<infer Name, any, any> ? Name : never

  export type Of<T extends StateFactory.Any> = T extends StateFactory<
    any,
    any,
    infer StateName,
    infer StatePayload,
    infer Commands
  >
    ? State<StateName, StatePayload, Commands>
    : never
}
