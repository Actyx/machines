import { StateMechanism, Event, ProtocolInternals, ReactionMap } from './state.js'

export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
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
}

export namespace Protocol {
  export type Any = Protocol<any, any>

  export type EventsOf<T extends Protocol.Any> = T extends Protocol<
    any,
    infer RegisteredEventsFactoriesTuple
  >
    ? Event.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>
    : never

  export type DesignStateIntermediate<
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
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
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
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

    return {
      designState,
      designEmpty,
    }
  }
}
