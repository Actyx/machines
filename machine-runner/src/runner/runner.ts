import {
  Actyx,
  CancelSubscription,
  EventKey,
  EventsOrTimetravel,
  Metadata,
  MsgType,
  OnCompleteOrErr,
  Tags,
} from '@actyx/sdk'
import EventEmitter from 'events'
import {
  MachineEvent,
  StateRaw,
  StateFactory,
  CommandDefinerMap,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
} from '../design/state.js'
import { Destruction } from '../utils/destruction.js'
import { NOP } from '../utils/index.js'
import {
  CommandCallback,
  CommandFiredAfterLocked,
  RunnerInternals,
  StateAndFactory,
} from './runner-internals.js'
import { MachineEmitter, MachineEmitterEventMap } from './runner-utils.js'

/**
 * Contains and manages the state of a protocol by subscribing and publishing
 * events via an active connection to Actyx. A MachineRunner manages state
 * reactions and transitions when incoming events from Actyx match one of the
 * reactions of the MachineRunner's state as defined by the user via the
 * protocol.
 *
 * MachineRunner can be used as an async-iterator. However, if used as an
 * async-iterator, it will be destroyed when a 'break' occurs on the loop.
 * @example
 * const state = machine.get();
 *
 * @example
 * for await (const state of machine) {
 *   break; // this destroys `machine`
 * }
 * machine.isDestroyed() // returns true
 */
export type MachineRunner = {
  id: symbol
  events: MachineEmitter

  /**
   * Disconnect from actyx and disable future reactions and commands.
   */
  destroy: () => unknown

  /**
   * @returns whether this MachineRunner is destroyed/disconnected from Actyx.
   */
  isDestroyed: () => boolean

  /**
   * @returns a snapshot of the MachineRunner's current state in the form of
   * StateOpaque.
   * @returns null if the MachineRunner has not processed all incoming events
   * for the first time.
   */
  get: () => StateOpaque | null

  /**
   * @returns a snapshot of the MachineRunner's initial state in the form of
   * StateOpaque
   */
  initial: () => StateOpaque

  /**
   * @returns a copy of the MachineRunner referring to its parent's state that
   * does not destroy the parent when it is destroyed.
   * @example
   * for await (const state of machine.noAutoDestroy()) {
   *   break; // this break does not destroy `machine`
   * }
   * machine.isDestroyed() // returns false
   */
  noAutoDestroy: () => MachineRunnerIterableIterator
} & MachineRunnerIterableIterator

export namespace MachineRunner {
  type AllEventMap = MachineEmitterEventMap
  export type EventListener<Key extends keyof AllEventMap> = AllEventMap[Key]
}

export type SubscribeFn<RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple> =
  (
    callback: (
      data: EventsOrTimetravel<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>,
    ) => Promise<void>,
    onCompleteOrErr?: OnCompleteOrErr,
  ) => CancelSubscription

export type PersistFn<RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple> = (
  events: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>[],
) => Promise<Metadata[]>

/**
 * @param sdk - An instance of Actyx.
 * @param tags - List of tags to be subscribed
 * @param initialFactory - initial state factory of the machine
 * @param initialPayload - initial state payload of the machine
 * @returns a MachineRunner instance
 */
