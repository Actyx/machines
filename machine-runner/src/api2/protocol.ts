import {
  PayloadConstructor,
  StateMechanism,
  Event,
  ProtocolInternals,
  ReactionMap,
} from './state-machine.js'

// TODO: alternative protocol designer with builder pattern
export type Protocol<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
> = {
  // TODO: add NextState Factory type
  designState: <StateName extends string, StateArgs extends any[], StatePayload extends any>(
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
  ) => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    {}
  >

  designEmpty: <StateName extends string>(
    stateName: StateName,
  ) => StateMechanism<ProtocolName, RegisteredEventsFactoriesTuple, StateName, [], void, {}>

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

  export namespace StateUtils {
    export type Accepts<T extends {}> = (t: T) => T
    export const accepts =
      <T extends {}>(): Accepts<T> =>
      (t: T) =>
        t
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

    const designState: Self['designState'] = (stateName, constructor) =>
      StateMechanism.make(protocolInternal, stateName, constructor)

    const designEmpty: Self['designEmpty'] = (stateName) =>
      StateMechanism.make(protocolInternal, stateName, () => undefined)

    const internals: Self['internals'] = () => protocolInternal

    return {
      designState,
      designEmpty,
      internals,
    }
  }
}
