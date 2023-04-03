import { Tag } from '@actyx/sdk'
import { StateMechanism, MachineEvent, ProtocolInternals, ReactionMap } from './state.js'

/**
 * A protocol is the entry point for designing machine states and transitions.
 * Its name should correspond to a role definition in a machine-check swarm
 * protocol. The resulting states are constrained to only be able to interact
 * with the events listed in the protocol design step. It accumulates
 * information on states and reactions. This information can be passed to
 * checkProjection to verify that the machine fits into a given swarm protocol.
 */
export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  /**
   * Starts the design process for a state with a payload. Payload data will be
   * required when constructing this state.
   * @example
   * const HangarControlIncomingShip = protocol
   *   .designState("HangarControlIncomingShip")
   *   .withPayload<{
   *     shipId: string,
   *   }>()
   *   .finish()
   */
  designState: <StateName extends string>(
    stateName: StateName,
  ) => DesignStateIntermediate<ProtocolName, RegisteredEventsFactoriesTuple, StateName>

  /**
   * Starts a design process for a state without payload.
   * @example
   * const HangarControlIdle = protocol
   *   .designEmpty("HangarControlIdle")
   *   .finish()
   */
  designEmpty: <StateName extends string>(
    stateName: StateName,
  ) => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    void,
    Record<never, never>
  >

  /**
   * Create an Actyx event tag for this protocol. The resulting tag is typed to
   * permit the protocol's events. This tag type definition is required by
   * `createMachineRunner`
   * @param rawTagString - optional string that is when not supplied defaults to
   * the protocol's name.
   * @param extractId - @see actyx sdk Tag documentation for the explanation of
   * extractId
   */
  tag: (
    rawTagString?: string,
    extractId?:
      | ((e: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>) => string)
      | undefined,
  ) => Tag<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>
}

type DesignStateIntermediate<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
> = {
  /**
   * Declare payload type for a state
   */
  withPayload: <StatePayload extends any>() => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Record<never, never>
  >
}

/**
 * A collection of utilities for designing a protocol
 * @see Protocol.make for getting started with using MachineRunner Protocol
 */
export namespace Protocol {
  export type Any = Protocol<any, any>

  /**
   * Extract the type of registered MachineEvent of a protocol in the form of a union type
   * @example
   * const E1 = MachineEvent.design("E1").withoutPayload();
   * const E2 = MachineEvent.design("E2").withoutPayload();
   * const E3 = MachineEvent.design("E3").withoutPayload();
   *
   * const protocol = Protocol.make("somename", [E1, E2, E3]);
   *
   * type AllEvents = Protocol.EventsOf<typeof protocol>;
   * // Equivalent of:
   * // MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2> | MachineEvent.Of<typeof E3>
   */
  export type EventsOf<T extends Protocol.Any> = T extends Protocol<
    any,
    infer RegisteredEventsFactoriesTuple
  >
    ? MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>
    : never

  /**
   * Create a protocol with a specific name and event factories.
   * @param protocolName - name of the protocol
   * @param registeredEventFactories - tuple of MachineEventFactories
   * @see MachineEvent.design to get started on creating MachineEventFactories for the registeredEventFactories parameter
   * @example
   * const hangarBay = Protocol.make("hangarBay")
   */
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
      registeredStateNames: new Set(),
      reactionMap: ReactionMap.make(),
    }

    const markStateNameAsUsed = (stateName: string) => {
      if (protocolInternal.registeredStateNames.has(stateName)) {
        throw new Error(`State "${stateName}" already registered within this protocol`)
      }
      protocolInternal.registeredStateNames.add(stateName)
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

    return {
      designState,
      designEmpty,
      tag,
    }
  }
}