export const createMachineRunner = <
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  Payload,
>(
  sdk: Actyx,
  tags: Tags<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>,
  initialFactory: StateFactory<any, RegisteredEventsFactoriesTuple, any, Payload, any>,
  initialPayload: Payload,
) => {
  const subscribeMonotonicQuery = {
    query: tags,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persist: PersistFn<RegisteredEventsFactoriesTuple> = (e) => sdk.publish(tags.apply(...e))

  const subscribe: SubscribeFn<RegisteredEventsFactoriesTuple> = (callback, onCompleteOrErr) =>
    sdk.subscribeMonotonic<MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>>(
      subscribeMonotonicQuery,
      callback,
      onCompleteOrErr,
    )

  return createMachineRunnerInternal(subscribe, persist, initialFactory, initialPayload)
}

export const createMachineRunnerInternal = <
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  Payload,
>(
  subscribe: SubscribeFn<RegisteredEventsFactoriesTuple>,
  persist: PersistFn<RegisteredEventsFactoriesTuple>,
  factory: StateFactory<any, RegisteredEventsFactoriesTuple, any, Payload, any>,
  payload: Payload,
): MachineRunner => {
  const internals = RunnerInternals.make(factory, payload, (events) => {
    if (internals.commandLock) {
      console.error('Command issued after locked')
      return Promise.resolve(CommandFiredAfterLocked)
    }

    const currentCommandLock = Symbol()

    internals.commandLock = currentCommandLock

    const persistResult = persist(events)

    persistResult.catch((err) => {
      emitter.emit(
        'log',
        `error publishing ${err} ${events.map((e) => JSON.stringify(e)).join(', ')}`,
      )
      /**
       * Guards against cases where command's events couldn't be persisted but
       * state has changed
       */
      if (currentCommandLock !== internals.commandLock) return
      internals.commandLock = null
      emitter.emit('change', ImplStateOpaque.make(internals, internals.current))
    })

    emitter.emit('change', ImplStateOpaque.make(internals, internals.current))
    return persistResult
  })

  const destruction = Destruction.make()

  // Actyx Subscription management
  const emitter = new EventEmitter() as MachineEmitter
  destruction.addDestroyHook(() => emitter.emit('destroyed'))

  let refToUnsubFunction = null as null | (() => void)

  const unsubscribeFromActyx = () => {
    refToUnsubFunction?.()
    refToUnsubFunction = null
  }
  destruction.addDestroyHook(unsubscribeFromActyx)

  const restartActyxSubscription = () => {
    unsubscribeFromActyx()

    if (destruction.isDestroyed()) return

    refToUnsubFunction = subscribe(
      async (d) => {
        try {
          if (d.type === MsgType.timetravel) {
            emitter.emit('log', 'Time travel')
            RunnerInternals.reset(internals)
            emitter.emit('audit.reset')

            restartActyxSubscription()
          } else if (d.type === MsgType.events) {
            //

            internals.caughtUp = false

            for (const event of d.events) {
              // TODO: Runtime typeguard for event
              // https://github.com/Actyx/machines/issues/9
              emitter.emit('debug.eventHandlingPrevState', internals.current.data)

              const pushEventResult = RunnerInternals.pushEvent(internals, event)

              emitter.emit('debug.eventHandling', {
                event,
                handlingReport: pushEventResult,
                mechanism: internals.current.factory.mechanism,
                factory: internals.current.factory,
                nextState: internals.current.data,
              })

              // Effects of handlingReport on emitters
              ;(() => {
                if (pushEventResult.executionHappened) {
                  if (emitter.listenerCount('audit.state') > 0) {
                    emitter.emit('audit.state', {
                      state: ImplStateOpaque.make(internals, internals.current),
                      events: pushEventResult.triggeringEvents,
                    })
                  }
                }

                if (!pushEventResult.executionHappened && pushEventResult.discardable) {
                  emitter.emit('audit.dropped', {
                    state: internals.current.data,
                    event: pushEventResult.discardable,
                  })
                }
              })()
            }

            if (d.caughtUp) {
              // the SDK translates an OffsetMap response into MsgType.events
              // with caughtUp=true
              internals.caughtUp = true
              internals.caughtUpFirstTime = true
              emitter.emit('log', 'Caught up')
              emitter.emit('change', ImplStateOpaque.make(internals, internals.current))
            }
          }
        } catch (error) {
          console.error(error)
        }
      },
      (err) => {
        RunnerInternals.reset(internals)
        emitter.emit('audit.reset')
        emitter.emit('change', ImplStateOpaque.make(internals, internals.current))

        emitter.emit('log', 'Restarting in 1sec due to error')
        unsubscribeFromActyx()
        setTimeout(() => restartActyxSubscription, 10000)
      },
    )
  }

  // First run of the subscription
  restartActyxSubscription()

  // AsyncIterator part
  // ==================

  // Self API construction

  const getSnapshot = (): StateOpaque | null =>
    internals.caughtUpFirstTime ? ImplStateOpaque.make(internals, internals.current) : null

  const api = {
    id: Symbol(),
    events: emitter,
    get: getSnapshot,
    initial: (): StateOpaque => ImplStateOpaque.make(internals, internals.initial),
    destroy: destruction.destroy,
    isDestroyed: destruction.isDestroyed,
    noAutoDestroy: () =>
      MachineRunnerIterableIterator.make({
        events: emitter,
      }),
  }

  const defaultIterator: MachineRunnerIterableIterator = MachineRunnerIterableIterator.make({
    events: emitter,
    inheritedDestruction: destruction,
  })

  const self: MachineRunner = {
    ...api,
    ...defaultIterator,
  }

  return self
}

export type MachineRunnerIterableIterator = AsyncIterable<StateOpaque> &
  AsyncIterableIterator<StateOpaque> &
  AsyncIterator<StateOpaque, null> & {
    peek: () => Promise<IteratorResult<StateOpaque, null>>
  }

namespace MachineRunnerIterableIterator {
  export const make = ({
    events,
    inheritedDestruction: inheritedDestruction,
  }: {
    events: MachineEmitter
    inheritedDestruction?: Destruction
  }): MachineRunnerIterableIterator => {
    const destruction =
      inheritedDestruction ||
      (() => {
        const destruction = Destruction.make()

        // Destruction iis
        const onDestroy = () => {
          destruction.destroy()
          events.off('destroyed', onDestroy)
        }
        events.on('destroyed', onDestroy)

        return destruction
      })()

    const nextValueAwaiter = NextValueAwaiter.make({
      events,
      destruction,
    })

    const onThrowOrReturn = async (): Promise<IteratorResult<StateOpaque, null>> => {
      destruction.destroy()
      return nextValueAwaiter.consume()
    }

    const iterator: MachineRunnerIterableIterator = {
      peek: (): Promise<IteratorResult<StateOpaque>> => nextValueAwaiter.peek(),
      next: (): Promise<IteratorResult<StateOpaque>> => nextValueAwaiter.consume(),
      return: onThrowOrReturn,
      throw: onThrowOrReturn,
      [Symbol.asyncIterator]: (): AsyncIterableIterator<StateOpaque> => iterator,
    }

    return iterator
  }
}

/**
 * Object to help "awaiting" next value
 */
export type NextValueAwaiter = ReturnType<typeof NextValueAwaiter['make']>

namespace NextValueAwaiter {
  export const make = ({
    events,
    destruction,
  }: {
    events: MachineEmitter
    destruction: Destruction
  }) => {
    let store: null | StateOpaque | RequestedPromisePair = null

    const onChange: MachineEmitterEventMap['change'] = (state) => {
      if (destruction.isDestroyed()) return

      if (Array.isArray(store)) {
        store[1](intoIteratorResult(state))
        store = null
      } else {
        store = state
      }
    }

    events.on('change', onChange)

    destruction.addDestroyHook(() => {
      events.off('change', onChange)
      if (Array.isArray(store)) {
        store[1](Done)
        store = null
      }
    })

    return {
      consume: (): Promise<IteratorResult<StateOpaque, null>> => {
        if (destruction.isDestroyed()) return Promise.resolve(Done)

        if (store && !Array.isArray(store)) {
          const retVal = Promise.resolve(intoIteratorResult(store))
          store = null
          return retVal
        } else {
          const promisePair = store || createPromisePair()
          store = promisePair
          return promisePair[0]
        }
      },

      peek: (): Promise<IteratorResult<StateOpaque, null>> => {
        if (destruction.isDestroyed()) return Promise.resolve(Done)

        if (store && !Array.isArray(store)) {
          const retVal = Promise.resolve(intoIteratorResult(store))
          return retVal
        } else {
          const promisePair = store || createPromisePair()
          store = promisePair
          return promisePair[0]
        }
      },
    }
  }

  type RequestedPromisePair = [
    Promise<IteratorResult<StateOpaque, null>>,
    (_: IteratorResult<StateOpaque, null>) => unknown,
  ]

  const createPromisePair = (): RequestedPromisePair => {
    const pair: RequestedPromisePair = [undefined as any, NOP]
    pair[0] = new Promise<IteratorResult<StateOpaque, null>>((resolve) => (pair[1] = resolve))
    return pair
  }

  const intoIteratorResult = (value: StateOpaque): IteratorResult<StateOpaque, null> => ({
    done: false,
    value,
  })

  export const Done: IteratorResult<StateOpaque, null> = { done: true, value: null }
}

/**
 * StateOpaque is an opaque snapshot of a MachineRunner state. A StateOpaque
 * does not have direct access to the state's payload or command. In order to
 * access the state's payload, a StateOpaque has to be successfully cast into a
 * particular typed State.
 */
export interface StateOpaque<
  StateName extends string = string,
  Payload = unknown,
  Commands extends CommandDefinerMap<object, any, MachineEvent.Any[]> = object,
> extends StateRaw<StateName, Payload> {
  /**
   * Checks if the StateOpaque's type equals to the StateFactory's type
   * @param factory - A StateFactory used to narrow the StateOpaque's type
   * @return boolean that narrows the type of the StateOpaque based on the
   * supplied StateFactory.
   * @example
   * const state = machine.get()
   * if (state.is(HangarControlIdle)) {
   *   // StateOpaque is narrowed inside this block
   * }
   */
  is<
    DeductStateName extends string,
    DeductPayload,
    DeductCommands extends CommandDefinerMap<object, any, MachineEvent.Any[]> = object,
  >(
    factory: StateFactory<any, any, DeductStateName, DeductPayload, DeductCommands>,
  ): this is StateOpaque<DeductStateName, DeductPayload, DeductCommands>

  /**
   * Attempt to cast the StateOpaque into a specific StateFactory and optionally
   * transform the value with the `then` function. Whether casting is successful
   * or not depends on whether the StateOpaque's State matches the factory
   * supplied via the first parameter.
   * @param factory - A StateFactory used to cast the StateOpaque
   * @param then - an optional transformation function accepting the typed state
   * and returns an arbitrary value. This function will be executed if the
   * casting is successful
   * @return a typed State with access to payload and commands if the `then`
   * function is not supplied and the casting is successful, any value returned
   * by the `then` function if supplied and casting is successful, null if
   * casting is not successful
   * @example
   * const maybeHangarControlIdle = machine
   *   .get()?
   *   .as(HangarControlIdle)
   * if (maybeHangarControlIdle !== null) {
   *   // do something with maybeHangarControlIdle
   * }
   * @example
   * const maybeFirstDockingRequest = machine
   *  .get()?
   *  .as(HangarControlIdle, (state) => state.dockingRequests.at(0))
   */
  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
  ): State<StateName, StatePayload, Commands> | undefined

  /**
   * Attempt to cast the StateOpaque into a specific StateFactory and optionally
   * transform the value with the `then` function. Whether casting is successful
   * or not depends on whether the StateOpaque's State matches the factory
   * supplied via the first parameter.
   * @param factory - A StateFactory used to cast the StateOpaque
   * @param then - an optional transformation function accepting the typed state
   * and returns an arbitrary value. This function will be executed if the
   * casting is successful
   * @return a typed State with access to payload and commands if the `then`
   * function is not supplied and the casting is successful, any value returned
   * by the `then` function if supplied and casting is successful, null if
   * casting is not successful
   * @example
   * const maybeHangarControlIdle = machine
   *   .get()?
   *   .as(HangarControlIdle)
   * if (maybeHangarControlIdle !== null) {
   *   // do something with maybeHangarControlIdle
   * }
   * @example
   * const maybeFirstDockingRequest = machine
   *  .get()?
   *  .as(HangarControlIdle, (state) => state.dockingRequests.at(0))
   */
  as<
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    Then extends (arg: State<StateName, StatePayload, Commands>) => any,
  >(
    factory: StateFactory<any, any, StateName, StatePayload, Commands>,
    then: Then,
  ): ReturnType<Then> | undefined

  /**
   * Cast into a typed State. Usable only inside a block where this
   * StateOpaque's type is narrowed.
   * @return typed State with access to payload and commands
   * @example
   * const state = machine.get()
   * if (state.is(HangarControlIdle)) {
   *   const typedState = state.cast()                  // typedState is an instance of HangarControlIdle
   *   console.log(typedState.payload.dockingRequests)  // payload is accessible
   *   console.log(typedState.commands)                 // commands MAY be accessible depending on the state of the MachineRunners
   * }
   */
  cast(): State<StateName, Payload, Commands>
}

