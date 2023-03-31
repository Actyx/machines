import { ActyxEvent } from '@actyx/sdk'
import * as utils from '../utils/type-utils.js'
import { CommandDefiner, CommandDefinerMap } from './command.js'
import { MachineEvent } from './event.js'

export * from './command.js'
export * from './event.js'

/**
 * @private not intended for use outside of actyx packages
 */
export type StateRaw<Name extends string, Payload> = {
  type: Name
  payload: Payload
}

/**
 * @private not intended for use outside of actyx packages
 */
export namespace StateRaw {
  export type Any = StateRaw<string, unknown>
}

export type ReactionHandler<EventChain extends ActyxEvent<MachineEvent.Any>[], Context, RetVal> = (
  context: Context,
  ...events: EventChain
) => RetVal

export type Reaction<Context> = {
  eventChainTrigger: MachineEvent.Factory.Any[]
  next: StateFactory.Any
  handler: ReactionHandler<ActyxEvent<MachineEvent.Any>[], Context, unknown>
}

export type ReactionContext<Self> = {
  self: Self
}

export type ReactionMapPerMechanism<Payload> = Map<string, Reaction<ReactionContext<Payload>>>

export type ReactionMap = {
  get: <Payload>(
    mechanism: StateMechanism<any, any, any, Payload, any>,
  ) => ReactionMapPerMechanism<Payload>
  getAll: () => Map<StateMechanism.Any, ReactionMapPerMechanism<any>>
  add: (
    now: StateMechanism.Any,
    triggers: MachineEvent.Factory.Any[],
    next: StateFactory.Any,
    reaction: ReactionHandler<ActyxEvent<MachineEvent.Any>[], ReactionContext<any>, unknown>,
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

      if (mapPerMechanism.has(firstTrigger.type)) {
        throw new Error(
          `${firstTrigger.type} has been registered as a reaction guard for this state.`,
        )
      }

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
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
> = {
  readonly name: ProtocolName
  readonly registeredEvents: RegisteredEventsFactoriesTuple
  readonly registeredStateNames: Set<string>
  readonly reactionMap: ReactionMap
}

export namespace ProtocolInternals {
  export type Any = ProtocolInternals<string, any>
}

export type StateMechanism<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<object, unknown[], MachineEvent.Any[]>,
> = {
  readonly protocol: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>
  readonly name: StateName
  readonly commands: Commands
  /**
   * Attach a command to a state. The attached commands are available when a
   * MachineRunner is in that particular state. Note that a command will not
   * automatically trigger a state change. A reaction must be defined to
   * properly trigger a state change.
   * @see StateFactory.react on how to define a reaction
   * @example
   * const HangarControlIdle = protocol
   *   .designState("HangarControlIdle")
   *   .withPayload<{
   *     dockingRequests: { shipId: string, at: Date }[]
   *   }>()
   *   .command('acceptDockingRequest', [DockingRequestAccepted], (context, shipId: string) => [
   *     DockingRequestAccepted.make({
   *       shipId
   *     })
   *   ])
   *   .finish()
   * // When a machine is in a certain state, the commands are available at runtime.
   * // TypeScript type hints for the command's parameters are available
   * const state = machine.get(); // machine is an instance of MachineRunner
   * if (state.is(HangarControlIdle)) {
   *   state.cast().commands?.acceptDockingRequest("someShipId");
   * }
   */
  readonly command: <
    CommandName extends string,
    AcceptedEventFactories extends utils.NonZeroTuple<
      MachineEvent.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    CommandArgs extends unknown[],
  >(
    name: CommandName,
    events: AcceptedEventFactories,
    handler: CommandDefiner<
      StatePayload,
      CommandArgs,
      MachineEvent.Factory.MapToPayload<AcceptedEventFactories>
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
        MachineEvent.Factory.MapToPayload<AcceptedEventFactories>
      >
    }
  >

  /**
   * Finalize state design process
   * @returns a StateFactory
   */
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
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
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
      //
      // commandDefinition now is supposed to be returning event payload and the
      // patched commandDefinition here

      type Params = Parameters<typeof commandDefinition>

      const patchedCommandDefinition = (...params: Params) => {
        // Payload is either 0 or factories.length. Therefore converting
        // payload to event this way is safe-ish
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

          // TODO: continuing "sturdyness" note above.
          //
          // This part is eventually used by
          // convertCommandMapToCommandSignatureMap (find
          // "convertCommandMapToCommandSignatureMap" in the StateContainer's
          // code) "convertCommandMapToCommandSignatureMap" doesn't understand
          // that non-patched commandDefinition is not returning events, but
          // payloads.
          //
          // Therefore, changing this line and the patchedCommandDefinition
          // above may break the library
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

/**
 * A reference to a state. A StateFactory is used for determining if a snapshot
 * of a state is of a particular type and as a notation for the "next-state" of
 * a reaction.
 */
export type StateFactory<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
> = {
  /**
   * Helper to create a state payload to match the constraint of the state type
   * @see react for more example
   */
  make: (payload: StatePayload) => StatePayload

  symbol: () => symbol

  readonly mechanism: StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StatePayload,
    Commands
  >

  /**
   * Add a reaction to a set of incoming events for a particular state. A
   * reaction is a computation that MAY result in a state transition or a
   * self-mutation.
   * @example
   * HangarControlIdle
   *   .react([IncomingDockingRequest], HangarControlIdle, (context, request) => {
   *     context.self.dockingRequests.push({ shipId: request.shipId, at: new Date() })
   *   })
   * @example
   * HangarControlIdle
   *   .react(
   *     [DockingRequestAccepted],
   *     HangarControlDocking,
   *     (context, accepted) => HangarControlDocking.make({
   *       shipId: accepted.shipId
   *     })
   *   )
   */
  react: <
    EventFactoriesChain extends utils.NonZeroTuple<
      MachineEvent.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    NextPayload,
  >(
    eventChainTrigger: EventFactoriesChain,
    nextFactory: StateFactory<ProtocolName, RegisteredEventsFactoriesTuple, any, NextPayload, any>,
    handler: ReactionHandler<
      MachineEvent.Factory.MapToActyxEvent<EventFactoriesChain>,
      ReactionContext<StatePayload>,
      NextPayload
    >,
  ) => void
}

export namespace StateFactory {
  export type Minim = StateFactory<
    any,
    MachineEvent.Factory.NonZeroTuple,
    string,
    any[],
    CommandDefinerMap<any, any, MachineEvent.Any[]>
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
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
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
    const factorySymbol = Symbol(mechanism.name)
    const react: Self['react'] = (eventChainTrigger, nextFactory, handler) => {
      // TODO: remove "as any", fix issue with suspicious typing error:
      // Type 'Any[]' is not assignable to type 'LooseMapToActyxEvent<EventFactoriesChain>'
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
