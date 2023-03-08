import { ActyxEvent } from '@actyx/sdk/lib/types/index.js'
import * as utils from '../api2utils/type-utils.js'
import {
  CommandDefiner,
  CommandDefinerMap,
  convertCommandMapToCommandSignatureMap,
  ToCommandSignatureMap,
} from './command.js'
import { Event } from './event.js'
import { PayloadConstructor, State, StateConstructor } from './state-raw.js'
import { deepCopy } from '../runner.js'
import { Obs } from '../api2.js'

export * from './state-raw.js'
export * from './command.js'
export * from './event.js'

export type ReactionHandler<EventChain extends Event.Any[], Context, RetVal> = (
  context: Context,
  events: EventChain,
) => RetVal

export type Reaction<Context> = {
  eventChainTrigger: Event.Factory.Any[]
  next: StateFactory.Any
  handler: ReactionHandler<Event.Any[], Context, StateContainer.Any>
}

export type ReactionContext<Self> = {
  self: Self
}

export type ReactionMap = {
  get: <Payload extends any>(
    mechanism: StateMechanism<any, any, any, any, Payload, any>,
  ) => Reaction<ReactionContext<Payload>>[]
  getAll: () => Reaction<any>[]
  add: (
    now: StateMechanism<any, any, any, any, any, any>,
    triggers: Event.Factory.Any[],
    next: StateFactory.Any,
    reaction: ReactionHandler<Event.Any[], ReactionContext<any>, StateContainer.Any>,
  ) => void
}