namespace ImplStateOpaque {
  export const isExpired = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ) =>
    stateAndFactoryForSnapshot.factory !== internals.current.factory ||
    stateAndFactoryForSnapshot.data !== internals.current.data

  export const isCommandLocked = (internals: RunnerInternals.Any): boolean =>
    !!internals.commandLock

  export const make = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ): StateOpaque => {
    // Captured data at snapshot call-time
    const commandLockAtSnapshot = internals.commandLock
    const stateAtSnapshot = stateAndFactoryForSnapshot.data
    const factoryAtSnapshot = stateAndFactoryForSnapshot.factory as StateFactory.Any
    const caughtUpAtSnapshot = internals.caughtUp
    const caughtUpFirstTimeAtSnapshot = internals.caughtUpFirstTime
    const queueLengthAtSnapshot = internals.queue.length
    const commandEnabledAtSnapshot =
      !commandLockAtSnapshot &&
      caughtUpAtSnapshot &&
      caughtUpFirstTimeAtSnapshot &&
      queueLengthAtSnapshot === 0

    // TODO: write unit test on expiry
    const isExpired = () => ImplStateOpaque.isExpired(internals, stateAndFactoryForSnapshot)

    const is: StateOpaque['is'] = (factory) => factoryAtSnapshot.mechanism === factory.mechanism

    const as: StateOpaque['as'] = <
      StateName extends string,
      StatePayload,
      Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    >(
      factory: StateFactory<any, any, StateName, StatePayload, Commands>,
      then?: any,
    ) => {
      if (factoryAtSnapshot.mechanism === factory.mechanism) {
        const snapshot = ImplState.makeForSnapshot({
          factory: factoryAtSnapshot,
          commandEmitFn: internals.commandEmitFn,
          isExpired,
          commandEnabledAtSnapshot,
          stateAtSnapshot,
        })
        return then ? then(snapshot) : snapshot
      }
      return undefined
    }

    const cast: StateOpaque['cast'] = () =>
      ImplState.makeForSnapshot({
        factory: factoryAtSnapshot,
        commandEmitFn: internals.commandEmitFn,
        isExpired,
        commandEnabledAtSnapshot,
        stateAtSnapshot,
      })

    return {
      is,
      as,
      cast,
      payload: stateAtSnapshot.payload,
      type: stateAtSnapshot.type,
    }
  }
}

