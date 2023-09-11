/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActyxEvent } from '@actyx/sdk'
import * as utils from '../utils/type-utils.js'
import { CommandDefiner, CommandDefinerMap } from './command.js'
import { Contained, MachineEvent } from './event.js'

export * from './command.js'
export * from './event.js'

export type CommandContext<Self, EmittedEventFactories extends MachineEvent.Factory.Any> = {
  self: Self
  /**
   * Attach tags to MachineEvents associated to this command
   * @param tags the tags that will be attached to the MachineEvents
   */
  withTags: <InputPayload extends MachineEvent.Payload.Of<EmittedEventFactories>>(
    tags: string[],
    payload: InputPayload,
  ) => Contained.ContainedPayload<InputPayload>
}

/**
 * @private not intended for use outside of actyx packages.
 */
export type StateRaw<Name extends string, Payload> = {
  type: Name
  payload: Payload
}

/**
 * @private not intended for use outside of actyx packages.
 */
export namespace StateRaw {
  export type Any = StateRaw<string, unknown>
}

export type ReactionHandler<EventChain extends ActyxEvent<MachineEvent.Any>[], Context, RetVal> = (
  context: Context,
  ...events: EventChain
) => RetVal

export type Reaction<Context> = {
  eventChainTrigger: Readonly<MachineEvent.Factory.Any[]>
  next: StateFactory.Any
  handler: ReactionHandler<ActyxEvent<MachineEvent.Any>[], Context, unknown>
}

export type ReactionContext<Self> = {
  self: Self
}

export type ReactionMapPerMechanism<Payload> = Map<string, Reaction<ReactionContext<Payload>>>

