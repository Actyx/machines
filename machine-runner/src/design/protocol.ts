import { Tag, Tags } from '@actyx/sdk'
import {
  StateMechanism,
  MachineEvent,
  MachineProtocol,
  ReactionMap,
  StateFactory,
} from './state.js'
import { NonZeroTuple } from '../utils/type-utils.js'

// TODO: document
export type SwarmProtocol<
  SwarmProtocolName extends string,
  TagString extends NonZeroTuple<string>,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  makeMachine: <MachineName extends string>(
    machineName: MachineName,
  ) => Machine<MachineName, RegisteredEventsFactoriesTuple>
  tags: Tags<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>
}

export namespace SwarmProtocol {
  export const make = <
    SwarmProtocolName extends string,
    TagString extends NonZeroTuple<string>,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  >(
    swarmProtocolName: SwarmProtocolName,
    tags: TagString,
    registeredEventFactories: RegisteredEventsFactoriesTuple,
  ): SwarmProtocol<SwarmProtocolName, TagString, RegisteredEventsFactoriesTuple> => {
    return {
      tags: (() => {
        const [first, ...rest] = tags
        return rest.reduce(
          (
            acc: Tags<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>,
            moreTagString,
          ) => acc.and(Tag(moreTagString)),
          Tag<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>(first),
        )
      })(),
      makeMachine: (machineName) => ImplMachine.make(machineName, registeredEventFactories),
    }
  }
}

/**
 * A machine is the entry point for designing machine states and transitions.
 * Its name should correspond to a role definition in a machine-check swarm
 * protocol. The resulting states are constrained to only be able to interact
 * with the events listed in the protocol design step. It accumulates
 * information on states and reactions. This information can be passed to
 * checkProjection to verify that the machine fits into a given swarm protocol.
 */
export type Machine<
  MachineName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  /**
   * Starts the design process for a state with a payload. Payload data will be
   * required when constructing this state.
   * @example
   * const HangarControlIncomingShip = machine
   *   .designState("HangarControlIncomingShip")
   *   .withPayload<{
   *     shipId: string,
   *   }>()
   *   .finish()
   */
  designState: <StateName extends string>(
    stateName: StateName,
  ) => DesignStateIntermediate<MachineName, RegisteredEventsFactoriesTuple, StateName>

  /**
   * Starts a design process for a state without a payload.
   * @example
   * const HangarControlIdle = machine
   *   .designEmpty("HangarControlIdle")
   *   .finish()
   */
  designEmpty: <StateName extends string>(
    stateName: StateName,
  ) => StateMechanism<
    MachineName,
    RegisteredEventsFactoriesTuple,
    StateName,
    void,
    Record<never, never>
  >

  // /**
  //  * Create an Actyx event tag for this machine protocol. The resulting tag is typed to
  //  * permit the protocol's events. This tag type definition is required by
  //  * `createMachineRunner`
  //  * @param rawTagString - optional string that is when not supplied defaults to
  //  * the protocol's name.
  //  * @param extractId - @see actyx sdk Tag documentation for the explanation of
  //  * extractId.
  //  */
  // tag: (
  //   rawTagString?: string,
  //   extractId?:
  //     | ((e: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>) => string)
  //     | undefined,
  // ) => Tag<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>

  createJSONForAnalysis: (
    initial: StateFactory<MachineName, RegisteredEventsFactoriesTuple, any, any, any>,
  ) => MachineAnalysisResource
}

type DesignStateIntermediate<
  MachineName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
> = {
  /**
   * Declare payload type for a state.
   */
  withPayload: <StatePayload extends any>() => StateMechanism<
    MachineName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Record<never, never>
  >
}

/**
 * A collection of utilities for designing a protocol.
 * @see Machine.make for getting started with using MachineRunner Machine Protocol.
 */
export namespace Machine {
  export type Any = Machine<any, any>

  /**
   * Extract the type of registered MachineEvent of a machine protocol in the
   * form of a union type.
   * @example
   * const E1 = MachineEvent.design("E1").withoutPayload();
   * const E2 = MachineEvent.design("E2").withoutPayload();
   * const E3 = MachineEvent.design("E3").withoutPayload();
   *
   * const machine = Machine.make("somename", [E1, E2, E3]);
   *
   * type AllEvents = Machine.EventsOf<typeof machine>;
   * // Equivalent of:
   * // MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2> | MachineEvent.Of<typeof E3>
   */
  export type EventsOf<T extends Machine.Any> = T extends Machine<
    any,
    infer RegisteredEventsFactoriesTuple
  >
    ? MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>
    : never
}

