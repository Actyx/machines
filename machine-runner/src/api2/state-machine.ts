import { ActyxEvent } from '@actyx/sdk/lib/types/index.js'
import * as utils from '../api2utils/type-utils.js'
import {
  CommandDefiner,
  CommandDefinerMap,
  CommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
  ToCommandSignatureMap,
} from './command.js'
import { Event } from './event.js'
import { Reaction, ReactionHandler } from './reaction.js'
import { PayloadConstructor, State, StateConstructor } from './state-raw.js'
import { deepCopy } from '../runner.js'

export * from './state-raw.js'
export * from './command.js'
export * from './event.js'
export * from './reaction.js'

// TODO: rename
// ==================================
// StateMechanism
// ==================================

export type StateMechanismAny = StateMechanism<any, any, any, any, any>
export type StateMechanism<
  EventFactoriesTuple extends Event.Factory.NonZeroTuple,
  StateName extends string,
  StateArgs extends any[],
  StatePayload extends any,
  Commands extends {
    [key: string]: CommandDefiner<
      any,
      utils.NonZeroTuple<Event.Factory.ReduceToEvent<EventFactoriesTuple>>
    >
  },
> = {
  create: StateConstructor<StateName, StateArgs, StatePayload>

  commands: Commands

  reactions: Reaction<Event.Factory.NonZeroTuple, State<any, any>, StateLensOpaque>[]

  reactTo: (
    eventChainTrigger: utils.NonZeroTuple<Event.Factory.Reduce<EventFactoriesTuple>>,
    handler: ReactionHandler<
      utils.NonZeroTuple<Event.Factory.Reduce<EventFactoriesTuple>>,
      State<StateName, StatePayload>,
      StateLensOpaque
    >,
  ) => void

  patchCommands: <
    NewCommands extends {
      [key: string]: CommandDefiner<
        any,
        utils.NonZeroTuple<Event.Factory.ReduceToEvent<EventFactoriesTuple>>
      >
    },
  >(
    commands: NewCommands,
  ) => StateMechanism<
    EventFactoriesTuple,
    StateName,
    StateArgs,
    StatePayload,
    Commands & NewCommands
  >
  build: () => StateFactory<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>
}

type StateMechanismReactions = Reaction<Event.Factory.NonZeroTuple, any, StateLensOpaque>[]

export namespace StateMechanism {
  export const make = <
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends {
      [key: string]: CommandDefiner<any, any>
    },
  >(
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
    props?: {
      signature?: Symbol
      commands?: Commands
      reactions?: StateMechanismReactions
    },
  ): StateMechanism<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands> => {
    type Self = StateMechanism<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>

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

// TODO: rename
// ==================================
// StateFactory
// ==================================

export type StateFactoryFromMechanism<T extends StateMechanismAny> = T extends StateFactory<
  infer EventFactoriesTuple,
  infer StateName,
  infer StateArgs,
  infer StatePayload,
  infer Commands
>
  ? StateFactory<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>
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
  export type Minim = StateFactory<
    Event.Factory.NonZeroTuple,
    string,
    any[],
    any,
    CommandDefinerMap<any>
  >
  export type Any = StateFactory<any, any, any, any, any>
  export const fromMechanism = <
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any>,
  >(
    mechanism: StateMechanism<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>,
  ) => {
    type Self = StateFactory<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>
    // TODO: to make it serializable, turn symbol into compile-consistent string
    const factorySymbol = Symbol()
    const factory: Self = {
      make: (...args: StateArgs) =>
        StateLensOpaque.fromFactory(factory, {
          factorySymbol,
          initial: mechanism.create(...args),
        }),
      getSymbol: () => factorySymbol,
      getMechanism: () => mechanism,
    }
    return factory
  }
}

// TODO: rename
// ==================================
// StateLensCommon
// ==================================

export type StateLensInputs = {
  initial: State<any, any>
  factorySymbol: Symbol
}
export type StateLensInternals<
  StateName extends string,
  StatePayload extends any,
> = StateLensInputs & {
  state: State<StateName, StatePayload>
  queue: ActyxEvent<Event.Any>[]
}

/**
 * For optimization purpose
 * Huge closure creation may have reduced performance in different JS engines
 */
export namespace StateLensCommon {
  export namespace ReactionMatchResult {
    export type All = TotalMatch | PartialMatch

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B, ..., C]
    export type TotalMatch = typeof TotalMatch
    export const TotalMatch: unique symbol = Symbol()

    // TODO: explain, document
    // Expect: [A, B, C]
    // Receive: [A, ..., B]
    export type PartialMatch = typeof PartialMatch
    export const PartialMatch: unique symbol = Symbol()
  }

  // TODO: unit test
  const matchReaction = <T extends Event.Factory.NonZeroTuple>(
    reaction: Reaction<T, any, StateLensOpaque>,
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
    export const Queue: unique symbol = Symbol()

    export type Discard = typeof Discard
    export const Discard: unique symbol = Symbol()

    export type Execute = typeof Execute
    export const Execute: unique symbol = Symbol()

    export type InvalidQueueEmpty = typeof InvalidQueueEmpty
    export const InvalidQueueEmpty: unique symbol = Symbol()
  }

