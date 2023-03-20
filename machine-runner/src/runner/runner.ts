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
  Event,
  StateRaw,
  StateFactory,
  CommandDefinerMap,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
} from '../design/state.js'
import { Destruction } from '../utils/destruction.js'
import { ReactionHandling, RunnerInternals, StateAndFactory } from './runner-internals.js'
import { MachineEmitter, MachineRunnerEventMap } from './runner-utils.js'

export type MachineRunner = {
  id: Symbol
  events: MachineEmitter
  destroy: () => unknown
  isDestroyed: () => boolean

  get: () => StateOpaque
  initial: () => StateOpaque
} & AsyncIterable<StateOpaque> &
  AsyncIterator<StateOpaque, unknown>

export namespace MachineRunner {
  type AllEventMap = MachineRunnerEventMap
  export type EventListener<Key extends keyof AllEventMap> = AllEventMap[Key]
}

export type SubscribeFn<E> = (
  callback: (data: EventsOrTimetravel<E>) => Promise<void>,
  onCompleteOrErr?: OnCompleteOrErr,
) => CancelSubscription

export type PersistFn = (e: any[]) => Promise<void | Metadata[]>

export const createMachineRunner = <Payload>(
  sdk: Actyx,
  tags: Tags<any>,
  initialFactory: StateFactory<any, any, any, Payload, any>,
  initialPayload: Payload,
) => {
  const subscribeMonotonicQuery = {
    query: tags,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persist = (e: any[]) =>
    sdk.publish(tags.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

  const subscribe: SubscribeFn<Event.Any> = (callback, onCompleteOrErr) =>
    sdk.subscribeMonotonic<Event.Any>(subscribeMonotonicQuery, callback, onCompleteOrErr)

  return createMachineRunnerInternal(subscribe, persist, initialFactory, initialPayload)
}

export const createMachineRunnerInternal = <Payload>(
  subscribe: SubscribeFn<Event.Any>,
  persist: PersistFn,
  factory: StateFactory<any, any, any, Payload, any>,
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
            for (const event of d.events) {
              // TODO: Runtime typeguard for event
              // https://github.com/Actyx/machines/issues/9
              events.emit('debug.eventHandlingPrevState', internals.current.data)

              const handlingReport = RunnerInternals.pushEvent(internals, event)

              events.emit('debug.eventHandling', {
                event,
                handlingReport,
                mechanism: internals.current.factory.mechanism,
                factory: internals.current.factory,
                nextState: internals.current.data,
              })

              // Effects of handlingReport on emitters
              ;(() => {
                switch (handlingReport.handling) {
                  case ReactionHandling.Execute:
                    return events.emit('audit.state', {
                      state: internals.current.data,
                      events: handlingReport.queueSnapshotBeforeExecution,
                    })
                  case ReactionHandling.Discard:
                    return handlingReport.orphans.forEach((event) => {
                      events.emit('audit.dropped', {
                        state: internals.current.data,
                        event: event,
                      })
                    })
                  case ReactionHandling.DiscardLast:
                    return events.emit('audit.dropped', {
                      state: internals.current.data,
                      event: handlingReport.orphan,
                    })
                }
              })()
            }

            if (d.caughtUp) {
              // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
              events.emit('debug.caughtUp')
              events.emit('log', 'Caught up')
              events.emit('change')
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

  const nextValueAwaiter = NextValueAwaiter.make({
    events,
    internals,
    destruction,
  })

  // Self API construction

  const onThrowOrReturn = async (): Promise<IteratorResult<StateOpaque, null>> => {
    destruction.destroy()
    return { done: true, value: null }
  }

  const api = {
    id: Symbol(),
    events,
    get: (): StateOpaque => StateOpaque.make(internals, internals.current),
    initial: (): StateOpaque => StateOpaque.make(internals, internals.initial),
    destroy: destruction.destroy,
    isDestroyed: destruction.isDestroyed,
  }

  const iterator: AsyncIterableIterator<StateOpaque> = {
    next: (): Promise<IteratorResult<StateOpaque>> => nextValueAwaiter.consume(),
    return: onThrowOrReturn,
    throw: onThrowOrReturn,
    [Symbol.asyncIterator]: (): AsyncIterableIterator<StateOpaque> => iterator,
  }

  const self: AsyncIterableIterator<StateOpaque> & typeof api = {
    ...api,
    ...iterator,
  }

  return self
}

/**
 * Object to help "awaiting" next value
 */
export type NextValueAwaiter = ReturnType<typeof NextValueAwaiter['make']>

namespace NextValueAwaiter {
  export const make = ({
    events,
    internals,
    destruction,
  }: {
    events: MachineEmitter
    internals: RunnerInternals.Any
    destruction: Destruction
  }) => {
    let nextValue: null | StateOpaque = null
    const requestedResolveFns = new Set<(_: IteratorResult<StateOpaque, null>) => unknown>()

    events.on('change', () => {
      const newStateOpaque = StateOpaque.make(internals, internals.current)
      if (requestedResolveFns.size > 0) {
        Array.from(requestedResolveFns).forEach((resolve) =>
          resolve(intoIteratorResult(newStateOpaque)),
        )
        requestedResolveFns.clear()
        // If there is at least one `next` call
        // The next `change` event will be emitted and the next value
        // will be set as null
        nextValue = null
      } else {
        nextValue = newStateOpaque
      }
    })

    events.on('destroyed', () =>
      Array.from(requestedResolveFns).forEach((resolve) => resolve(intoIteratorResult(null))),
    )

    const intoIteratorResult = (value: StateOpaque | null): IteratorResult<StateOpaque, null> => {
      if (value === null) {
        return { done: true, value }
      } else {
        return { done: false, value }
      }
    }

    const waitForNextValue = (): Promise<IteratorResult<StateOpaque, null>> =>
      new Promise<IteratorResult<StateOpaque, null>>((resolve) => requestedResolveFns.add(resolve))

    return {
      consume: (): Promise<IteratorResult<StateOpaque, null>> => {
        if (destruction.isDestroyed()) {
          return Promise.resolve(intoIteratorResult(null))
        }

        const returned =
          (nextValue && Promise.resolve(intoIteratorResult(nextValue))) || waitForNextValue()

        // nextValue is set as null whenever there is a `next` call from the outside
        nextValue = null

        return returned
      },
    }
  }
}

export interface StateOpaque<StateName extends string = string, Payload = unknown>
  extends StateRaw<StateName, Payload> {
  is<Name extends string, Payload>(
    factory: StateFactory<any, any, Name, Payload, any>,
  ): this is StateOpaque<Name, Payload>

  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
  ): State<StateName, StatePayload, Commands> | undefined

  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
    Then extends (arg: State<StateName, StatePayload, Commands>) => any,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
    then: Then,
  ): ReturnType<Then> | undefined

  cast<Commands extends CommandDefinerMap<any, any, Event.Any[]>>(
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
    // Capture state and factory at snapshot call-time
    const stateAtSnapshot = stateAndFactoryForSnapshot.data
    const factoryAtSnapshot = stateAndFactoryForSnapshot.factory as StateFactory.Any

    // TODO: write unit test on expiry
    const isExpired = () => StateOpaque.isExpired(internals, stateAndFactoryForSnapshot)

    const is: StateOpaque['is'] = (factory) => factoryAtSnapshot.mechanism === factory.mechanism

    const as: StateOpaque['as'] = <
      StateName extends string,
      StatePayload,
      Commands extends CommandDefinerMap<any, any, Event.Any[]>,
    >(
      factory: StateFactory<any, any, StateName, StatePayload, Commands>,
      then?: any,
    ) => {
      if (factoryAtSnapshot.mechanism === factory.mechanism) {
        const mechanism = factory.mechanism
        const snapshot = {
          payload: stateAtSnapshot.payload,
          type: stateAtSnapshot.type,
          commands: convertCommandMapToCommandSignatureMap<any, unknown, Event.Any[]>(
            mechanism.commands,
            {
              isExpired,
              getActualContext: () => ({
                self: stateAndFactoryForSnapshot.data.payload,
              }),
              onReturn: (events) => internals.commandEmitFn?.(events),
            },
          ),
        }
        return then ? then(snapshot) : snapshot
      }
      return undefined
    }

    const cast: StateOpaque['cast'] = (factory) => ({
      payload: stateAtSnapshot.payload,
      type: stateAtSnapshot.type,
      commands: convertCommandMapToCommandSignatureMap<any, unknown, Event.Any[]>(
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
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = StateRaw<StateName, StatePayload> & {
  commands: ToCommandSignatureMap<Commands, any, Event.Any[]>
}

export namespace State {
  export type Minim = State<string, any, CommandDefinerMap<any, any, Event.Any>>

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
