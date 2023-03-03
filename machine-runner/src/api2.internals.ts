import * as utils from './api2.utils.js'
import { Event } from './api2.events.js'
export { Event }

// State

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

// Payload

export type PayloadConstructor<Args extends any[], Payload extends any> = (...args: Args) => Payload

export type PayloadConstructorToArgs<T> = T extends PayloadConstructor<infer Args, infer _>
  ? Args
  : never

export type PayloadConstructorToPayload<T> = T extends PayloadConstructor<infer _, infer Payload>
  ? Payload
  : never

// Reaction

export type ReactionHandler<
  EventChainTrigger extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
> = (
  self: State<StateName, StatePayload>,
  events: Event.Factory.MapToPayload<EventChainTrigger>,
) => StateLensOpaque

export type Reaction<EventChainTrigger extends Event.Factory.NonZeroTuple> = {
  eventChainTrigger: EventChainTrigger
  handler: ReactionHandler<EventChainTrigger, any, any>
}

export namespace Reaction {
  export const design = <
    EventChainTrigger extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
  >(
    eventChainTrigger: EventChainTrigger,
    handler: ReactionHandler<EventChainTrigger, StateName, StatePayload>,
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

export type CommandContext = {
  someSystemCall: () => unknown
}

export type CommandDefiner<Args extends any[], Retval extends any> = (
  context: CommandContext,
  ...args: Args
) => Retval

export type CommandDefinerMap<
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandSignature<Args extends any[], Retval extends any> = (...args: Args) => Retval

export type CommandSignatureMap<Dictionary extends { [key: string]: CommandSignature<any, any> }> =
  {
    [key in keyof Dictionary]: Dictionary[key]
  }

// TODO: unit test,
export type ToCommandSignatureMap<Dictionary extends CommandDefinerMap<any>> = {
  [key in keyof Dictionary]: Dictionary[key] extends CommandDefiner<infer Args, infer Retval>
    ? CommandSignature<Args, Retval>
    : never
}

export const convertCommandMapToCommandSignatureMap = <T extends CommandDefinerMap<any>>(
  t: T,
  context: CommandContext,
): ToCommandSignatureMap<T> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(definer, context)]
    }),
  ) as ToCommandSignatureMap<T>
}

export const convertCommandDefinerToCommandSignature = <Args extends any[], Retval extends any>(
  definer: CommandDefiner<Args, Retval>,
  context: CommandContext,
): CommandSignature<Args, Retval> => {
  return (...args: Args) => definer(context, ...args)
}

type StateMechanismReactions = Reaction<Event.Factory.NonZeroTuple>[]

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandMapConstructor<Commands extends { [key: string]: any }> = {
  build: () => Commands
  addCommand: <Name extends string, Args extends any[], Retval extends any>(
    name: Name,
    command: CommandDefiner<Args, Retval>,
  ) => CommandMapConstructor<Commands & { [newCommandName in Name]: CommandDefiner<Args, Retval> }>
}
export namespace CommandMapConstructor {
  export const make = <Commands extends CommandMapPrototype<any>>(
    commands: Commands,
  ): CommandMapConstructor<Commands> => {
    return {
      build: () => commands,
      addCommand: (newCommandName, newCommand) =>
        make({
          ...commands,
          [newCommandName]: newCommand,
        }),
    }
  }
}

export type StateMechanismAny = StateMechanism<any, any, any, any, any>
export type StateMechanism<
  AllowedEvents extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends { [key: string]: CommandDefiner<any, any> },
