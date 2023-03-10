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
  return Agent.startBuild()
    .setChannels((c) => ({
      ...c,
      ...createChannelsForMachineRunner(),
    }))
    .setAPI((agent) => {
      const subscribeMonotonicQuery = {
        query,
        sessionId: 'dummy',
        attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
      }

      const persist = (e: any[]) =>
        sdk.publish(query.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

      let unsub = null as null | (() => void)

      const unsubscribe = () => {
        unsub?.()
        unsub = null
      }
      const restartSubscription = () => {
        unsubscribe()
        unsub = sdk.subscribeMonotonic<Event.Any>(
          subscribeMonotonicQuery,
          (d) => {
            try {
              if (d.type === MsgType.timetravel) {
                agent.channels.log.emit('Time travel')

                container.reset()
                agent.channels.audit.reset.emit()

                restartSubscription()
              } else if (d.type === MsgType.events) {
                for (const event of d.events) {
                  // TODO: Runtime typeguard for event
                  agent.channels.debug.eventHandlingPrevState.emit(container.get())
                  const handlingReport = container.pushEvent(event)
                  agent.channels.debug.eventHandling.emit({
                    event,
                    handlingReport,
                    mechanism: container.factory().mechanism(),
                    factory: container.factory(),
                    nextState: container.get(),
                  })
                  if (handlingReport.handling === StateContainerCommon.ReactionHandling.Execute) {
                    agent.channels.audit.state.emit({
                      state: container.get(),
                      events: handlingReport.queueSnapshotBeforeExecution,
                    })
                    if (handlingReport.orphans.length > 0) {
                      agent.channels.audit.dropped.emit({
                        state: container.get(),
                        events: handlingReport.orphans,
                      })
                    }
                  }

                  if (handlingReport.handling === StateContainerCommon.ReactionHandling.Discard) {
                    agent.channels.audit.dropped.emit({
                      state: container.get(),
                      events: handlingReport.orphans,
                    })
                  }
                }

                if (d.caughtUp) {
                  // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
                  agent.channels.debug.caughtUp.emit()
                  agent.channels.log.emit('Caught up')
                  agent.channels.change.emit()
                }
              }
            } catch (error) {
              console.error(error)
            }
          },
          (err) => {
            agent.channels.log.emit('Restarting in 1sec due to error')

            container.reset()
            agent.channels.audit.reset.emit()

            unsubscribe()
            setTimeout(() => restartSubscription, 1000)
          },
        )
      }

      // run subscription
      restartSubscription()

      // Pipe events from stateContainer to sdk

      const commandObs = container.commandObs()
      const unsubEventsPipe = commandObs.sub((events) => persist(events))

      // Important part, if agent is killed, unsubscribe is called
      agent.addDestroyHook(unsubEventsPipe)
      agent.addDestroyHook(unsubscribe)

      return {
        get: () => container,
      }
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

export type StateSnapshot = {
  type: string
  current: unknown
  as: <
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
    Factory extends StateFactory<any, any, StateName, StatePayload, Commands>,
  >(
    factory: Factory,
  ) => TypedStateSnapshot<StateName, StatePayload, Commands> | void
}

export type TypedStateSnapshot<
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  type: StateName
  current: StatePayload
  // TODO: rethink retval
  commands: ToCommandSignatureMap<Commands, any, Event.Any>
}

// TODO: rename
// ==================================
// StateLensCommon
// ==================================

export type StateContainerData<
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

export type StateContainerInternals<
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

export namespace StateContainerInternals {
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
export namespace StateContainerCommon {
  export namespace ReactionMatchResult {
    export type All = TotalMatch | PartialMatch

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B, ..., C]
    export type TotalMatch = typeof TotalMatch
    export const TotalMatch: unique symbol = Symbol('TotalMatch')

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B]
    export type PartialMatch = typeof PartialMatch
    export const PartialMatch: unique symbol = Symbol('PartialMatch')
  }

  // TODO: unit test
  const matchReaction = <Self>(
    reaction: Reaction<Self>,
    queue: ActyxEvent<Event.Any>[],
  ): {
    result: ReactionMatchResult.All | null
    orphans: ActyxEvent<Event.Any>[]
    matching: Event.Any[]
  } => {
    const queueClone = [...queue]
    const matchingEventSequence = []
    const orphanEventSequence = []

    const result = (() => {
      for (const [index, trigger] of reaction.eventChainTrigger.entries()) {
        const matchingEvent = (() => {
          while (queueClone.length > 0) {
            const actyxEvent = queueClone.shift()
            if (actyxEvent) {
              if (actyxEvent.payload.type === trigger.type) {
                return actyxEvent.payload
              } else {
                orphanEventSequence.push(actyxEvent)
              }
            }
          }
          return null
        })()

        if (matchingEvent !== null) {
          matchingEventSequence.push(matchingEvent)
          continue
        } else {
          if (index > 0) return ReactionMatchResult.PartialMatch
          if (index === 0) return null
        }
      }

      return ReactionMatchResult.TotalMatch
    })()

    return {
      result,
      orphans: orphanEventSequence,
      matching: matchingEventSequence,
    }
  }

  export namespace ReactionHandling {
    export type Queue = typeof Queue
    export const Queue: unique symbol = Symbol('Queue')

    export type Discard = typeof Discard
    export const Discard: unique symbol = Symbol('Discard')

    export type Execute = typeof Execute
    export const Execute: unique symbol = Symbol('Execute')

    export type InvalidQueueEmpty = typeof InvalidQueueEmpty
    export const InvalidQueueEmpty: unique symbol = Symbol('InvalidQueueEmpty')
  }

  // TODO: optimize reaction query checking and queueing by only checking the first and the last index
  // as how the first runner version does it

  export type EventQueueHandling =
    | {
        handling: ReactionHandling.Execute
        reaction: Reaction<ReactionContext<any>>
        orphans: ActyxEvent<Event.Any>[]
        matching: Event.Any[]
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
    reactions: Reaction<ReactionContext<Self>>[],
    queue: ActyxEvent<Event.Any>[],
  ): EventQueueHandling & {
    reactionMatchResults?: ReactionMatchResult[]
  } => {
    if (queue.length === 0) {
      return {
        handling: ReactionHandling.InvalidQueueEmpty,
      }
    }

    const reactionMatchResults: ReactionMatchResult[] = []
    const partialMatches: Reaction<ReactionContext<Self>>[] = []

    for (const reaction of reactions) {
      const { result, orphans, matching } = matchReaction(reaction, queue)
      if (result === ReactionMatchResult.TotalMatch) {
        return {
          handling: ReactionHandling.Execute,
          reaction,
          orphans,
          matching,
        }
      } else if (result === ReactionMatchResult.PartialMatch) {
        partialMatches.push(reaction)
      }

      reactionMatchResults.push({
        queue: [...queue],
        reaction: reaction,
      })
    }

    if (partialMatches.length > 0) {
      return {
        reactionMatchResults,
        handling: ReactionHandling.Queue,
      }
    }

    return { reactionMatchResults, handling: ReactionHandling.Discard, orphans: [...queue] }
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
    const protocol = internals.current.factory.mechanism().protocol
    const reactions = protocol.reactionMap.get(mechanism)

    const handlingResult = determineEventQueueHandling(reactions, internals.queue)

    if (handlingResult.handling === ReactionHandling.Execute) {
      const reaction = handlingResult.reaction
      const matchingEventSequence = handlingResult.matching

      // internals.queue are mutated here
      // .splice mutates
      const newContainer = reaction.handler(
        {
          self: internals.current.state.payload,
        },
        matchingEventSequence,
      )

      if (newContainer) {
        internals.current = {
          state: newContainer.get(),
          factory: newContainer.factory(),
        }
      }

      // TODO: change to satisfies
      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.Queue) {
      // do nothing, item has been pushed
    } else if (handlingResult.handling === ReactionHandling.Discard) {
      internals.queue = []
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

// // TODO: rename
// // ==================================
// // StateLensTransparent
// // ==================================

// export type StateContainer<
//   ProtocolName extends string,
//   EventFactories extends Event.Factory.NonZeroTuple,
//   StateName extends string,
//   StatePayload extends any,
//   Commands extends CommandDefinerMap<any, any, Event.Any[]>,
// > = {
//   [StateContainerInternals.ACCESSOR]: () => StateContainerInternals<
//     ProtocolName,
//     EventFactories,
//     StateName,
//     StatePayload,
//     Commands
//   >
//   factory: () => StateFactory<ProtocolName, EventFactories, StateName, StatePayload, Commands>
//   commandObs: () => Obs<Event.Any[]>
//   get: () => utils.DeepReadonly<State<StateName, StatePayload>>
//   initial: () => utils.DeepReadonly<State<StateName, StatePayload>>
//   commands: ToCommandSignatureMap<Commands, any, Event.Any[]>
// }

// export namespace StateContainer {
//   export type Minim = StateContainer<
//     string,
//     Event.Factory.NonZeroTuple,
//     string,
//     any,
//     CommandDefinerMap<any, any, Event.Any[]>
//   >

//   export type Any = StateContainer<any, any, any, any, any>

//   export type Of<T extends StateFactory.Any> = T extends StateFactory<
//     infer ProtocolName,
//     infer RegisteredEventsFactoriesTuple,
//     infer StateName,
//     infer StatePayload,
//     infer Commands
//   >
//     ? StateContainer<
//         ProtocolName,
//         RegisteredEventsFactoriesTuple,
//         StateName,
//         StatePayload,
//         Commands
//       >
//     : never

//   export const fromFactory = <
//     ProtocolName extends string,
//     RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
//     StateName extends string,
//     StatePayload extends any,
//     Commands extends CommandDefinerMap<any, any, Event.Any[]>,
//     Data extends StateContainerData<
//       ProtocolName,
//       RegisteredEventsFactoriesTuple,
//       StateName,
//       StatePayload,
//       Commands
//     >,
//   >(
//     initial: Data,
//   ) => {
//     const internals: StateContainerInternals<
//       ProtocolName,
//       RegisteredEventsFactoriesTuple,
//       StateName,
//       StatePayload,
//       Commands
//     > = {
//       initial: initial,
//       current: {
//         factory: initial.factory,
//         state: deepCopy(initial.state),
//       },
//       obs: Obs.make(),
//       queue: [],
//     }

//     return fromInternals(internals)
//   }

//   const fromInternals = <
//     ProtocolName extends string,
//     RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
//     StateName extends string,
//     StatePayload extends any,
//     Commands extends CommandDefinerMap<any, any, Event.Any[]>,
//   >(
//     internals: StateContainerInternals<
//       ProtocolName,
//       RegisteredEventsFactoriesTuple,
//       StateName,
//       StatePayload,
//       Commands
//     >,
//   ) => {
//     type Self = StateContainer<
//       ProtocolName,
//       RegisteredEventsFactoriesTuple,
//       StateName,
//       StatePayload,
//       Commands
//     >

//     const factory = () => internals.current.factory
//     const mechanism = () => internals.current.factory.mechanism()
//     const get = () => internals.current.state
//     const initial = () => internals.initial.state

//     // TODO: refactor to be more sturdy
//     // TODO: unit test
//     const commands = convertCommandMapToCommandSignatureMap<any, StatePayload, Event.Any[]>(
//       mechanism().commands,
//       () => ({
//         // TODO: think about the required context for a command
//         someSystemCall: () => 1,
//         self: internals.current.state.payload,
//       }),
//       (events) => {
//         internals.obs.emit(events)
//       },
//     )

//     const self: Self = {
//       [StateContainerInternals.ACCESSOR]: () => internals,
//       commandObs: () => internals.obs,
//       initial,
//       get,
//       commands,
//       factory,
//     }

//     return self
//   }

//   export const tryFrom = <
//     ProtocolName extends string,
//     RegisteredEventFactories extends Event.Factory.NonZeroTuple,
//     StateName extends string,
//     StatePayload extends any,
//     Commands extends CommandDefinerMap<any, any, Event.Any[]>,
//   >(
//     internals: StateContainerInternals.Any,
//     factory: StateFactory<
//       ProtocolName,
//       RegisteredEventFactories,
//       StateName,
//       StatePayload,
//       Commands
//     >,
//   ): StateContainer<
//     ProtocolName,
//     RegisteredEventFactories,
//     StateName,
//     StatePayload,
//     Commands
//   > | null => {
//     if (StateContainerInternals.matchToFactory(factory, internals)) {
//       return fromInternals<
//         ProtocolName,
//         RegisteredEventFactories,
//         StateName,
//         StatePayload,
//         Commands
//       >(internals)
//     }
//     return null
//   }
// }

// // TODO: rename
// // ==================================
// // StateLensOpaque
// // ==================================

export type PushEventResult = StateContainerCommon.EventQueueHandling & {
  queueSnapshotBeforeExecution: ActyxEvent<Event.Any>[]
}

// export type StateContainerOpaque = {
//   [StateContainerInternals.ACCESSOR]: () => StateContainerInternals.Any
//   as: <
//     ProtocolName extends string,
//     RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
//     StateName extends string,
//     StatePayload extends any,
//     Commands extends CommandDefinerMap<any, any, Event.Any[]>,
//   >(
//     factory: StateFactory<
//       ProtocolName,
//       RegisteredEventsFactoriesTuple,
//       StateName,
//       StatePayload,
//       Commands
//     >,
//   ) => StateContainer<
//     ProtocolName,
//     RegisteredEventsFactoriesTuple,
//     StateName,
//     StatePayload,
//     Commands
//   > | null
//   reset: () => void
//   pushEvent: (events: ActyxEvent<Event.Any>) => PushEventResult
//   get: () => utils.DeepReadonly<State<string, unknown>>
//   initial: () => utils.DeepReadonly<State<string, unknown>>
//   commandObs: () => Obs<Event.Any[]>
//   factory: () => StateFactory.Any
// }

// export namespace StateContainerOpaque {
//   export const fromStateContainer = (container: StateContainer.Any) => {
//     const internals = container[StateContainerInternals.ACCESSOR]()
//     const as: StateContainerOpaque['as'] = (factory) => StateContainer.tryFrom(internals, factory)
//     const reset: StateContainerOpaque['reset'] = () => StateContainerCommon.reset(internals)
//     const pushEvent: StateContainerOpaque['pushEvent'] = (event) =>
//       StateContainerCommon.pushEvent(internals, event)
//     const get = () => internals.current.state
//     const initial = () => internals.initial.state
//     const factory = () => internals.current.factory
//     const obs = () => internals.obs
//     const self: StateContainerOpaque = {
//       [StateContainerInternals.ACCESSOR]: () => internals,
//       as,
//       reset: reset,
//       pushEvent,
//       get: get,
//       initial: initial,
//       commandObs: obs,
//       factory,
//     }
//     return self
//   }
// }
