import { Tag } from '@actyx/sdk'
import { StateMechanism, MachineEvent, ProtocolInternals, ReactionMap } from './state.js'

export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  /**
   * Starts the design process for a state with payload.
   * Payload data will be required when constructing this state.
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
  ) => Protocol.DesignStateIntermediate<ProtocolName, RegisteredEventsFactoriesTuple, StateName>

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
   * Create a tag for the related protocol.
   * The resulting tag is typed to permit the protocol's events.
   * This tag type definition is required by `createMachineRunner`
   * @param rawTagString - optional string that is when not supplied defaults to the protocol's name.
   * @param extractId - @see actyx sdk Tag documentation for the explanation of extractId
   */
  tag: (
    rawTagString?: string,
    extractId?:
      | ((e: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>) => string)
      | undefined,
  ) => Tag<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>
}

/**
 * Set of utilities for designing a protocol
 * @see Protocol.make for getting started with using MachineRunner Protocol
 */
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
    /**
     * Declare type for a state
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