> = {
  create: StateConstructor<StateName, StateArgs, StatePayload>

  commands: Commands

  reactions: Reaction<Event.Factory.NonZeroTuple>[]

  reactTo: (
    eventChainTrigger: utils.NonZeroTuple<Event.Factory.Reduce<AllowedEvents>>,
    handler: ReactionHandler<
      utils.NonZeroTuple<Event.Factory.Reduce<AllowedEvents>>,
      StateName,
      StatePayload
    >,
  ) => void

  patchCommands: <NewCommands extends { [key: string]: CommandDefiner<any, any> }>(
    commands: NewCommands,
  ) => StateMechanism<AllowedEvents, StateName, StateArgs, StatePayload, Commands & NewCommands>
  build: () => StateFactory<AllowedEvents, StateName, StateArgs, StatePayload, Commands>
}
export namespace StateMechanism {
  export const make = <
    AllowedEvents extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends { [key: string]: CommandDefiner<any, any> },
  >(
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
    props?: {
      signature?: Symbol
      commands?: Commands
      reactions?: StateMechanismReactions
    },
  ): StateMechanism<AllowedEvents, StateName, StateArgs, StatePayload, Commands> => {
    type Self = StateMechanism<AllowedEvents, StateName, StateArgs, StatePayload, Commands>

    const stateConstructor: Self['create'] = (...args) => ({
      type: stateName,
      payload: constructor(...args),
    })

    const commands: Self['commands'] = props?.commands || ({} as Commands)
    const reactions: Self['reactions'] = props?.reactions || []
    const reactTo: Self['reactTo'] = (eventChainTrigger, handler) => {
      reactions.push(Reaction.design(eventChainTrigger, handler))
    }
    const addCommand: Self['patchCommands'] = (newCommands) =>
      make(stateName, constructor, {
        commands: {
          ...commands,
          ...newCommands,
        },
        reactions,
      })

    const build: Self['build'] = () => StateFactory.fromMechanism(mechanism)

    const mechanism: Self = {
      create: stateConstructor,
      commands,
      reactions,
      reactTo,
      patchCommands: addCommand,
      build,
    }

    return mechanism
  }
}

export type StateFactoryFromMechanism<T extends StateMechanismAny> = T extends StateFactory<
  infer RegisteredEvents,
  infer Name,
  infer Args,
  infer Payload,
  infer Commands
>
  ? StateFactory<RegisteredEvents, Name, Args, Payload, Commands>
  : never
export type StateFactoryAny = StateFactory<any, any, any, any, any>
export type StateFactory<
  EventFactories extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandDefinerMap<any>,
> = {
  make: (...args: StateArgs) => StateLensOpaque
  getSymbol: () => Symbol
  getMechanism: () => StateMechanism<EventFactories, StateName, StateArgs, StatePayload, Commands>
}

export namespace StateFactory {
  export const fromMechanism = <
    EventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any>,
  >(
    mechanism: StateMechanism<EventFactories, StateName, StateArgs, StatePayload, Commands>,
  ) => {
    type Self = StateFactory<EventFactories, StateName, StateArgs, StatePayload, Commands>
    // TODO: to make it serializable, turn symbol into compile-consistent string
    const factorySymbol = Symbol()
    const factory: Self = {
      make: (...args: StateArgs) =>
        StateLensOpaque.fromFactory({
          factorySymbol,
          state: mechanism.create(...args),
        }),
      getSymbol: () => factorySymbol,
      getMechanism: () => mechanism,
    }
    return factory
  }
}

export type StateLensOpaque = {
  as: <
    EventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any>,
  >(
    factory: StateFactory<EventFactories, StateName, StateArgs, StatePayload, Commands>,
  ) => StateLens<StateName, StatePayload, ToCommandSignatureMap<Commands>> | null
}
export type StateLensInternals = {
  state: State<any, any>
  factorySymbol: Symbol
}
export namespace StateLensOpaque {
  export const fromFactory = (internals: StateLensInternals) => {
    const as = <
      EventFactories extends Event.Factory.NonZeroTuple,
      StateName extends string,
      StateArgs extends any[],
      StatePayload extends any,
      Commands extends CommandDefinerMap<any>,
    >(
      factory: StateFactory<EventFactories, StateName, StateArgs, StatePayload, Commands>,
    ): StateLens<StateName, StatePayload, ToCommandSignatureMap<Commands>> | null => {
      if (factory.getSymbol() === internals.factorySymbol) {
        // TODO: optimize
        const commands = convertCommandMapToCommandSignatureMap(factory.getMechanism().commands, {
          // TODO: think about context
          someSystemCall: () => 1,
        })
        return {
          get: () => internals.state,
          commands,
        }
      }
      return null
    }
    const self: StateLensOpaque = { as }
    return self
  }
}

export type StateLens<
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandSignatureMap<any>,
> = {
  get: () => State<StateName, StatePayload>
  commands: Commands
}

export type StateMechanismMap<
  Dictionary extends { [key: string]: StateMechanism<any, any, any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type ProtocolInternals<StateMechanism extends StateMechanismMap<{}>> = {
  mechanism: StateMechanism
}