export type ReactionMap = {
  get: <Payload>(
    mechanism: StateMechanism<any, any, any, any, Payload, any>,
  ) => ReactionMapPerMechanism<Payload>
  getAll: () => Map<StateMechanism.Any, ReactionMapPerMechanism<any>>
  add: (
    now: StateMechanism.Any,
    triggers: Readonly<MachineEvent.Factory.Any[]>,
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

export type MachineProtocol<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
> = {
  readonly swarmName: SwarmProtocolName
  readonly name: MachineName
  readonly registeredEvents: MachineEventFactories[]
  readonly reactionMap: ReactionMap
  readonly commands: { ofState: string; commandName: string; events: string[] }[]
  readonly states: {
    readonly registeredNames: Set<string>
    readonly allFactories: Set<StateFactory.Any>
  }
}

export namespace MachineProtocol {
  export type Any = MachineProtocol<string, string, any>
}

export type StateMechanism<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<
    object,
    unknown[],
    Contained.ContainedEvent<MachineEvent.Any>[]
  >,
> = {
  readonly protocol: MachineProtocol<SwarmProtocolName, MachineName, MachineEventFactories>
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
   *   state.cast().commands()?.acceptDockingRequest("someShipId");
   * }
   */
  readonly command: <
    CommandName extends string,
    EmittedEventFactories extends utils.ReadonlyNonZeroTuple<MachineEventFactories>,
    CommandArgs extends unknown[],
  >(
    name: CommandName extends `_${string}` ? never : CommandName,
    events: EmittedEventFactories,
    handler: CommandDefiner<
      CommandContext<StatePayload, MachineEvent.Factory.Reduce<EmittedEventFactories>>,
      CommandArgs,
      MachineEvent.Factory.MapToPayloadOrContainedPayload<EmittedEventFactories>
    >,
  ) => StateMechanism<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands & {
      [key in CommandName]: CommandDefiner<
        CommandContext<StatePayload, MachineEvent.Factory.Reduce<EmittedEventFactories>>,
        CommandArgs,
        MachineEvent.Factory.MapToPayloadOrContainedPayload<EmittedEventFactories>
      >
    }
  >

  /**
   * Finalize state design process.
   * @returns a StateFactory
   */
  readonly finish: () => StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >
}

export namespace StateMechanism {
  export type Any = StateMechanism<string, string, MachineEvent.Factory.Any, string, any, any>
  export const make = <
    SwarmProtocolName extends string,
    MachineName extends string,
    MachineEventFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >(
    protocol: MachineProtocol<SwarmProtocolName, MachineName, MachineEventFactories>,
    stateName: StateName,
    props?: {
      commands?: Commands
      commandDataForAnalytics: { commandName: string; events: string[] }[]
    },
  ): StateMechanism<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  > => {
    type Self = StateMechanism<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
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

      if (name.startsWith('_')) {
        throw new Error("Command name cannot start with '_'")
      }

      type Params = Parameters<typeof commandDefinition>

      const patchedCommandDefinition = (...params: Params) => {
        // Payload is either 0 or factories.length. Therefore converting
        // payload to event this way is safe-ish
        const payloads = commandDefinition(...params)
        const events = payloads.map(
          (payloadOrContainedPayload, index): Contained.ContainedEvent<MachineEvent.Any> => {
            const factory = factories[index]

            const [payload, extraData] =
              Contained.ContainedPayload.extract(payloadOrContainedPayload)

            return [factory.make(payload), extraData]
          },
        )

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
        commandDataForAnalytics: [
          ...(props?.commandDataForAnalytics || []),
          {
            events: factories.map((eventFactory) => eventFactory.type),
            commandName: name,
          },
        ],
      })
    }

    const finish: Self['finish'] = () => {
      const factory = StateFactory.fromMechanism(mechanism)
      protocol.states.allFactories.add(factory)
      protocol.commands.push(
        ...(props?.commandDataForAnalytics || []).map(
          (item: { commandName: string; events: string[] }) => ({
            ...item,
            ofState: mechanism.name,
          }),
        ),
      )
      return factory
    }

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
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = {
  /**
   * Helper to create a state payload to match the constraint of the state type.
   * @see react for more example.
   */
  make: (payload: StatePayload) => StatePayload

  symbol: () => symbol

  readonly mechanism: StateMechanism<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
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
    EventFactoriesChain extends utils.ReadonlyNonZeroTuple<MachineEventFactories>,
    NextPayload,
  >(
    eventChainTrigger: EventFactoriesChain,
    nextFactory: StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      string,
      NextPayload,
      any
    >,
    handler: ReactionHandler<
      MachineEvent.Factory.MapToActyxEvent<EventFactoriesChain>,
      ReactionContext<StatePayload>,
      NextPayload
    >,
  ) => void

  reactIntoSelf: <EventFactoriesChain extends utils.ReadonlyNonZeroTuple<MachineEventFactories>>(
    eventChainTrigger: EventFactoriesChain,
    handler: ReactionHandler<
      MachineEvent.Factory.MapToActyxEvent<EventFactoriesChain>,
      ReactionContext<StatePayload>,
      void
    >,
  ) => void
}

export namespace StateFactory {
  export type Minim = StateFactory<
    any,
    any,
    MachineEvent.Factory.Any,
    string,
    any[],
    CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>
  >
  export type Any = StateFactory<any, any, any, any, any, any>

  export type PayloadOf<T extends StateFactory.Any> = T extends StateFactory<
    any,
    any,
    any,
    any,
    infer Payload,
    any
  >
    ? Payload
    : never

  export type ReduceIntoPayload<
    F extends Readonly<StateFactory.Any[]>,
    UNION extends unknown = never,
  > = F extends Readonly<
    [
      StateFactory<any, any, any, any, infer Payload, any>,
      ...infer Rest extends Readonly<StateFactory.Any[]>,
    ]
  >
    ? ReduceIntoPayload<Rest, UNION | Payload>
    : UNION

  export const fromMechanism = <
    SwarmProtocolName extends string,
    MachineName extends string,
    MachineEventFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >(
    mechanism: StateMechanism<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      StateName,
      StatePayload,
      Commands
    >,
  ) => {
    type Self = StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
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

    const reactIntoSelf: Self['reactIntoSelf'] = (eventChainTrigger, handler) =>
      react(eventChainTrigger, self, (ctx, ...params): StatePayload => {
        handler(ctx, ...params)
        return ctx.self
      })

    const make: Self['make'] = (payload) => payload

    const self: Self = {
      react,
      reactIntoSelf,
      make,
      mechanism,
      symbol: () => factorySymbol,
    }
    return self
  }
}
