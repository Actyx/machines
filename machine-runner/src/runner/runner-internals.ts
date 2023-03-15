import { ActyxEvent } from '@actyx/sdk'
import { Obs } from '../utils/obs.js'
import { deepCopy } from '../utils/object-utils.js'
import { CommandDefinerMap } from '../design/command.js'
import { Event } from '../design/event.js'
import {
  Reaction,
  ReactionContext,
  ReactionMapPerMechanism,
  State,
  StateFactory,
} from '../design/state.js'

export type RunnerInternals<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  readonly initial: StateAndFactory<any, any, any, any, any>
  readonly obs: Obs<Event.Any[]>
  queue: ActyxEvent<Event.Any>[]
  current: StateAndFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >
}

export namespace RunnerInternals {
  export type Any = RunnerInternals<any, any, any, any, any>

  type ReactionMatchResult = {
    reaction: Reaction<ReactionContext<any>>
    queue: ActyxEvent<Event.Any>[]
  }
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
    const initial: StateAndFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    > = {
      factory,
      state: {
        payload,
        type: factory.mechanism.name,
      },
    }
    const internals: RunnerInternals<
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

    return internals
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

  export const reset = (internals: RunnerInternals.Any) => {
    const initial = internals.initial
    internals.current = {
      factory: initial.factory,
      state: deepCopy(initial.state),
    }
    internals.queue = []
  }

  export const pushEvent = <StatePayload extends any>(
    internals: RunnerInternals.Any,
    event: ActyxEvent<Event.Any>,
  ) => {
    internals.queue.push(event)

    const queueSnapshotBeforeExecution = [...internals.queue]

    const mechanism = internals.current.factory.mechanism
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
          type: nextFactory.mechanism.name,
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

type StateAndFactory<
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

export type PushEventResult = EventQueueHandling & {
  queueSnapshotBeforeExecution: ActyxEvent<Event.Any>[]
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