export namespace ReactionMap {
  export const make = (): ReactionMap => {
    const innerMap = new Map<
      StateMechanism<any, any, any, any, any, any>,
      Reaction<ReactionContext<any>>[]
    >()

    const getAll: ReactionMap['getAll'] = () =>
      Array.from(innerMap.values()).reduce((acc, item) => acc.concat(item), [])
    const get: ReactionMap['get'] = (mechanism) => {
      const reactions = innerMap.get(mechanism) || []
      return reactions
    }

    const add: ReactionMap['add'] = (now, triggers, next, handler) => {
      const list = get(now)
      list.push({
        eventChainTrigger: triggers,
        next,
        handler,
      })
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
  readonly reactionMap: ReactionMap
}

export namespace ProtocolInternals {
  export type Any = ProtocolInternals<any, any>
}

// TODO: rename
// ==================================
// StateMechanism
// ==================================

export type StateMechanismAny = StateMechanism<any, any, any, any, any, any>
export type StateMechanism<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends {
    [key in keyof Commands]: CommandDefiner<
      StatePayload,
      any,
      Event.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>[]
    >
  },
> = {
  readonly protocol: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>

  readonly name: StateName

  constructor: StateConstructor<StateName, StateArgs, StatePayload>

  commands: Commands

  // reactions: StateMechanismReaction<Event.Factory.Any[], Event.Any[], StatePayload>[]

  // react: <
  //   EventFactoriesChain extends utils.NonZeroTuple<
  //     Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
  //   >,
  //   NextFactory extends StateFactory.Any,
  // >(
  //   eventChainTrigger: EventFactoriesChain,
  //   nextFactory: NextFactory,
  //   handler: ReactionHandler<
  //     Event.Factory.MapToEvent<EventFactoriesChain>,
  //     StatePayload,
  //     StateContainer.Of<NextFactory>
  //   >,
  // ) => StateMechanism<RegisteredEventsFactoriesTuple, StateName, StateArgs, StatePayload, Commands>

  command: <
    CommandName extends string,
    AcceptedEventFactories extends utils.NonZeroTuple<
      Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    CommandArgs extends any[],
    CommandFn extends CommandDefiner<
      StatePayload,
      CommandArgs,
      Event.Factory.MapToEvent<AcceptedEventFactories>
    >,
  >(
    name: CommandName,
    events: AcceptedEventFactories,
    commands: CommandFn,
  ) => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands & {
      [key in CommandName]: CommandFn
    }
  >

  finish: () => StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
}

export namespace StateMechanism {
  export const make = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends {
      [key: string]: CommandDefiner<StatePayload, any, any>
    },
  >(
    protocol: ProtocolInternals<ProtocolName, RegisteredEventsFactoriesTuple>,
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
    props?: {
      commands?: Commands
    },
  ): StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  > => {
    type Self = StateMechanism<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >

    const stateConstructor: Self['constructor'] = (...args) => ({
      type: stateName,
      payload: constructor(...args),
    })

    const commands: Self['commands'] = props?.commands || ({} as Commands)

    const command: Self['command'] = (name, events, commandDefinition) =>
      make(protocol, stateName, constructor, {
        commands: {
          ...commands,
          [name]: commandDefinition,
        },
      })

    const finish: Self['finish'] = () => StateFactory.fromMechanism(mechanism)

    const mechanism: Self = {
      protocol,
      name: stateName,
      constructor: stateConstructor,
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

export type StateFactoryFromMechanism<T extends StateMechanismAny> = T extends StateFactory<
  infer ProtocolName,
  infer RegisteredEventsFactoriesTuple,
  infer StateName,
  infer StateArgs,
  infer StatePayload,
  infer Commands
>
  ? StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >
  : never

export type StateFactory<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  make: (
    ...args: StateArgs
  ) => StateContainer<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
  symbol: () => Symbol
  mechanism: () => StateMechanism<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >

  react: <
    EventFactoriesChain extends utils.NonZeroTuple<
      Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
    >,
    NextFactory extends StateFactory.Any,
  >(
    eventChainTrigger: EventFactoriesChain,
    nextFactory: NextFactory,
    handler: ReactionHandler<
      Event.Factory.MapToEvent<EventFactoriesChain>,
      ReactionContext<StatePayload>,
      StateContainer.Of<NextFactory>
    >,
  ) => StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >

  makeOpaque: (...args: StateArgs) => StateContainerOpaque
}

export namespace StateFactory {
  export type Minim = StateFactory<
    any,
    Event.Factory.NonZeroTuple,
    string,
    any[],
    any,
    CommandDefinerMap<any, any, Event.Any[]>
  >
  export type Any = StateFactory<any, any, any, any, any, any>
  export const fromMechanism = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    mechanism: StateMechanism<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
  ) => {
    type Self = StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >
    // TODO: to make it serializable, turn symbol into compile-consistent string
    const factorySymbol = Symbol(mechanism.name)
    const react: Self['react'] = <
      EventFactoriesChain extends utils.NonZeroTuple<
        Event.Factory.Reduce<RegisteredEventsFactoriesTuple>
      >,
      NextFactory extends StateFactory.Any,
    >(
      eventChainTrigger: EventFactoriesChain,
      nextFactory: NextFactory,
      handler: ReactionHandler<
        Event.Factory.MapToEvent<EventFactoriesChain>,
        ReactionContext<StatePayload>,
        StateContainer.Of<NextFactory>
      >,
    ) => {
      mechanism.protocol.reactionMap.add(mechanism, eventChainTrigger, nextFactory, handler as any)
      return self
    }

    const make: Self['make'] = (...args) =>
      StateContainer.fromFactory({
        factory: self,
        state: {
          type: mechanism.name,
          payload: mechanism.constructor(...args),
        },
      })

    const makeOpaque: Self['makeOpaque'] = (...args) => {
      const container = make(...args)
      return StateContainerOpaque.fromStateContainer(container)
    }

    const self: Self = {
      react,
      make,
      makeOpaque,
      symbol: () => factorySymbol,
      mechanism: () => mechanism,
    }
    return self
  }
}

// TODO: rename
// ==================================
// StateLensCommon
// ==================================

export type StateContainerData<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  factory: StateFactory<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
  state: State<any, any>
}

export type StateContainerInternals<
  ProtocolName extends string,
  RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  readonly initial: StateContainerData<any, any, any, any, any, any>
  current: StateContainerData<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
  queue: ActyxEvent<Event.Any>[]
  obs: Obs<Event.Any[]>
}

export namespace StateContainerInternals {
  export const ACCESSOR: unique symbol = Symbol('StateContainerInternals/ACCESSOR')

