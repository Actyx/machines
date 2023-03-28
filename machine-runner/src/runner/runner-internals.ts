import { ActyxEvent, Metadata } from '@actyx/sdk'
import { deepCopy } from '../utils/object-utils.js'
import { CommandDefinerMap } from '../design/command.js'
import { MachineEvent } from '../design/event.js'
import {
  Reaction,
  ReactionContext,
  ReactionMapPerMechanism,
  StateRaw,
  StateFactory,
} from '../design/state.js'

export const CommandFiredAfterLocked: unique symbol = Symbol()
type CommandFiredAfterLocked = typeof CommandFiredAfterLocked

type CommandCallback<F extends MachineEvent.Factory.NonZeroTuple> = (
  _: MachineEvent.Factory.ReduceToEvent<F>[],
) => Promise<CommandFiredAfterLocked | Metadata[]>

export type RunnerInternals<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
> = {
  caughtUpFirstTime: boolean
  caughtUp: boolean
  readonly initial: StateAndFactory<ProtocolName, RegisteredEventsFactoriesTuple, any, any, any>
  commandEmitFn: CommandCallback<RegisteredEventsFactoriesTuple>
  queue: ActyxEvent<MachineEvent.Any>[]
  current: StateAndFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >

  // TODO: document how it behaves
  commandLock: null | CommandIssuanceStatus
}

export const UnknownEventID: unique symbol = Symbol()
export type UnknownEventID = typeof UnknownEventID
export type CommandIssuanceStatus = {
  // TODO: document null = no event issued
  issuedEventIds: (string | UnknownEventID)[]
  incomingEventIds: Set<string>
}

export namespace RunnerInternals {
  export type Any = RunnerInternals<any, any, any, any, any>

  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
  >(
    factory: StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >,
    payload: StatePayload,
    commandCallback: CommandCallback<RegisteredEventsFactoriesTuple>,
  ) => {
    const initial: StateAndFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    > = {
      factory,
      data: {
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
      initial,
      current: {
        factory,
        data: deepCopy(initial.data),
      },
      queue: [],
      commandEmitFn: commandCallback,
      caughtUp: false,
      caughtUpFirstTime: false,
      commandLock: null,
    }

    return internals
  }

  const shouldEventBeEnqueued = <Self>(
    reactions: ReactionMapPerMechanism<Self>,
    queue: ReadonlyArray<ActyxEvent<MachineEvent.Any>>,
    newEvent: ActyxEvent<MachineEvent.Any>,
  ):
    | {
        shouldQueue: false
      }
    | {
        shouldQueue: true
        matchingReaction: Reaction<ReactionContext<Self>>
      } => {
    const nextIndex = queue.length
    const firstEvent = queue.at(0) || newEvent
    const matchingReaction = reactions.get(firstEvent.payload.type)

    if (!matchingReaction) return { shouldQueue: false }

    if (newEvent.payload.type !== matchingReaction.eventChainTrigger[nextIndex]?.type)
      return { shouldQueue: false }

    return {
      shouldQueue: true,
      matchingReaction,
    }
  }

  export const reset = (internals: RunnerInternals.Any) => {
    const initial = internals.initial
    internals.current = {
      factory: initial.factory,
      data: deepCopy(initial.data),
    }
    internals.queue.length = 0
    internals.caughtUp = false
    internals.caughtUpFirstTime = false
    internals.commandLock = null
  }

  export const pushEvent = <StatePayload>(
    internals: RunnerInternals.Any,
    event: ActyxEvent<MachineEvent.Any>,
  ): PushEventResult => {
    const mechanism = internals.current.factory.mechanism
    const protocol = mechanism.protocol
    const reactions = protocol.reactionMap.get(mechanism)

    const queueDeterminationResult = shouldEventBeEnqueued<StatePayload>(
      reactions,
      internals.queue,
      event,
    )

    if (!queueDeterminationResult.shouldQueue) {
      return { executionHappened: false, discardable: event }
    } else {
      internals.queue.push(event)

      const matchingReaction = queueDeterminationResult.matchingReaction

      if (matchingReaction.eventChainTrigger.length !== internals.queue.length) {
        return { executionHappened: false }
      } else {
        const nextFactory = matchingReaction.next

        // Internals.queue needs to be emptied
        // but the event queue that's being executed
        // is required for audit
        // Swapping instead of copying + emptying
        const triggeringEvents = internals.queue
        internals.queue = []

        const nextPayload = matchingReaction.handler(
          {
            self: internals.current.data.payload,
          },
          ...triggeringEvents,
        )

        internals.current = {
          data: {
            type: nextFactory.mechanism.name,
            payload: nextPayload,
          },
          factory: nextFactory,
        }

        internals.commandLock = null

        return {
          executionHappened: true,
          triggeringEvents,
        }
      }
    }
  }
}

export type StateAndFactory<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
> = {
  factory: StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >
  data: StateRaw<any, any>
}

export namespace StateAndFactory {
  export type Any = StateAndFactory<any, any, any, any, any>
}

export type PushEventResult =
  | {
      executionHappened: false
      discardable?: ActyxEvent<MachineEvent.Any>
    }
  | {
      executionHappened: true
      triggeringEvents: ActyxEvent<MachineEvent.Any>[]
    }
