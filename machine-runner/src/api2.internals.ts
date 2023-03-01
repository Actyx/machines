import * as utils from './api2.utils.js'

export type StateConstructor<Name extends string, Args extends any[], Payload extends any> = (
  ...args: Args
) => State<Name, Payload>

export type State<Name extends string, Payload extends any> = {
  type: Name
  payload: Payload
}

export type StateConstructorToPayloadConstructor<T> = T extends StateConstructor<
  infer _,
  infer Args,
  infer Payload
>
  ? PayloadConstructor<Args, Payload>
  : never

export type PayloadConstructor<Args extends any[], Payload extends any> = (...args: Args) => Payload

export type PayloadConstructorToArgs<T> = T extends PayloadConstructor<infer Args, infer _>
  ? Args
  : never

export type PayloadConstructorToPayload<T> = T extends PayloadConstructor<infer _, infer Payload>
  ? Payload
  : never

export type EventMapPrototype<
  Dictionary extends { [key: string]: StateConstructor<any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type Event<Key extends string, Payload extends any> = {
  type: Key
  payload: Payload
}
export namespace Event {
  export const KEY_GETTER_SYMBOL: unique symbol = Symbol()

  export type Factory<Key extends string, Payload extends any> = {
    [KEY_GETTER_SYMBOL]: Key
    new: (payload: Payload) => Event<Key, Payload>
  }

  type EventFactoryIntermediate<Key extends string> = {
    withPayload: <Payload extends any>() => Factory<Key, Payload>
  }

  export namespace Factory {
    export type NonZeroTuple = utils.NonZeroTuple<Factory<any, any>>

    // =====
    type LooseMapToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [Event<Key, Payload>, ...LooseMapToEvent<Rest>]
      : []

    export type MapToEvent<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseMapToEvent<T>

    // =====
    type LooseMapToPayload<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [ToPayload<Event<Key, Payload>>, ...LooseMapToPayload<Rest>]
      : []

    export type MapToPayload<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseMapToPayload<T>

    // =====
    type LooseReduce<T extends any[]> = T extends [Factory<infer Key, infer Payload>, ...infer Rest]
      ? Factory<Key, Payload> | LooseReduce<Rest>
      : never

    export type Reduce<T extends [Factory<any, any>, ...Factory<any, any>[]]> = LooseReduce<T>

    // =====
    type LooseReduceToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? Event<Key, Payload> | LooseReduceToEvent<Rest>
      : never

    export type ReduceToEvent<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseReduceToEvent<T>
  }

  // Map Types

  export type ToPayload<T extends Event<any, any>> = T extends Event<any, infer Payload>
    ? Payload
    : never

  export const design = <Key extends string>(key: Key): EventFactoryIntermediate<Key> => ({
    withPayload: () => ({
      [KEY_GETTER_SYMBOL]: key,
      new: (payload) => ({
        type: key,
        payload,
      }),
    }),
  })
}

export type ReactionHandler<
  EventChainTrigger extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
> = (events: Event.Factory.MapToPayload<EventChainTrigger>) => void
export type Reaction<
  EventChainTrigger extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
> = {
  eventChainTrigger: EventChainTrigger
  handler: ReactionHandler<EventChainTrigger>
}
export namespace Reaction {
  export const design = <
    EventChainTrigger extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
  >(
    eventChainTrigger: EventChainTrigger,
    handler: ReactionHandler<EventChainTrigger>,
  ): Reaction<EventChainTrigger> => {
    return {
      eventChainTrigger: eventChainTrigger,
      handler,
    }
  }
}

export type ReactionMapPrototype<Dictionary extends { [key: string]: Reaction<any> }> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandFn<Args extends any[]> = (
  ...args: Args
) => [Event<any, any>, ...Event<any, any>[]]

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
type StateMechanismReactions = Reaction<[Event.Factory<any, any>, ...Event.Factory<any, any>[]]>[]
export type StateMechanism<
  EF extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandMapPrototype<any>,
> = {
  create: StateConstructor<StateName, StateArgs, StatePayload>
  commands: Commands
  reactions: Reaction<[Event.Factory<any, any>, ...Event.Factory<any, any>[]]>[]
  addReaction: <EventChainTrigger extends utils.NonZeroTuple<Event.Factory.Reduce<EF>>>(
    eventChainTrigger: EventChainTrigger,
    handler: ReactionHandler<EventChainTrigger>,
  ) => StateMechanism<EF, StateName, StateArgs, StatePayload, Commands>

  addCommand: <CommandName extends string, CommandArgs extends any[]>(
    name: CommandName,
    command: CommandFn<CommandArgs>,
  ) => StateMechanism<
    EF,
    StateName,
    StateArgs,
    StatePayload,
    Commands & { [name in CommandName]: CommandFn<CommandArgs> }
  >
}
export namespace StateMechanism {
  export const make = <
    AllowedEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
    Name extends string,
    Args extends any[],
    Payload extends any,
    Commands extends CommandMapPrototype<any>,
  >(
    stateName: Name,
    constructor: PayloadConstructor<Args, Payload>,
    props?: {
      commands?: Commands
      reactions?: StateMechanismReactions
    },
  ): StateMechanism<AllowedEvents, Name, Args, Payload, Commands> => {
    type Self = StateMechanism<AllowedEvents, Name, Args, Payload, Commands>

    const stateConstructor: StateConstructor<
      typeof stateName,
      PayloadConstructorToArgs<typeof constructor>,
      PayloadConstructorToPayload<typeof constructor>
    > = (...args: Parameters<typeof constructor>) => ({
      type: stateName,
      payload: constructor(...args),
    })

    const commands: Self['commands'] = props?.commands || ({} as Commands)
    const reactions: Self['reactions'] = props?.reactions || []
    const addReaction: Self['addReaction'] = (eventChainTrigger, handler) =>
      make(stateName, constructor, {
        commands,
        reactions: [...reactions, Reaction.design(eventChainTrigger, handler)],
      })
    const addCommand: Self['addCommand'] = (commandName, newCommand) =>
      make(stateName, constructor, {
        commands: { ...commands, [commandName]: newCommand },
        reactions,
      })
    return {
      create: stateConstructor,
      commands,
      reactions,
      addReaction,
      addCommand,
    }
  }
}

export type StateMechanismMap<
  Dictionary extends { [key: string]: StateMechanism<any, any, any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type ProtocolInternals<StateMechanism extends StateMechanismMap<{}>> = {
  mechanism: StateMechanism
}