namespace ImplMachine {
  /**
   * Create a machine protocol with a specific name and event factories.
   * @param machineName - name of the machine protocol.
   * @param registeredEventFactories - tuple of MachineEventFactories.
   * @see MachineEvent.design to get started on creating MachineEventFactories
   * for the registeredEventFactories parameter.
   * @example
   * const hangarBay = Machine.make("hangarBay")
   */
  export const make = <
    MachineName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  >(
    machineName: MachineName,
    registeredEventFactories: RegisteredEventsFactoriesTuple,
  ): Machine<MachineName, RegisteredEventsFactoriesTuple> => {
    type Self = Machine<MachineName, RegisteredEventsFactoriesTuple>
    type Protocol = MachineProtocol<MachineName, RegisteredEventsFactoriesTuple>

    const protocol: Protocol = {
      name: machineName,
      registeredEvents: registeredEventFactories,
      reactionMap: ReactionMap.make(),
      commands: [],
      states: {
        registeredNames: new Set(),
        allFactories: new Set(),
      },
    }

    const markStateNameAsUsed = (stateName: string) => {
      if (stateName.includes(MachineAnalysisResource.SyntheticDelimiter)) {
        throw new Error(
          `Name should not contain character '${MachineAnalysisResource.SyntheticDelimiter}'`,
        )
      }

      if (protocol.states.registeredNames.has(stateName)) {
        throw new Error(`State "${stateName}" already registered within this protocol`)
      }
      protocol.states.registeredNames.add(stateName)
    }

    const designState: Self['designState'] = (stateName) => {
      markStateNameAsUsed(stateName)
      return {
        withPayload: () => StateMechanism.make(protocol, stateName),
      }
    }

    const designEmpty: Self['designEmpty'] = (stateName) => {
      markStateNameAsUsed(stateName)
      return StateMechanism.make(protocol, stateName)
    }

    const createJSONForAnalysis: Self['createJSONForAnalysis'] = (initial) =>
      MachineAnalysisResource.fromMachineInternals(protocol, initial)

    return {
      designState,
      designEmpty,
      createJSONForAnalysis,
    }
  }
}

export type MachineAnalysisResource = {
  initial: string
  subscriptions: string[]
  transitions: {
    source: string
    target: string
    label: { tag: 'Execute'; cmd: string; logType: string[] } | { tag: 'Input'; eventType: string }
  }[]
}

export namespace MachineAnalysisResource {
  export const SyntheticDelimiter = '§' as const

  export const syntheticEventName = (
    baseStateFactory: StateMechanism.Any | StateFactory.Any,
    modifyingEvents: Pick<MachineEvent.Factory.Any, 'type'>[],
  ) =>
    `${SyntheticDelimiter}${[
      ('mechanism' in baseStateFactory ? baseStateFactory.mechanism : baseStateFactory).name,
      ...modifyingEvents.map((f) => f.type),
    ].join(SyntheticDelimiter)}`

  export const fromMachineInternals = <
    MachineName extends string,
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  >(
    protocolInternals: MachineProtocol<MachineName, RegisteredEventsFactoriesTuple>,
    initial: StateFactory<MachineName, RegisteredEventsFactoriesTuple, any, any, any>,
  ): MachineAnalysisResource => {
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

    const transitionsFromReactions: MachineAnalysisResource['transitions'] =
      reactionMapEntries.reduce(
        (accumulated: MachineAnalysisResource['transitions'], [ofState, reactions]) => {
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

    const transitionsFromCommands: MachineAnalysisResource['transitions'] =
      protocolInternals.commands.map((item): MachineAnalysisResource['transitions'][0] => ({
        source: item.ofState,
        target: item.ofState,
        label: {
          tag: 'Execute',
          cmd: item.commandName,
          logType: item.events,
        },
      }))

    const resource: MachineAnalysisResource = {
      initial: initial.mechanism.name,
      subscriptions,
      transitions: [...transitionsFromCommands, ...transitionsFromReactions],
    }

    return resource
  }
}
