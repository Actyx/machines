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
import {
  Event,
  StateRaw,
  StateFactory,
  CommandDefinerMap,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
} from '../design/state.js'
import { Agent } from '../utils/agent.js'
import { NOP } from '../utils/index.js'
import { ReactionHandling, RunnerInternals } from './runner-internals.js'
import { MachineRunnerEventMap } from './runner-utils.js'

export type MachineRunner = ReturnType<typeof createMachineRunnerInternal>

export namespace MachineRunner {
  type AllEventMap = MachineRunnerEventMap & Agent.DefaultEventMap
  export type EventListener<Key extends keyof AllEventMap> = AllEventMap[Key]
}

export type SubscribeFn<E> = (
  callback: (data: EventsOrTimetravel<E>) => Promise<void>,
  onCompleteOrErr?: OnCompleteOrErr,
) => CancelSubscription

export type PersistFn = (e: any[]) => Promise<void | Metadata[]>

export const createMachineRunner = <Payload>(
  sdk: Actyx,
  query: Tags<any>,
  factory: StateFactory<any, any, any, Payload, any>,
  payload: Payload,
) => {
  const subscribeMonotonicQuery = {
    query,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persist = (e: any[]) =>
    sdk.publish(query.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

  const subscribe: SubscribeFn<Event.Any> = (callback, onCompleteOrErr) =>
    sdk.subscribeMonotonic<Event.Any>(subscribeMonotonicQuery, callback, onCompleteOrErr)

  return createMachineRunnerInternal(subscribe, persist, factory, payload)
}

export const createMachineRunnerInternal = <Payload>(
  subscribe: SubscribeFn<Event.Any>,
  persist: PersistFn,
  factory: StateFactory<any, any, any, Payload, any>,
  payload: Payload,
) => {
  const internals = RunnerInternals.make(factory, payload)

  return Agent.startBuild()
    .setChannels<MachineRunnerEventMap>()
    .setAPI((runnerAgent) => {
      // Actyx Subscription management
      const events = runnerAgent.events

      let refToUnsubFunction = null as null | (() => void)

      const unsubscribeFromActyx = () => {
        refToUnsubFunction?.()
        refToUnsubFunction = null
      }

      const restartActyxSubscription = () => {
        unsubscribeFromActyx()
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
                  events.emit('debug.eventHandlingPrevState', internals.current.data)

                  const handlingReport = RunnerInternals.pushEvent(internals, event)

                  events.emit('debug.eventHandling', {
                    event,
                    handlingReport,
                    mechanism: internals.current.factory.mechanism,
                    factory: internals.current.factory,
                    nextState: internals.current.data,
                  })

                  if (handlingReport.handling === ReactionHandling.Execute) {
                    events.emit('audit.state', {
                      state: internals.current.data,
                      events: handlingReport.queueSnapshotBeforeExecution,
                    })
                  }

                  if (handlingReport.handling === ReactionHandling.Discard) {
                    if (handlingReport.orphans.length > 0) {
                      events.emit('audit.dropped', {
                        state: internals.current.data,
                        events: handlingReport.orphans,
                      })
                    }
                  }

                  if (handlingReport.handling === ReactionHandling.DiscardLast) {
                    events.emit('audit.dropped', {
                      state: internals.current.data,
                      events: [handlingReport.orphan],
                    })
                  }
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

      // Bridge events from container
      // IMPORTANT: pipe the event via `commandEmitFn`
      internals.commandEmitFn = (events) => persist(events)

      // AsyncIterator part
      const nextValueAwaiter = Agent.startBuild()
        .setAPI((flaggerInternal) => {
          let nextValue: null | StateOpaque = null

          const onChange: MachineRunner.EventListener<'change'> = () => {
            nextValue = StateOpaque.make(internals)
          }
          events.addListener('change', onChange)

          const intoIteratorResult = (
            value: StateOpaque | null,
          ): IteratorResult<StateOpaque, null> => {
            if (value === null) {
              return { done: true, value }
            } else {
              return { done: false, value }
            }
          }

          const waitForNextValue = (): Promise<IteratorResult<StateOpaque, null>> => {
            let cancel = NOP
            const promise = new Promise<IteratorResult<StateOpaque, null>>((resolve) => {
              const onChange = () => resolve(intoIteratorResult(StateOpaque.make(internals)))
              const onDestroy = () => resolve(intoIteratorResult(null))

              events.addListener('change', onChange)
              events.addListener('destroyed', onDestroy)
              cancel = () => {
                events.off('change', onChange)
                events.off('destroyed', onDestroy)
              }
            })
            return promise.finally(() => cancel())
          }

          flaggerInternal.addDestroyHook(() => events.off('change', onChange))

          return {
            consume: (): Promise<IteratorResult<StateOpaque, null>> => {
              if (runnerAgent.isDestroyed()) {
                return Promise.resolve(intoIteratorResult(null))
              }

              const returned =
                (nextValue && Promise.resolve(intoIteratorResult(nextValue))) || waitForNextValue()
              nextValue = null

              return returned
            },
          }
        })
        .build()

      // IMPORTANT:
      // Register hook when machine is killed
      // Unsubscriptions are called
      runnerAgent.addDestroyHook(unsubscribeFromActyx)
      runnerAgent.addDestroyHook(nextValueAwaiter.destroy)

      // Self API construction

      const onThrowOrReturn = async (): Promise<IteratorResult<StateOpaque, null>> => {
        runnerAgent.destroy()
        return { done: true, value: null }
      }

      const api = {
        get: (): StateOpaque => StateOpaque.make(internals),
        initial: () => internals.initial.data,
      }

      const iterator: AsyncIterableIterator<StateOpaque> = {
        next: (): Promise<IteratorResult<StateOpaque, null>> => nextValueAwaiter.consume(),
        return: onThrowOrReturn,
        throw: onThrowOrReturn,
        [Symbol.asyncIterator]: () => iterator,
      }

      const self: AsyncIterableIterator<StateOpaque> & typeof api = {
        ...api,
        ...iterator,
      }

      return self
    })
    .build()
}

export interface StateOpaque<P = unknown> extends StateRaw<string, P> {
  is<Payload>(factory: StateFactory<any, any, any, Payload, any>): this is StateOpaque<Payload>
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
}

export namespace StateOpaque {
  export const make = (internals: RunnerInternals.Any) => {
    // Capture state and factory at snapshot call-time
    const stateAtSnapshot = internals.current.data
    const factoryAtSnapshot = internals.current.factory as StateFactory.Any
    const isExpired = () =>
      factoryAtSnapshot !== internals.current.factory || stateAtSnapshot !== internals.current.data

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
                self: internals.current.data.payload,
              }),
              onReturn: (events) => internals.commandEmitFn?.(events),
            },
          ),
        }
        return then ? then(snapshot) : snapshot
      }
      return undefined
    }

    return {
      is,
      as,
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
  commands: ToCommandSignatureMap<Commands, any, Event.Any>
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
