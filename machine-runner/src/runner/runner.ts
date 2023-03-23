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
import { RunnerInternals, StateAndFactory } from './runner-internals.js'
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
) => Promise<void | Metadata[]>

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

  const persist: PersistFn<RegisteredEventsFactoriesTuple> = (e) =>
    sdk.publish(tags.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

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
  const internals = RunnerInternals.make(factory, payload, persist)
  const destruction = Destruction.make()

  // Actyx Subscription management
  const events = new EventEmitter() as MachineEmitter
  destruction.addDestroyHook(() => events.emit('destroyed'))

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
            events.emit('log', 'Time travel')
            RunnerInternals.reset(internals)
            events.emit('audit.reset')

            restartActyxSubscription()
          } else if (d.type === MsgType.events) {
            //

            internals.caughtUp = false

            for (const event of d.events) {
              // TODO: Runtime typeguard for event
              // https://github.com/Actyx/machines/issues/9
              events.emit('debug.eventHandlingPrevState', internals.current.data)

              const pushEventResult = RunnerInternals.pushEvent(internals, event)

              events.emit('debug.eventHandling', {
                event,
                handlingReport: pushEventResult,
                mechanism: internals.current.factory.mechanism,
                factory: internals.current.factory,
                nextState: internals.current.data,
              })

              // Effects of handlingReport on emitters
              ;(() => {
                if (pushEventResult.executionHappened) {
                  if (events.listenerCount('audit.state') > 0) {
                    events.emit('audit.state', {
                      state: StateOpaque.make(internals, internals.current),
                      events: pushEventResult.triggeringEvents,
                    })
                  }
                }

                if (!pushEventResult.executionHappened && pushEventResult.discardable) {
                  events.emit('audit.dropped', {
                    state: internals.current.data,
                    event: pushEventResult.discardable,
                  })
                }
              })()
            }

            if (d.caughtUp) {
              // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
              events.emit('log', 'Caught up')
              events.emit('change', StateOpaque.make(internals, internals.current))
              internals.caughtUp = true
              internals.caughtUpFirstTime = true
            }
          }
        } catch (error) {
          console.error(error)
        }
      },
      (err) => {
        events.emit('log', 'Restarting in 1sec due to error')
        RunnerInternals.reset(internals)
        events.emit('audit.reset')

        unsubscribeFromActyx()
        setTimeout(() => restartActyxSubscription, 1000)
      },
    )
  }

  // First run of the subscription
  restartActyxSubscription()

  // AsyncIterator part
  // ==================

  // Self API construction

  const getSnapshot = (): StateOpaque | null =>
    internals.caughtUpFirstTime ? StateOpaque.make(internals, internals.current) : null

  const api = {
    id: Symbol(),
    events,
    get: getSnapshot,
    initial: (): StateOpaque => StateOpaque.make(internals, internals.initial),
    destroy: destruction.destroy,
    isDestroyed: destruction.isDestroyed,
    noAutoDestroy: () =>
      MachineRunnerIterableIterator.make({
        events,
      }),
  }

  const defaultIterator: MachineRunnerIterableIterator = MachineRunnerIterableIterator.make({
    events,
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

export interface StateOpaque<StateName extends string = string, Payload = unknown>
  extends StateRaw<StateName, Payload> {
  is<Name extends string, Payload>(
    factory: StateFactory<any, any, Name, Payload, any>,
  ): this is StateOpaque<Name, Payload>

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

  cast<Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>>(
    factory: StateFactory<any, any, StateName, Payload, Commands>,
  ): State<StateName, Payload, Commands>
}

export namespace StateOpaque {
  export const isExpired = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ) =>
    stateAndFactoryForSnapshot.factory !== internals.current.factory ||
    stateAndFactoryForSnapshot.data !== internals.current.data

  export const make = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ): StateOpaque => {
    // Captured data at snapshot call-time
    const stateAtSnapshot = stateAndFactoryForSnapshot.data
    const factoryAtSnapshot = stateAndFactoryForSnapshot.factory as StateFactory.Any
    const caughtUpAtSnapshot = internals.caughtUp
    const caughtUpFirstTimeAtSnapshot = internals.caughtUpFirstTime
    const queueLengthAtSnapshot = internals.queue.length
    const commandEnabledAtSnapshot =
      caughtUpAtSnapshot && caughtUpFirstTimeAtSnapshot && queueLengthAtSnapshot === 0

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
                onReturn: (events) => internals.commandEmitFn?.(events),
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

    const cast: StateOpaque['cast'] = (factory) => ({
      payload: stateAtSnapshot.payload,
      type: stateAtSnapshot.type,
      commands: convertCommandMapToCommandSignatureMap<any, unknown, MachineEvent.Any[]>(
        factory.mechanism.commands,
        {
          isExpired,
          getActualContext: () => ({
            self: stateAndFactoryForSnapshot.data.payload,
          }),
          onReturn: (events) => internals.commandEmitFn?.(events),
        },
      ),
    })

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
