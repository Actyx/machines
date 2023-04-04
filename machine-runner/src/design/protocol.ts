import { Tag } from '@actyx/sdk'
import {
  StateMechanism,
  MachineEvent,
  ProtocolInternals,
  ReactionMap,
  StateFactory,
} from './state.js'

export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  designState: <StateName extends string>(
    stateName: StateName,
  ) => Protocol.DesignStateIntermediate<ProtocolName, RegisteredEventsFactoriesTuple, StateName>

  designEmpty: <StateName extends string>(
    stateName: StateName,
  ) => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    void,
    Record<never, never>
  >

  tag: (
    rawTagString?: string,
    extractId?:
      | ((e: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>) => string)
      | undefined,
  ) => Tag<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>

  createJSONForAnalysis: (
    initial: StateFactory<ProtocolName, RegisteredEventsFactoriesTuple, any, any, any>,
  ) => ProtocolAnalysisResource
}

export namespace Protocol {
  export type Any = Protocol<any, any>

  export type EventsOf<T extends Protocol.Any> = T extends Protocol<
    any,
    infer RegisteredEventsFactoriesTuple
  >
    ? MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>
    : never

  export type DesignStateIntermediate<
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
    StateName extends string,
  > = {
    withPayload: <StatePayload extends any>() => StateMechanism<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Record<never, never>
    >
  }

  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  >(
    protocolName: ProtocolName,
    registeredEventFactories: RegisteredEventsFactoriesTuple,
  ): Protocol<ProtocolName, RegisteredEventsFactoriesTuple> => {
    type Self = Protocol<ProtocolName, RegisteredEventsFactoriesTuple>
    type Internals = ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>

    const protocolInternal: Internals = {
      name: protocolName,
      registeredEvents: registeredEventFactories,
      reactionMap: ReactionMap.make(),
      commands: [],
      states: {
        registeredNames: new Set(),
        allFactories: new Set(),
      },
    }

    const markStateNameAsUsed = (stateName: string) => {
      if (stateName.includes(ProtocolAnalysisResource.SyntheticDelimiter)) {
        throw new Error(
          `Name should not contain character '${ProtocolAnalysisResource.SyntheticDelimiter}'`,
        )
      }

      if (protocolInternal.states.registeredNames.has(stateName)) {
        throw new Error(`State "${stateName}" already registered within this protocol`)
      }
      protocolInternal.states.registeredNames.add(stateName)
    }

    const designState: Self['designState'] = (stateName) => {
      markStateNameAsUsed(stateName)
      return {
        withPayload: () => StateMechanism.make(protocolInternal, stateName),
      }
    }

    const designEmpty: Self['designEmpty'] = (stateName) => {
      markStateNameAsUsed(stateName)
      return StateMechanism.make(protocolInternal, stateName)
    }

    const tag: Self['tag'] = (name = protocolName, extractId) => Tag(name, extractId)

    const createJSONForAnalysis: Self['createJSONForAnalysis'] = (initial) =>
      ProtocolAnalysisResource.fromProtocolInternals(protocolInternal, initial)

    return {
      designState,
      designEmpty,
      tag,
      createJSONForAnalysis,
    }
  }
}

export type ProtocolAnalysisResource = {
  initial: string
  subscriptions: string[]
  transitions: {
    source: string
    target: string
    label: { tag: 'Execute'; cmd: string; logType: string[] } | { tag: 'Input'; eventType: string }
  }[]
}

export namespace ProtocolAnalysisResource {
  export const SyntheticDelimiter = '§' as const

  export const syntheticEventName = (
    baseStateFactory: StateMechanism.Any | StateFactory.Any,
    modifyingEvents: Pick<MachineEvent.Factory.Any, 'type'>[],
  ) =>
    `${SyntheticDelimiter}${[
      ('mechanism' in baseStateFactory ? baseStateFactory.mechanism : baseStateFactory).name,
      ...modifyingEvents.map((f) => f.type),
    ].join(SyntheticDelimiter)}`

  export const fromProtocolInternals = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  >(
    protocolInternals: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>,
    initial: StateFactory<ProtocolName, RegisteredEventsFactoriesTuple, any, any, any>,
  ): ProtocolAnalysisResource => {
    if (!protocolInternals.states.allFactories.has(initial)) {
      throw new Error('Initial state supplied not found')
    }

    // Calculate transitions

    const reactionMapEntries = Array.from(protocolInternals.reactionMap.getAll().entries())

    const subscriptions: string[] = Array.from(
      new Set(
        reactionMapEntries.flatMap(([_, reactions]) =>
          Array.from(reactions.values()).flatMap((reaction): string[] =>
            reaction.eventChainTrigger.map((trigger) => trigger.type),
          ),
        ),
      ),
    )

    const transitionsFromReactions: ProtocolAnalysisResource['transitions'] =
      reactionMapEntries.reduce(
        (accumulated: ProtocolAnalysisResource['transitions'], [ofState, reactions]) => {
          for (const reaction of reactions.values()) {
            // This block converts a reaction into a chain of of transitions of states and synthetic states
            // Example:
            // A reacts to Events E1, E2, and E3 sequentially and transform into B
            // will result in these transitions
            // Source: A,       Input: E1, Target: A+E1
            // Source: A+E1,    Input: E2, Target: A+E1+E2
            // Source: A+E1+E2, Input: E3, Target: B
            const modifier: MachineEvent.Factory.Any[] = []
            for (const [index, trigger] of reaction.eventChainTrigger.entries()) {
              const source = index === 0 ? ofState.name : syntheticEventName(ofState, modifier)

              modifier.push(trigger)

              const target =
                index === reaction.eventChainTrigger.length - 1
                  ? reaction.next.mechanism.name
                  : syntheticEventName(ofState, modifier)

              accumulated.push({
                source: source,
                target: target,
                label: {
                  tag: 'Input',
                  eventType: trigger.type,
                },
              })
            }
          }

          return accumulated
        },
        [],
      )

    const transitionsFromCommands: ProtocolAnalysisResource['transitions'] =
      protocolInternals.commands.map((item): ProtocolAnalysisResource['transitions'][0] => ({
        source: item.ofState,
        target: item.ofState,
        label: {
          tag: 'Execute',
          cmd: item.commandName,
          logType: item.events,
        },
      }))

    const resource: ProtocolAnalysisResource = {
      initial: initial.mechanism.name,
      subscriptions,
      transitions: [...transitionsFromCommands, ...transitionsFromReactions],
    }

    return resource
  }
}