/**
 * A typed snapshot of the MachineRunner's state with access to the state's
 * payload and the associated commands. Commands are available only if at the
 * time the snapshot is created these conditions are met: 1.) the MachineRunner
 * has caught up with Actyx's events stream, 2.) there are no events in the
 * internal queue awaiting processing, 3.) no command associated with the same
 * state has been issued
 */
export type State<
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
> = StateRaw<StateName, StatePayload> & {
  /**
   * A dictionary containing commands previously registered during the State
   * Design process. Undefined when commands are unavailable during the time of
   * the state snapshot. Commands are available only if at the time the snapshot
   * is created these conditions are met: 1.) the MachineRunner has caught up
   * with Actyx's events stream, 2.) there are no events in the internal queue
   * awaiting processing, 3.) no command associated with the same state has been
   * issued
   */
  commands?: ToCommandSignatureMap<Commands, any, MachineEvent.Any[]>
}

/**
 * A collection of type utilities around State
 */
export namespace State {
  export type Minim = State<string, any, CommandDefinerMap<any, any, MachineEvent.Any>>

  export type NameOf<T extends State.Minim> = T extends State<infer Name, any, any> ? Name : never

  /**
   * Extract the a typed state from a StateFactory
   * @example
   * const Active = protocol
   *   .designEmpty("Active")
   *   .command("deactivate", [Deactivate], () => [Deactivate.make()])
   *   .finish();
   *
   * // this function accepts a typed state instance of Active
   * const deactivate = (state: StateOf<Active>) => {
   *   if (SOME_THRESHOLD()) {
   *     state.commands?.deactivate()
   *   }
   * }
   *
   * // calling the function
   * machine.get()?.as(Active, (state) => deactivate(state));
   */
  export type Of<T extends StateFactory.Any> = T extends StateFactory<
    any,
    any,
    infer StateName,
    infer StatePayload,
    infer Commands
  >
    ? State<StateName, StatePayload, Commands>
    : never
}

namespace ImplState {
  export const makeForSnapshot = <
    RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
  >({
    factory,
    isExpired,
    commandEnabledAtSnapshot,
    commandEmitFn,
    stateAtSnapshot,
  }: {
    factory: StateFactory<any, RegisteredEventsFactoriesTuple, StateName, StatePayload, Commands>
    isExpired: () => boolean
    commandEnabledAtSnapshot: boolean
    commandEmitFn: CommandCallback<RegisteredEventsFactoriesTuple>
    stateAtSnapshot: StateRaw<StateName, StatePayload>
  }) => {
    const mechanism = factory.mechanism
    const commands = commandEnabledAtSnapshot
      ? convertCommandMapToCommandSignatureMap<any, StatePayload, MachineEvent.Any[]>(
          mechanism.commands,
          {
            isExpired,
            getActualContext: () => ({
              self: stateAtSnapshot.payload,
            }),
            onReturn: async (events) => {
              await commandEmitFn(events)
            },
          },
        )
      : undefined

    const snapshot = {
      payload: stateAtSnapshot.payload,
      type: stateAtSnapshot.payload,
      commands,
    }
    return snapshot
  }
}