  // TODO: optimize reaction query checking and queueing by only checking the first and the last index
  // as how the first runner version does it

  export type EventQueueHandling =
    | {
        handling: ReactionHandling.Execute
        reaction: Reaction<Event.Factory.NonZeroTuple, State<string, any>, StateLensOpaque>
        orphans: ActyxEvent<Event.Any>[]
        matching: Event.Any[]
      }
    | {
        handling:
          | ReactionHandling.Queue
          | ReactionHandling.InvalidQueueEmpty
          | ReactionHandling.Discard
      }

  const determineEventQueueHandling = (
    reactions: Reaction<Event.Factory.NonZeroTuple, State<string, any>, StateLensOpaque>[],
    queue: ActyxEvent<Event.Any>[],
  ): EventQueueHandling => {
    if (queue.length === 0) {
      return {
        handling: ReactionHandling.InvalidQueueEmpty,
      }
    }

    const partialMatches: Reaction<Event.Factory.NonZeroTuple, any, StateLensOpaque>[] = []

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

  export const reset = (internals: StateLensInternals<any, any>) => {
    internals.state = deepCopy(internals.initial)
    internals.queue = []
  }

  export const pushEvent = <StateName extends string, StatePayload extends any>(
    internals: StateLensInternals<StateName, StatePayload>,
    factory: StateFactory.Minim,
    event: ActyxEvent<Event.Any>,
  ) => {
    internals.queue.push(event)
    const handlingResult = determineEventQueueHandling(
      factory.getMechanism().reactions,
      internals.queue,
    )

    if (handlingResult.handling === ReactionHandling.Execute) {
      const reaction = handlingResult.reaction
      const matchingEventSequence = handlingResult.matching

      // internals.queue are mutated here
      // .splice mutates
      const newStateLens = reaction.handler(
        internals.state,
        // TODO: unit test (important! because of `as any`)
        matchingEventSequence as any,
      )

      internals.state = newStateLens.get() as StateLensInternals<StateName, StatePayload>['state']
      internals.queue = [...internals.queue] // array content inside new array shell
    } else if (handlingResult.handling === ReactionHandling.Queue) {
      internals.queue.push(event)
    } else if (handlingResult.handling === ReactionHandling.Discard) {
      internals.queue = []
    } else if (handlingResult.handling === ReactionHandling.InvalidQueueEmpty) {
      // impossible to happen because `internal.queue.push(event)` above but who knows?
      // TODO: implement anyway
    }

    return handlingResult
  }
}

// TODO: rename
// ==================================
// StateLensOpaque
// ==================================

export type StateLensOpaque = {
  as: <
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any>,
  >(
    factory: StateFactory<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>,
  ) => StateLensTransparent<StateName, StatePayload, ToCommandSignatureMap<Commands>> | null
  reset: () => void
  pushEvent: (events: ActyxEvent<Event.Any>) => StateLensCommon.EventQueueHandling
  get: () => State<string, unknown>
}

export namespace StateLensOpaque {
  export const fromFactory = (factory: StateFactory.Any, input: StateLensInputs) => {
    const internals: StateLensInternals<string, unknown> = {
      ...input,
      state: deepCopy(input.initial),
      queue: [],
    }
    const as: StateLensOpaque['as'] = (factory) => StateLensTransparent.tryFrom(internals, factory)
    const reset: StateLensOpaque['reset'] = () => StateLensCommon.reset(internals)
    const pushEvent: StateLensOpaque['pushEvent'] = (event) =>
      StateLensCommon.pushEvent(internals, factory, event)
    const getState = () => internals.state
    const self: StateLensOpaque = { as, reset: reset, pushEvent, get: getState }
    return self
  }
}

// TODO: rename
// ==================================
// StateLensTransparent
// ==================================

export type StateLensTransparent<
  StateName extends string,
  StatePayload extends any,
  Commands extends CommandSignatureMap<any>,
> = {
  get: () => State<StateName, StatePayload>
  commands: Commands
}

export namespace StateLensTransparent {
  export const tryFrom = <
    EventFactories extends Event.Factory.NonZeroTuple,
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends CommandDefinerMap<any>,
  >(
    internals: StateLensInternals<string, unknown>,
    factory: StateFactory<EventFactories, StateName, StateArgs, StatePayload, Commands>,
  ): StateLensTransparent<StateName, StatePayload, ToCommandSignatureMap<Commands>> | null => {
    if (factory.getSymbol() === internals.factorySymbol) {
      // TODO: optimize
      const commands = convertCommandMapToCommandSignatureMap(factory.getMechanism().commands, {
        // TODO: think about the required context for a command
        someSystemCall: () => 1,
      })
      return {
        get: () => internals.initial,
        commands,
      }
    }
    return null
  }
}

export type StateMechanismMap<
  Dictionary extends { [key: string]: StateMechanism<any, any, any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}
