import * as utils from '../utils/type-utils.js'
import { CommandDefiner, CommandDefinerMap } from './command.js'
import { Event } from './event.js'

export * from './command.js'
export * from './event.js'

export type State<Name extends string, Payload extends any> = {
  type: Name
  payload: Payload
}

export namespace State {
  export type Any = State<string, any>
}

export type ReactionHandler<EventChain extends Event.Any[], Context, RetVal extends any> = (
  context: Context,
  events: EventChain,
) => RetVal

export type Reaction<Context> = {
  eventChainTrigger: Event.Factory.Any[]
  next: StateFactory.Any
  handler: ReactionHandler<Event.Any[], Context, unknown>
}

export type ReactionContext<Self> = {
  self: Self
}

export type ReactionMapPerMechanism<Payload> = Map<string, Reaction<ReactionContext<Payload>>>

export type ReactionMap = {
  get: <Payload extends any>(
    mechanism: StateMechanism<any, any, any, Payload, any>,
  ) => ReactionMapPerMechanism<Payload>
  getAll: () => Map<StateMechanism.Any, ReactionMapPerMechanism<any>>
  add: (
    now: StateMechanism.Any,
    triggers: Event.Factory.Any[],
    next: StateFactory.Any,
    reaction: ReactionHandler<Event.Any[], ReactionContext<any>, unknown>,
  ) => void
}

export namespace ReactionMap {
  export const make = (): ReactionMap => {
    const innerMap = new Map<StateMechanism.Any, ReactionMapPerMechanism<any>>()

    const getAll: ReactionMap['getAll'] = () => innerMap

    const get: ReactionMap['get'] = (mechanism) => {
      const reactions = innerMap.get(mechanism) || new Map()
      innerMap.set(mechanism, reactions)
      return reactions
    }

    const add: ReactionMap['add'] = (now, triggers, next, handler) => {
      const mapPerMechanism = get(now)
      const firstTrigger = triggers[0]
      mapPerMechanism.set(firstTrigger.type, { eventChainTrigger: triggers, next, handler })
    }

    return {
      getAll,
      get,
      add,
    }
  }
}

export type ProtocolInternals<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
> = {
  readonly name: ProtocolName
  readonly registeredEvents: RegisteredEventsFactoriesTuple
  readonly registeredStateNames: Set<string>
  readonly reactionMap: ReactionMap
}

export namespace ProtocolInternals {
  export type Any = ProtocolInternals<any, any>
}

export type StateMechanism<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  readonly protocol: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>
  readonly name: StateName
  readonly commands: Commands

  readonly command: <
    CommandName extends string,
    AcceptedEventFactories extends utils.NonZeroTuple<
      Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    CommandArgs extends any[],
  >(
    name: CommandName,
    events: AcceptedEventFactories,
    handler: CommandDefiner<
      StatePayload,
      CommandArgs,
      Event.Factory.MapToPayload<AcceptedEventFactories>
    >,
  ) => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands & {
      [key in CommandName]: CommandDefiner<
        StatePayload,
        CommandArgs,
        Event.Factory.MapToPayload<AcceptedEventFactories>
      >
    }
  >

  readonly finish: () => StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >
}

export namespace StateMechanism {
  export type Any = StateMechanism<any, any, any, any, any>
  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    protocol: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>,
    stateName: StateName,
    props?: {
      commands?: Commands
    },
  ): StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  > => {
    type Self = StateMechanism<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >

    const commands: Self['commands'] = props?.commands || ({} as Commands)

    const command: Self['command'] = (name, factories, commandDefinition) => {
      // TODO: make this more sturdy
      // commandDefinition now is supposed to be returning event payload
      // and the patched commandDefinition here

      type Params = Parameters<typeof commandDefinition>

      const patchedCommandDefinition = (...params: Params) => {
        // Payload is either 0 or factories.length
        // Therefore converting payload to event this way is safe-ish
        const payloads = commandDefinition(...params)
        const events = payloads.map((payload, index) => {
          const factory = factories[index]
          const event = factory.make(payload)
          return event
        })

        return events
      }

      return make(protocol, stateName, {
        commands: {
          ...commands,

          // TODO: continuing "sturdyness" note above
          // This part is eventually used by convertCommandMapToCommandSignatureMap
          // (find "convertCommandMapToCommandSignatureMap" in the StateContainer's code)
          // "convertCommandMapToCommandSignatureMap" doesn't understand that non-patched commandDefinition
          // is not returning events, but payloads.
          // Therefore, changing this line and the patchedCommandDefinition above may break the library
          [name]: patchedCommandDefinition,
        },
      })
    }

    const finish: Self['finish'] = () => StateFactory.fromMechanism(mechanism)

    const mechanism: Self = {
      protocol,
      name: stateName,
      commands,
      command,
      finish,
    }

    return mechanism
  }
}

// TODO: rename
// ==================================
// StateFactory
// ==================================

export type StateFactoryFromMechanism<T extends StateMechanism.Any> = T extends StateFactory<
  infer ProtocolName,
  infer RegisteredEventsFactoriesTuple,
  infer StateName,
  infer StatePayload,
  infer Commands
>
  ? StateFactory<ProtocolName, RegisteredEventsFactoriesTuple, StateName, StatePayload, Commands>
  : never

export type StateFactory<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  make: (payload: StatePayload) => StatePayload
  symbol: () => Symbol
  readonly mechanism: StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >

  react: <
    EventFactoriesChain extends utils.NonZeroTuple<
      Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    NextPayload extends any,
  >(
    eventChainTrigger: EventFactoriesChain,
    nextFactory: StateFactory<ProtocolName, RegisteredEventsFactoriesTuple, any, NextPayload, any>,
    handler: ReactionHandler<
      Event.Factory.MapToEvent<EventFactoriesChain>,
      ReactionContext<StatePayload>,
      NextPayload
    >,
  ) => void
}

export namespace StateFactory {
  export type Minim = StateFactory<
    any,
    Event.Factory.NonZeroTuple,
    string,
    any[],
    CommandDefinerMap<any, any, Event.Any[]>
  >
  export type Any = StateFactory<any, any, any, any, any>

  export type PayloadOf<T extends StateFactory.Any> = T extends StateFactory<
    any,
    any,
    any,
    infer Payload,
    any
  >
    ? Payload
    : never

  export const fromMechanism = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    mechanism: StateMechanism<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >,
  ) => {
    type Self = StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StatePayload,
      Commands
    >
    // TODO: to make it serializable, turn symbol into compile-consistent string
    const factorySymbol = Symbol(mechanism.name)
    const react: Self['react'] = (eventChainTrigger, nextFactory, handler) => {
      // TODO: remove "as any", fix issue with suspicious typing error:
      // Type 'Any[]' is not assignable to type 'LooseMapToEvent<EventFactoriesChain>'
      mechanism.protocol.reactionMap.add(mechanism, eventChainTrigger, nextFactory, handler as any)
    }

    const make: Self['make'] = (payload) => payload

    const self: Self = {
      react,
      make,
      mechanism,
      symbol: () => factorySymbol,
    }
    return self
  }
}