  // export type Minim = StateContainerInternals<
  //   string,
  //   Event.Factory.NonZeroTuple,
  //   string,
  //   any[],
  //   any,
  //   CommandDefinerMap<any, any, Event.Any[]>
  // >
  export type Any = StateContainerInternals<any, any, any, any, any, any>

  export const matchToFactory = <
    ProtocolName extends string,
    EventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<
      ProtocolName,
      EventFactories,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
    internal: StateContainerInternals.Any,
  ): internal is StateContainerInternals<
    ProtocolName,
    EventFactories,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  > => {
    if (internal.current.factory === factory) {
      return true
    }
    return false
  }
}

/**
 * For optimization purpose
 * Huge closure creation may have reduced performance in different JS engines
 */
export namespace StateContainerCommon {
  export namespace ReactionMatchResult {
    export type All = TotalMatch | PartialMatch

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B, ..., C]
    export type TotalMatch = typeof TotalMatch
    export const TotalMatch: unique symbol = Symbol('TotalMatch')

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B]
    export type PartialMatch = typeof PartialMatch
    export const PartialMatch: unique symbol = Symbol('PartialMatch')
  }

  // TODO: unit test
  const matchReaction = <Self>(
    reaction: Reaction<Self>,
    queue: ActyxEvent<Event.Any>[],
  ): {
    result: ReactionMatchResult.All | null
    orphans: ActyxEvent<Event.Any>[]
    matching: Event.Any[]
  } => {
    const queueClone = [...queue]
    const matchingEventSequence = []
    const orphanEventSequence = []

    const result = (() => {
      for (const [index, trigger] of reaction.eventChainTrigger.entries()) {
        const matchingEvent = (() => {
          while (queueClone.length > 0) {
            const actyxEvent = queueClone.shift()
            if (actyxEvent) {
              if (actyxEvent.payload.type === trigger.type) {
                return actyxEvent.payload
              } else {
                orphanEventSequence.push(actyxEvent)
              }
            }
          }
          return null
        })()

        if (matchingEvent !== null) {
          matchingEventSequence.push(matchingEvent)
          continue
        } else {
          if (index > 0) return ReactionMatchResult.PartialMatch
          if (index === 0) return null
        }
      }

      return ReactionMatchResult.TotalMatch
    })()

    return {
      result,
      orphans: orphanEventSequence,
      matching: matchingEventSequence,
    }
  }

  export namespace ReactionHandling {
    export type Queue = typeof Queue
    export const Queue: unique symbol = Symbol('Queue')

    export type Discard = typeof Discard
    export const Discard: unique symbol = Symbol('Discard')

    export type Execute = typeof Execute
    export const Execute: unique symbol = Symbol('Execute')

    export type InvalidQueueEmpty = typeof InvalidQueueEmpty
    export const InvalidQueueEmpty: unique symbol = Symbol('InvalidQueueEmpty')
  }

  // TODO: optimize reaction query checking and queueing by only checking the first and the last index
  // as how the first runner version does it

  export type EventQueueHandling =
    | {
        handling: ReactionHandling.Execute
        reaction: Reaction<ReactionContext<any>>
        orphans: ActyxEvent<Event.Any>[]
        matching: Event.Any[]
      }
    | {
        handling:
          | ReactionHandling.Queue
          | ReactionHandling.InvalidQueueEmpty
          | ReactionHandling.Discard
      }

  const determineEventQueueHandling = <Self>(
    reactions: Reaction<ReactionContext<Self>>[],
    queue: ActyxEvent<Event.Any>[],
  ): EventQueueHandling => {
    if (queue.length === 0) {
      return {
        handling: ReactionHandling.InvalidQueueEmpty,
      }
    }

    const partialMatches: Reaction<ReactionContext<Self>>[] = []

    for (const reaction of reactions) {
      const { result, orphans, matching } = matchReaction(reaction, queue)
      if (result === ReactionMatchResult.TotalMatch) {
        return {
          handling: ReactionHandling.Execute,
          reaction,
          orphans,
          matching,
        }
      } else if (result === ReactionMatchResult.PartialMatch) {
        partialMatches.push(reaction)
      }
    }

    if (partialMatches.length > 0) {
      return {
        handling: ReactionHandling.Queue,
      }
    }

    return {
      handling: ReactionHandling.Discard,
    }
  }

  export const reset = (internals: StateContainerInternals.Any) => {
    const initial = internals.initial
    internals.current = {
      factory: initial.factory,
      state: deepCopy(initial.state),
    }
    internals.queue = []
  }

  export const pushEvent = <StateName extends string, StatePayload extends any>(
    internals: StateContainerInternals.Any,
    event: ActyxEvent<Event.Any>,
  ) => {
    internals.queue.push(event)
    const queueSnapshotBeforeExecution = [...internals.queue]

    const mechanism = internals.current.factory.mechanism()
    const protocol = internals.current.factory.mechanism().protocol
    const reactions = protocol.reactionMap.get(mechanism)

    const handlingResult = determineEventQueueHandling(reactions, internals.queue)

    if (handlingResult.handling === ReactionHandling.Execute) {
      const reaction = handlingResult.reaction
      const matchingEventSequence = handlingResult.matching

      // internals.queue are mutated here
      // .splice mutates
      const newContainer = reaction.handler(
        {
          self: internals.current.state,
        },
        matchingEventSequence,
      )

      if (newContainer) {
        internals.current = {
          state: newContainer.get(),
          factory: newContainer.factory(),
        }
      }

      // TODO: change to satisfies
      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.Queue) {
      // do nothing, item has been pushed
    } else if (handlingResult.handling === ReactionHandling.Discard) {
      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.InvalidQueueEmpty) {
      // impossible to happen because `internal.queue.push(event)` above but who knows?
      // TODO: implement anyway
    }

    return {
      ...handlingResult,
      queueSnapshotBeforeExecution,
    }
  }
}

