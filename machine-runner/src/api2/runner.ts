import { Actyx, ActyxEvent, EventKey, MsgType, Tags } from '@actyx/sdk'
import {
  Event,
  State,
  StateMechanism,
  StateFactory,
  CommandDefinerMap,
  Reaction,
  ReactionContext,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
  ReactionMapPerMechanism,
} from './state-machine.js'
import { Agent } from '../api2utils/agent.js'
import { Obs } from '../api2utils/obs.js'
import { deepCopy } from '../runner.js'

export type MachineRunner = ReturnType<typeof createMachineRunner>

export const createMachineRunner = <Payload>(
  sdk: Actyx,
  query: Tags<any>,
  factory: StateFactory<any, any, any, Payload, any>,
  payload: Payload,
) => {
  const container = StateContainer.make(factory, payload)

  const subscribeMonotonicQuery = {
    query,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persistEvents = (e: any[]) =>
    sdk.publish(query.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

  return Agent.startBuild()
    .setChannels((c) => ({
      ...c,
      ...createChannelsForMachineRunner(),
    }))
    .setAPI((machineInternal) => {
      // Actyx Subscription management

      let refToUnsubFunction = null as null | (() => void)

      const unsubscribeFromActyx = () => {
        refToUnsubFunction?.()
        refToUnsubFunction = null
      }

      const restartActyxSubscription = () => {
        unsubscribeFromActyx()
        refToUnsubFunction = sdk.subscribeMonotonic<Event.Any>(
          subscribeMonotonicQuery,
          (d) => {
            try {
              if (d.type === MsgType.timetravel) {
                machineInternal.channels.log.emit('Time travel')

                container.reset()
                machineInternal.channels.audit.reset.emit()

                restartActyxSubscription()
              } else if (d.type === MsgType.events) {
                for (const event of d.events) {
                  // TODO: Runtime typeguard for event
                  machineInternal.channels.debug.eventHandlingPrevState.emit(container.get())

                  const handlingReport = container.pushEvent(event)

                  machineInternal.channels.debug.eventHandling.emit({
                    event,
                    handlingReport,
                    mechanism: container.factory().mechanism(),
                    factory: container.factory(),
                    nextState: container.get(),
                  })

                  if (handlingReport.handling === StateContainerCommon.ReactionHandling.Execute) {
                    machineInternal.channels.audit.state.emit({
                      state: container.get(),
                      events: handlingReport.queueSnapshotBeforeExecution,
                    })
                  }

                  if (handlingReport.handling === StateContainerCommon.ReactionHandling.Discard) {
                    if (handlingReport.orphans.length > 0) {
                      machineInternal.channels.audit.dropped.emit({
                        state: container.get(),
                        events: handlingReport.orphans,
                      })
                    }
                  }

                  if (
                    handlingReport.handling === StateContainerCommon.ReactionHandling.DiscardLast
                  ) {
                    machineInternal.channels.audit.dropped.emit({
                      state: container.get(),
                      events: [handlingReport.orphan],
                    })
                  }
                }

                if (d.caughtUp) {
                  // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
                  machineInternal.channels.debug.caughtUp.emit()
                  machineInternal.channels.log.emit('Caught up')
                  machineInternal.channels.change.emit()
                }
              }
            } catch (error) {
              console.error(error)
            }
          },
          (err) => {
            machineInternal.channels.log.emit('Restarting in 1sec due to error')

            container.reset()
            machineInternal.channels.audit.reset.emit()

            unsubscribeFromActyx()
            setTimeout(() => restartActyxSubscription, 1000)
          },
        )
      }

      // First run of the subscription
      restartActyxSubscription()

      // Bridge events from container
      const eventBridge = container.commandObs()
      const unsubscribeEventBridge = eventBridge.sub((events) => persistEvents(events))

      // AsyncIterator part
      const nextValueAwaiter = Agent.startBuild()
        .setAPI((flaggerInternal) => {
          let nextValue: null | StateSnapshotOpaque = null
          const subscription = machineInternal.channels.change.sub(() => {
            nextValue = container.snapshot()
          })

          const intoIteratorResult = (
            value: StateSnapshotOpaque | null,
          ): IteratorResult<StateSnapshotOpaque, null> => {
            if (value === null) {
              return { done: true, value }
            } else {
              return { done: false, value }
            }
          }

          const waitForNextValue = (): Promise<IteratorResult<StateSnapshotOpaque, null>> => {
            let cancel = () => {}
            const promise = new Promise<IteratorResult<StateSnapshotOpaque, null>>((resolve) => {
              const cancelChangeSub = machineInternal.channels.change.sub(() =>
                resolve(intoIteratorResult(container.snapshot())),
              )
              const cancelDestroySub = machineInternal.channels.destroy.sub(() =>
                resolve(intoIteratorResult(null)),
              )
              cancel = () => {
                cancelChangeSub()
                cancelDestroySub()
              }
            })
            return promise.finally(() => cancel())
          }

          flaggerInternal.addDestroyHook(subscription)

          return {
            consume: (): Promise<IteratorResult<StateSnapshotOpaque, null>> => {
              if (machineInternal.isDestroyed()) {
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
      machineInternal.addDestroyHook(unsubscribeEventBridge)
      machineInternal.addDestroyHook(unsubscribeFromActyx)
      machineInternal.addDestroyHook(nextValueAwaiter.destroy)

      // Self API construction

      const onThrowOrReturn = async (): Promise<IteratorResult<StateSnapshotOpaque, null>> => {
        machineInternal.destroy()
        return { done: true, value: null }
      }

      const api = {
        get: container.snapshot,
        initial: container.initial,
      }

      const iterator: AsyncIterableIterator<StateSnapshotOpaque> = {
        next: (): Promise<IteratorResult<StateSnapshotOpaque, null>> => nextValueAwaiter.consume(),
        return: onThrowOrReturn,
        throw: onThrowOrReturn,
        [Symbol.asyncIterator]: () => iterator,
      }

      const self: AsyncIterableIterator<StateSnapshotOpaque> & typeof api = {
        ...api,
        ...iterator,
      }

      return self
    })
    .build()
}

export const createChannelsForMachineRunner = () => ({
  audit: {
    reset: Obs.make<void>(),
    state: Obs.make<{
      state: State.Any
      events: ActyxEvent<Event.Any>[]
    }>(),
    dropped: Obs.make<{
      state: State.Any
      events: ActyxEvent<Event.Any>[]
    }>(),
    error: Obs.make<{
      state: State.Any
      events: ActyxEvent<Event.Any>[]
      error: unknown
    }>(),
  },
  debug: {
    eventHandlingPrevState: Obs.make<unknown>(),
    eventHandling: Obs.make<{
      event: ActyxEvent<Event.Any>
      handlingReport: PushEventResult
      mechanism: StateMechanism.Any
      factory: StateFactory.Any
      nextState: unknown
    }>(),
    caughtUp: Obs.make<void>(),
  },
  log: Obs.make<string>(),
})

export type StateSnapshotOpaque = State<string, unknown> & {
  as: <
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
  ) => StateSnapshot<StateName, StatePayload, Commands> | void
}

export type StateSnapshot<
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = State<StateName, StatePayload> & {
  commands: ToCommandSignatureMap<Commands, any, Event.Any>
}

export namespace StateSnapshot {
  export type Of<T extends StateFactory.Any> = T extends StateFactory<
    any,
    any,
    infer StateName,
    infer StatePayload,
    infer Commands
  >
    ? StateSnapshot<StateName, StatePayload, Commands>
    : never
}

type StateContainerData<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  factory: StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >
  state: State<any, any>
}

type StateContainerInternals<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  readonly initial: StateContainerData<any, any, any, any, any>
  current: StateContainerData<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >
  queue: ActyxEvent<Event.Any>[]
  obs: Obs<Event.Any[]>
}

namespace StateContainerInternals {
  export const ACCESSOR: unique symbol = Symbol('StateContainerInternals/ACCESSOR')

  export type Any = StateContainerInternals<any, any, any, any, any>

  export const matchToFactory = <
    ProtocolName extends string,
    EventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<ProtocolName, EventFactories, StateName, StatePayload, Commands>,
    internal: StateContainerInternals.Any,
  ): internal is StateContainerInternals<
    ProtocolName,
    EventFactories,
    StateName,
    StatePayload,
    Commands
  > => {
    if (internal.current.factory === factory) {
      return true
    }
    return false
  }
}

/**
 * For optimization purpose
 * Huge closure creation may have reduced performance in different JS engines
 */
namespace StateContainerCommon {
  export namespace ReactionHandling {
    export type Queue = typeof Queue
    export const Queue: unique symbol = Symbol('Queue')

    export type DiscardLast = typeof DiscardLast
    export const DiscardLast: unique symbol = Symbol('DiscardLast')

    export type Discard = typeof Discard
    export const Discard: unique symbol = Symbol('Discard')

    export type Execute = typeof Execute
    export const Execute: unique symbol = Symbol('Execute')

    export type InvalidQueueEmpty = typeof InvalidQueueEmpty
    export const InvalidQueueEmpty: unique symbol = Symbol('InvalidQueueEmpty')
  }

  export type EventQueueHandling =
    | {
        handling: ReactionHandling.Execute
        reaction: Reaction<ReactionContext<any>>
        matching: Event.Any[]
      }
    | {
        handling: ReactionHandling.DiscardLast
        orphan: ActyxEvent<Event.Any>
      }
    | {
        handling: ReactionHandling.Discard
        orphans: ActyxEvent<Event.Any>[]
      }
    | {
        handling: ReactionHandling.Queue | ReactionHandling.InvalidQueueEmpty
      }

  type ReactionMatchResult = {
    reaction: Reaction<ReactionContext<any>>
    queue: ActyxEvent<Event.Any>[]
  }

  const determineEventQueueHandling = <Self>(
    reactions: ReactionMapPerMechanism<Self>,
    queue: ActyxEvent<Event.Any>[],
  ): EventQueueHandling & {
    reactionMatchResults?: ReactionMatchResult[]
  } => {
    const firstEvent = queue.at(0)
    if (!firstEvent) {
      return {
        handling: ReactionHandling.InvalidQueueEmpty,
      }
    }

    const matchingReaction = reactions.get(firstEvent.payload.type)

    if (!matchingReaction) {
      return { handling: ReactionHandling.Discard, orphans: [...queue] }
    }

    const lastEventIndex = queue.length - 1
    const lastEvent = queue[lastEventIndex]

    if (lastEvent.payload.type !== matchingReaction.eventChainTrigger[lastEventIndex]?.type) {
      return {
        handling: ReactionHandling.DiscardLast,
        orphan: lastEvent,
      }
    }

    if (queue.length === matchingReaction.eventChainTrigger.length) {
      return {
        handling: ReactionHandling.Execute,
        matching: [...queue].map((actyxEvent) => actyxEvent.payload),
        reaction: matchingReaction,
      }
    }

    return {
      handling: ReactionHandling.Queue,
    }
  }

  export const reset = (internals: StateContainerInternals.Any) => {
    const initial = internals.initial
    internals.current = {
      factory: initial.factory,
      state: deepCopy(initial.state),
    }
    internals.queue = []
  }

  export const pushEvent = <StateName extends string, StatePayload extends any>(
    internals: StateContainerInternals.Any,
    event: ActyxEvent<Event.Any>,
  ) => {
    internals.queue.push(event)

    const queueSnapshotBeforeExecution = [...internals.queue]

    const mechanism = internals.current.factory.mechanism()
    const protocol = mechanism.protocol
    const reactions = protocol.reactionMap.get(mechanism)

    const handlingResult = determineEventQueueHandling<StatePayload>(reactions, internals.queue)

    if (handlingResult.handling === ReactionHandling.Execute) {
      const reaction = handlingResult.reaction
      const matchingEventSequence = handlingResult.matching

      // internals.queue are mutated here
      // .splice mutates
      const nextPayload = reaction.handler(
        {
          self: internals.current.state.payload,
        },
        matchingEventSequence,
      )

      const nextFactory = reaction.next

      internals.current = {
        state: {
          type: nextFactory.mechanism().name,
          payload: nextPayload,
        },
        factory: reaction.next,
      }

      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.Queue) {
      // do nothing, item has been pushed
    } else if (handlingResult.handling === ReactionHandling.Discard) {
      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.DiscardLast) {
      internals.queue.pop()
    } else if (handlingResult.handling === ReactionHandling.InvalidQueueEmpty) {
      // impossible to happen because `internal.queue.push(event)` above but who knows?
      // TODO: implement anyway
    }

    return {
      ...handlingResult,
      queueSnapshotBeforeExecution,
    }
  }
}

type PushEventResult = StateContainerCommon.EventQueueHandling & {
  queueSnapshotBeforeExecution: ActyxEvent<Event.Any>[]
}

type StateContainer = {
  [StateContainerInternals.ACCESSOR]: () => StateContainerInternals.Any
  factory: () => StateFactory.Any
  commandObs: () => Obs<Event.Any[]>

  snapshot: () => StateSnapshotOpaque
  get: () => State.Any
  initial: () => State.Any

  reset: () => void
  pushEvent: (events: ActyxEvent<Event.Any>) => PushEventResult
}

namespace StateContainer {
  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >,
    payload: StatePayload,
  ) => {
    const initial: StateContainerData<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    > = {
      factory,
      state: {
        payload,
        type: factory.mechanism().name,
      },
    }
    const internals: StateContainerInternals<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    > = {
      initial: initial,
      current: {
        factory: initial.factory,
        state: deepCopy(initial.state),
      },
      obs: Obs.make(),
      queue: [],
    }

    return fromInternals(internals)
  }

  const fromInternals = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    internals: StateContainerInternals<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >,
  ) => {
    const factory: StateContainer['factory'] = () => internals.current.factory
    const snapshot: StateContainer['snapshot'] = () => {
      // Capture state and factory at snapshot call-time
      const stateAtSnapshot = internals.current.state
      const factoryAtSnapshot = internals.current.factory as StateFactory.Any
      const isExpired = () =>
        factoryAtSnapshot !== internals.current.factory ||
        stateAtSnapshot !== internals.current.state

      const as: StateSnapshotOpaque['as'] = (factory) => {
        if (factoryAtSnapshot.mechanism() === factory.mechanism()) {
          const mechanism = factory.mechanism()
          return {
            payload: stateAtSnapshot.payload,
            type: stateAtSnapshot.type,
            commands: convertCommandMapToCommandSignatureMap<any, StatePayload, Event.Any[]>(
              mechanism.commands,
              {
                isExpired,
                getActualContext: () => ({
                  self: internals.current.state.payload,
                }),
                onReturn: (events) => internals.obs.emit(events),
              },
            ),
          }
        }
        return undefined
      }
      return {
        as,
        payload: stateAtSnapshot.payload,
        type: stateAtSnapshot.type,
      }
    }
    const get: StateContainer['get'] = () => internals.current.state
    const initial: StateContainer['initial'] = () => internals.initial.state
    const reset: StateContainer['reset'] = () => StateContainerCommon.reset(internals)
    const pushEvent: StateContainer['pushEvent'] = (event) =>
      StateContainerCommon.pushEvent(internals, event)

    const self: StateContainer = {
      [StateContainerInternals.ACCESSOR]: () => internals,
      commandObs: () => internals.obs,
      initial,
      get,
      snapshot,
      factory,
      reset,
      pushEvent,
    }

    return self
  }

  export const tryFrom = <
    ProtocolName extends string,
    RegisteredEventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    internals: StateContainerInternals.Any,
    factory: StateFactory<
      ProtocolName,
      RegisteredEventFactories,
      StateName,
      StatePayload,
      Commands
    >,
  ): StateContainer | null => {
    if (StateContainerInternals.matchToFactory(factory, internals)) {
      return fromInternals<
        ProtocolName,
        RegisteredEventFactories,
        StateName,
        StatePayload,
        Commands
      >(internals)
    }
    return null
  }
}
