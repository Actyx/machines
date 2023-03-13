import { StateMechanism, Event, ProtocolInternals, ReactionMap } from './state-machine.js'

// TODO: alternative protocol designer with builder pattern
export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
> = {
  // TODO: add NextState Factory type
  designState: <StateName extends string>(
    stateName: StateName,
  ) => Protocol.DesignStateIntermediate<ProtocolName, RegisteredEventsFactoriesTuple, StateName>

  designEmpty: <StateName extends string>(
    stateName: StateName,
  ) => StateMechanism<ProtocolName, RegisteredEventsFactoriesTuple, StateName, void, {}>

  internals: () => Readonly<ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>>
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
      {}
    >
  }

  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  >(
    protocolName: ProtocolName,
    registeredEventFactories: RegisteredEventsFactoriesTuple,
  ) => makeProtocolDesigner(protocolName, registeredEventFactories)

  const makeProtocolDesigner = <
    ProtocolName extends string,
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
  >(
    protocolName: ProtocolName,
    registeredEvents: EventFactoriesTuple,
  ): Protocol<ProtocolName, EventFactoriesTuple> => {
    type Self = Protocol<ProtocolName, EventFactoriesTuple>
    type Internals = ProtocolInternals<ProtocolName, EventFactoriesTuple>
    const protocolInternal: Internals = {
      name: protocolName,
      registeredEvents,
      reactionMap: ReactionMap.make(),
    }

    const designState: Self['designState'] = (stateName) => ({
      withPayload: () => StateMechanism.make(protocolInternal, stateName),
    })

    const designEmpty: Self['designEmpty'] = (stateName) =>
      StateMechanism.make(protocolInternal, stateName)

    const internals: Self['internals'] = () => protocolInternal

    return {
      designState,
      designEmpty,
      internals,
    }
  }
}