// TODO: rename
// ==================================
// StateLensTransparent
// ==================================

export type StateContainer<
  ProtocolName extends string,
  EventFactories extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends CommandDefinerMap<any, any, Event.Any[]>,
> = {
  [StateContainerInternals.ACCESSOR]: () => StateContainerInternals<
    ProtocolName,
    EventFactories,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
  factory: () => StateFactory<
    ProtocolName,
    EventFactories,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  >
  // const reactions: Self['reactions'] = props?.reactions || []
  // const react: Self['react'] = (eventChainTrigger, factory, handler) => {
  //   // TODO: do something with factory
  //   const reaction = {
  //     eventChainTrigger,
  //     handler,
  //   }
  //   reactions.push(
  //     // TODO: unit test
  //     // NOTE: For some reason, Event.Any[] is not comparable to
  //     // Event.Factory.MapToEvent<RegisteredEventsFactoriesTuple>
  //     // Probably will have to rethink how to define Reaction
  //     reaction as unknown as StateMechanismReaction<
  //       Event.Factory.Any[],
  //       Event.Any[],
  //       StatePayload
  //     >,
  //   )

  //   return mechanism
  // }
  obs: () => Obs<Event.Any[]>
  get: () => utils.DeepReadonly<State<StateName, StatePayload>>
  initial: () => utils.DeepReadonly<State<StateName, StatePayload>>
  commands: ToCommandSignatureMap<Commands, any, Event.Any[]>
}

export namespace StateContainer {
  export type Minim = StateContainer<
    string,
    Event.Factory.NonZeroTuple,
    string,
    any,
    any,
    CommandDefinerMap<any, any, Event.Any[]>
  >

  export type Any = StateContainer<
    any,
    any,
    any,
    any,
    any,
    CommandDefinerMap<any, any, Event.Any[]>
  >

