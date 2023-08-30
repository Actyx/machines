/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActyxEvent, Metadata } from '@actyx/sdk'
import { deepCopy } from '../utils/object-utils.js'
import {
  CommandDefinerMap,
  CommandFiredAfterDestroyed,
  CommandFiredAfterLocked,
  CommandFiredExpiry,
} from '../design/command.js'
import { Contained, MachineEvent } from '../design/event.js'
import {
  Reaction,
  ReactionContext,
  ReactionMapPerMechanism,
  StateRaw,
  StateFactory,
} from '../design/state.js'

export type CommandCallback<MachineEventFactories extends MachineEvent.Factory.Any> = (_: {
  commandKey: string
  isExpired: () => boolean
  generateEvents: () => Contained.ContainedEvent<MachineEvent.Of<MachineEventFactories>>[]
}) => Promise<
  CommandFiredAfterDestroyed | CommandFiredAfterLocked | CommandFiredExpiry | Metadata[]
>

export type RunnerInternals<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = {
  caughtUpFirstTime: boolean
  caughtUp: boolean
  readonly initial: StateAndFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    any,
    any,
    any
  >
  commandEmitFn: CommandCallback<MachineEventFactories>
  queue: ActyxEvent<MachineEvent.Any>[]
  current: StateAndFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >

  previouslyEmittedToNext: null | StateAndFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >

  // TODO: document how it behaves
  commandLock: null | symbol
}

export namespace RunnerInternals {
  export type Any = RunnerInternals<any, any, any, any, any, any>

  export const make = <
    SwarmProtocolName extends string,
    MachineName extends string,
    MachineEventFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >(
    factory: StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      StateName,
      StatePayload,
      Commands
    >,
    payload: StatePayload,
    commandCallback: CommandCallback<MachineEventFactories>,
  ) => {
    const initial: StateAndFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
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
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
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
      previouslyEmittedToNext: null,
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

    // Asserted as non-nullish because it is impossible for `queue`'s length to
    // exceeed `matchingReaction.eventChainTrigger`'s length
    //
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const factoryAtNextIndex = matchingReaction.eventChainTrigger[nextIndex]!
    const zodDefinition = factoryAtNextIndex[MachineEvent.FactoryInternalsAccessor].zodDefinition

    const typeMatches = () => newEvent.payload.type === factoryAtNextIndex.type

    const payloadSchemaMatchesOrZodIsUnavailable = () => {
      if (!zodDefinition) return true
      const { type, ...rest } = newEvent.payload
      return zodDefinition.safeParse(rest).success
    }

    if (!typeMatches() || !payloadSchemaMatchesOrZodIsUnavailable()) {
      return { shouldQueue: false }
    }

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
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = {
  factory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >
  data: StateRaw<any, any>
}

export namespace StateAndFactory {
  export type Any = StateAndFactory<any, any, any, any, any, any>
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