  export type Of<T extends StateFactory.Any> = T extends StateFactory<
    infer ProtocolName,
    infer RegisteredEventsFactoriesTuple,
    infer StateName,
    infer StateArgs,
    infer StatePayload,
    infer Commands
  >
    ? StateContainer<
        ProtocolName,
        RegisteredEventsFactoriesTuple,
        StateName,
        StateArgs,
        StatePayload,
        Commands
      >
    : never

  export const fromFactory = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
    Data extends StateContainerData<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
  >(
    initial: Data,
  ) => {
    const internals: StateContainerInternals<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    > = {
      initial: initial,
      current: {
        factory: initial.factory,
        state: deepCopy(initial.state),
      },
      obs: Obs.make(),
      queue: [],
    }

    return fromInternals(internals)
  }

  const fromInternals = <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    internals: StateContainerInternals<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
  ) => {
    type Self = StateContainer<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >

    const factory = () => internals.current.factory
    const mechanism = () => internals.current.factory.mechanism()
    const get = () => internals.current.state
    const initial = () => internals.initial.state

    const commands = convertCommandMapToCommandSignatureMap<any, any, Event.Any[]>(
      mechanism().commands,
      () => ({
        // TODO: think about the required context for a command
        someSystemCall: () => 1,
        self: internals.current.state,
      }),
      (events) => internals.obs.emit(events),
    )

    const self: Self = {
      [StateContainerInternals.ACCESSOR]: () => internals,
      obs: () => internals.obs,
      initial,
      get,
      commands,
      factory,
    }

    return self
  }

  export const tryFrom = <
    ProtocolName extends string,
    RegisteredEventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    internals: StateContainerInternals.Any,
    factory: StateFactory<
      ProtocolName,
      RegisteredEventFactories,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
  ): StateContainer<
    ProtocolName,
    RegisteredEventFactories,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  > | null => {
    if (StateContainerInternals.matchToFactory(factory, internals)) {
      return fromInternals<
        ProtocolName,
        RegisteredEventFactories,
        StateName,
        StateArgs,
        StatePayload,
        Commands
      >(internals)
    }
    return null
  }
}

// TODO: rename
// ==================================
// StateLensOpaque
// ==================================

export type PushEventResult = StateContainerCommon.EventQueueHandling & {
  queueSnapshotBeforeExecution: ActyxEvent<Event.Any>[]
}

export type StateContainerOpaque = {
  [StateContainerInternals.ACCESSOR]: () => StateContainerInternals.Any
  as: <
    ProtocolName extends string,
    RegisteredEventsFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Event.Any[]>,
  >(
    factory: StateFactory<
      ProtocolName,
      RegisteredEventsFactoriesTuple,
      StateName,
      StateArgs,
      StatePayload,
      Commands
    >,
  ) => StateContainer<
    ProtocolName,
    RegisteredEventsFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands
  > | null
  reset: () => void
  pushEvent: (events: ActyxEvent<Event.Any>) => PushEventResult
  get: () => utils.DeepReadonly<State<string, unknown>>
  initial: () => utils.DeepReadonly<State<string, unknown>>
  obs: () => Obs<Event.Any[]>
  factory: () => StateFactory.Any
}

export namespace StateContainerOpaque {
  export const fromStateContainer = (container: StateContainer.Any) => {
    const internals = container[StateContainerInternals.ACCESSOR]()
    const as: StateContainerOpaque['as'] = (factory) => StateContainer.tryFrom(internals, factory)
    const reset: StateContainerOpaque['reset'] = () => StateContainerCommon.reset(internals)
    const pushEvent: StateContainerOpaque['pushEvent'] = (event) =>
      StateContainerCommon.pushEvent(internals, event)
    const get = () => internals.current.state
    const initial = () => internals.initial.state
    const factory = () => internals.current.factory
    const obs = () => internals.obs
    const self: StateContainerOpaque = {
      [StateContainerInternals.ACCESSOR]: () => internals,
      as,
      reset: reset,
      pushEvent,
      get: get,
      initial: initial,
      obs,
      factory,
    }
    return self
  }
}
