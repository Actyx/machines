/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Actyx,
  CancelSubscription,
  EventKey,
  EventsOrTimetravel,
  Metadata,
  MsgType,
  OnCompleteOrErr,
  TaggedEvent,
  Tags,
} from '@actyx/sdk'
import {
  MachineEvent,
  StateRaw,
  StateFactory,
  CommandDefinerMap,
  ToCommandSignatureMap,
  convertCommandMapToCommandSignatureMap,
  Contained,
  CommandContext,
  CommandGeneratorCriteria,
} from '../design/state.js'
import { Destruction } from '../utils/destruction.js'
import {
  CommandCallback,
  PushEventTypes,
  RunnerInternals,
  StateAndFactory,
} from './runner-internals.js'
import {
  CommonEmitterEventMap,
  MachineEmitter,
  TypedEventEmitter,
  MachineEmitterEventMap,
  makeEmitter,
  ActiveRunnerRegistryRegisterSymbol,
} from './runner-utils.js'
import { Machine, SwarmProtocol } from '../design/protocol.js'
import { deepEqual } from 'fast-equals'
import { deepCopy } from '../utils/object-utils.js'
import * as globals from '../globals.js'
import { MachineRunnerFailure } from '../errors.js'

/**
 * Contains and manages the state of a machine by subscribing and publishing
 * events via an active connection to Actyx. A MachineRunner manages state
 * reactions and transitions when incoming events from Actyx match one of the
 * reactions of the MachineRunner's state as defined by the user via the machine
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
export type MachineRunner<
  SwarmProtocolName extends string,
  MachineName extends string,
  StateUnion extends unknown = unknown,
> = {
  id: symbol
  events: MachineEmitter<SwarmProtocolName, MachineName, StateUnion>

  /**
   * Disconnect from Actyx and disable future reactions and commands.
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
  get: () => StateOpaque<SwarmProtocolName, MachineName, string, StateUnion> | null

  /**
   * @returns a snapshot of the MachineRunner's initial state in the form of
   * StateOpaque.
   */
  initial: () => StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>

  /**
   * @returns a copy of the MachineRunner referring to its parent's state that
   * does not destroy the parent when it is destroyed.
   * @example
   * for await (const state of machine.noAutoDestroy()) {
   *   break; // this break does not destroy `machine`
   * }
   * machine.isDestroyed() // returns false
   */
  noAutoDestroy: () => MachineRunnerIterableIterator<SwarmProtocolName, MachineName, StateUnion>

  /**
   * Add type refinement to the state payload produced by the machine-runner
   *
   * @param stateFactories - All state factories produced by the
   * MachineProtocol. All state factories must be included, otherwise (i.e.
   * passing only some state factories) will result in an exception being
   * thrown.
   * @return a reference the machine-runner instance with added type refinement
   *
   * @example
   * const machineRunner = createMachineRunner(actyx, where, StateA, undefined)
   *  .refineStateType([StateA, StateB, StateC] as const);
   *
   * const stateSnapshot = machineRunner.get();
   * if (!stateSnapshot) return
   *
   * const payload = stateSnapshot.payload; // union of payloads of StateA, StateB, and StateC
   */
  refineStateType: <
    Factories extends Readonly<StateFactory<SwarmProtocolName, MachineName, any, any, any, any>[]>,
  >(
    _: Factories,
  ) => MachineRunner<SwarmProtocolName, MachineName, StateFactory.ReduceIntoPayload<Factories>>
} & MachineRunnerIterableIterator<SwarmProtocolName, MachineName, StateUnion>

export namespace MachineRunner {
  /**
   * The widest type of MachineRunner. Any other MachineRunner extends this type
   */
  export type Any = MachineRunner<string, string, any>

  export type EventsOf<T extends MachineRunner.Any> = T extends Machine<
    any,
    any,
    infer MachineEventFactories
  >
    ? MachineEvent.Of<MachineEventFactories>
    : never

  /**
   * Extract MachineRunner event emitter map type from a MachineRunner
   * @example
   * const machineRunner = createMachineRunner(actyx, where, Passenger.Initial, void 0);
   *
   * type EventMap = MachineRunner.EventMapOf<typeof machineRunner>
   * type OnChange = EventMap['change']
   *
   * const onChange: EventMap['change'] = () =>
   *  console.log(label, 'state after caughtUp', utils.deepCopy(machine.get()))
   * machine.events.on('change', onChange)
   *
   * // later
   * machine.events.off('change', onChange)
   */
  export type EventMapOf<M extends MachineRunner<any, any, any>> = M extends MachineRunner<
    infer S,
    infer N,
    infer SU
  >
    ? MachineEmitterEventMap<S, N, SU>
    : never

  /**
   * Extract MachineRunner type from SwarmProtocol or Machine
   * @example
   * const HangarBay = SwarmProtocol.make(
   *   'HangarBay',
   *   [HangarDoorTransitioning, HangarDoorClosed, HangarDoorOpen]
   * )
   * const Door = HangarBay.makeMachine('door')
   * const Initial = Door.designEmpty().finish()
   *
   * // refers to any MachineRunner derived from HangarBay protocol
   * type ThisMachineRunner = MachineRunner.Of<typeof HangarBay>
   *
   * // refers to any MachineRunner derived from HangarBay protocol and Door machine
   * type ThisMachineRunner = MachineRunner.Of<typeof Door>
   */
  export type Of<S extends SwarmProtocol<any, any> | Machine<any, any, any>> =
    S extends SwarmProtocol<infer S, any>
      ? MachineRunner<S, string, unknown>
      : S extends Machine<infer S, infer N, any>
      ? MachineRunner<S, N, unknown>
      : never

  export const mergeExtraTags = <E>(
    tags: Tags<E>,
    extraData: Contained.ExtraData | null,
  ): Tags<E> => {
    const extraTags = extraData?.additionalTags
    if (!extraTags || extraTags.length === 0) return tags
    return tags.and(Tags(...extraTags))
  }

  export const tagContainedEvent = <E extends MachineEvent.Any>(
    tags: Tags<E>,
    containedEvent: Contained.ContainedEvent<E>,
  ) => {
    const [ev, extraData] = containedEvent
    const finalTags = mergeExtraTags(tags as Tags<E>, extraData)
    // NOTE: .map to tag.apply is used instead of tag.apply(...events)
    // This is to prevent taggedEvents from accidentally returning non-array
    // TaggedEvents seems to confuse:
    // 1.) receiving one event
    // 2.) receiving multiple events
    return finalTags.apply(ev)
  }
}

export type SubscribeFn<E extends MachineEvent.Any> = (
  callback: (data: EventsOrTimetravel<E>) => Promise<void>,
  onCompleteOrErr?: OnCompleteOrErr,
) => CancelSubscription

export type PersistFn<E extends MachineEvent.Any> = (
  events: Contained.ContainedEvent<E>[],
) => Promise<Metadata[]>

type PublishFn = (events: TaggedEvent[]) => Promise<Metadata[]>

/**
 * @param sdk - An instance of Actyx.
 * @param tags - List of tags to be subscribed. These tags will also be added to
 * events published to Actyx.
 * @param initialFactory - initial state factory of the machine.
 * @param initialPayload - initial state payload of the machine.
 * @returns a MachineRunner instance.
 */
export const createMachineRunner = <
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  Payload,
  MachineEvents extends MachineEvent.Any = MachineEvent.Of<MachineEventFactories>,
>(
  sdk: Actyx,
  tags: Tags<MachineEvents>,
  initialFactory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    any,
    Payload,
    any
  >,
  initialPayload: Payload,
) => {
  const subscribeMonotonicQuery = {
    query: tags,
    sessionId: 'dummy',
    attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
  }

  const persist: PublishFn = (e) => sdk.publish(e)

  const subscribe: SubscribeFn<MachineEvents> = (callback, onCompleteOrErr) =>
    sdk.subscribeMonotonic<MachineEvents>(subscribeMonotonicQuery, callback, onCompleteOrErr)

  return createMachineRunnerInternal(subscribe, persist, tags, initialFactory, initialPayload)
}

export const createMachineRunnerInternal = <
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  Payload,
  MachineEvents extends MachineEvent.Any = MachineEvent.Of<MachineEventFactories>,
  StateUnion extends unknown = unknown,
>(
  subscribe: SubscribeFn<MachineEvents>,
  publish: PublishFn,
  tags: Tags,
  initialFactory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    any,
    Payload,
    any
  >,
  initialPayload: Payload,
): MachineRunner<SwarmProtocolName, MachineName, StateUnion> => {
  type ThisStateOpaque = StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>
  type ThisMachineRunner = MachineRunner<SwarmProtocolName, MachineName, StateUnion>

  const emitter = makeEmitter<SwarmProtocolName, MachineName, StateUnion>()

  const emitErrorIfSubscribed: MachineEmitterEventMap<
    SwarmProtocolName,
    MachineName,
    StateUnion
  >['error'] = (error) => {
    const listeningEmitters = [emitter, globals.emitter].filter(
      (emitter) => emitter.listenerCount('error') > 0,
    )

    // Listener count must be check in order to not trigger ERR_UNHANDLED_ERROR
    // https://nodejs.org/api/errors.html#err_unhandled_error
    if (listeningEmitters.length > 0) {
      listeningEmitters.forEach((emitter) => emitter.emit('error', error))
    } else {
      // Preserve old behavior where errors are printed
      console.warn(error.stack)
    }
  }

  const persist: PersistFn<MachineEvents> = (containedEvents) => {
    const taggedEvents = containedEvents.map((containedEvent) =>
      MachineRunner.tagContainedEvent(tags as Tags<MachineEvents>, containedEvent),
    )
    return publish(taggedEvents)
  }

  const internals = RunnerInternals.make(initialFactory, initialPayload, (props) => {
    const error = CommandGeneratorCriteria.produceError(props.commandGeneratorCriteria, () =>
      makeIdentityStringForCommandError(
        initialFactory.mechanism.protocol.swarmName,
        initialFactory.mechanism.protocol.name,
        tags.toString(),
        props.commandKey,
      ),
    )

    if (error) {
      emitErrorIfSubscribed(error)
      return Promise.reject(error)
    }

    const currentCommandLock = Symbol(Math.random())

    internals.commandLock = currentCommandLock

    const events = props.generateEvents()

    const unlockAndLogOnPersistFailure = (err: unknown) => {
      emitter.emit(
        'log',
        `error publishing ${err} ${events.map((e) => JSON.stringify(e)).join(', ')}`,
      )
      /**
       * Guards against cases where command's events cannot be persisted but the
       * state has changed.
       */
      if (currentCommandLock !== internals.commandLock) return
      internals.commandLock = null
      emitter.emit('change', ImplStateOpaque.make(internals, internals.current))
    }

    const persistResult = persist(events).catch((err) => {
      unlockAndLogOnPersistFailure(err)
      return Promise.reject(err)
    })

    emitter.emit('change', ImplStateOpaque.make(internals, internals.current))
    return persistResult
  })

  // Actyx Subscription management
  internals.destruction.addDestroyHook(() => emitter.emit('destroyed'))

  const fail = (cause: MachineRunnerFailure) => {
    // order of execution is very important here
    // if changing causes issue in test, revert
    internals.failure = cause
    emitter.emit('failure', cause)
    emitErrorIfSubscribed(cause)
    internals.destruction.destroy()
  }

  let refToUnsubFunction = null as null | (() => void)

  const unsubscribeFromActyx = () => {
    refToUnsubFunction?.()
    refToUnsubFunction = null
  }
  internals.destruction.addDestroyHook(unsubscribeFromActyx)

  const restartActyxSubscription = () => {
    unsubscribeFromActyx()

    if (internals.destruction.isDestroyed()) return

    const bootTimeLogger = makeBootTimeLogger(
      {
        machineName: initialFactory.mechanism.protocol.name,
        swarmProtocolName: initialFactory.mechanism.protocol.swarmName,
        tags: tags,
      },
      [emitter, globals.emitter],
    )

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
              bootTimeLogger.incrementEventCount()
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
              if (pushEventResult.type === PushEventTypes.React) {
                if (emitter.listenerCount('audit.state') > 0) {
                  emitter.emit('audit.state', {
                    state: ImplStateOpaque.make<SwarmProtocolName, MachineName, StateUnion>(
                      internals,
                      internals.current,
                    ),
                    events: pushEventResult.triggeringEvents,
                  })
                }
              } else if (pushEventResult.type === PushEventTypes.Discard) {
                emitter.emit('audit.dropped', {
                  state: internals.current.data,
                  event: pushEventResult.discarded,
                })
              } else if (pushEventResult.type === PushEventTypes.Failure) {
                const nameOf = ({ mechanism }: StateFactory.Any) =>
                  `${mechanism.protocol.swarmName}/${mechanism.protocol.name}/${mechanism.name}`

                return fail(
                  new MachineRunnerFailure(
                    `Exception thrown while transitioning from ${nameOf(
                      pushEventResult.failure.current,
                    )} to ${nameOf(pushEventResult.failure.next)}`,
                    pushEventResult.failure.error,
                  ),
                )
              }
            }

            if (d.caughtUp) {
              // the SDK translates an OffsetMap response into MsgType.events
              // with caughtUp=true
              if (!internals.caughtUpFirstTime) {
                bootTimeLogger.emit()
              }

              internals.caughtUp = true
              internals.caughtUpFirstTime = true
              emitter.emit('log', 'Caught up')

              const stateOpaqueToBeEmitted = ImplStateOpaque.make<
                SwarmProtocolName,
                MachineName,
                StateUnion
              >(internals, internals.current)
              emitter.emit('change', stateOpaqueToBeEmitted)

              if (
                internals.current.factory !== internals.previouslyEmittedToNext?.factory ||
                !deepEqual(internals.previouslyEmittedToNext.data, internals.current.data)
              ) {
                internals.previouslyEmittedToNext = {
                  factory: internals.current.factory,
                  data: deepCopy(internals.current.data),
                }
                emitter.emit('next', stateOpaqueToBeEmitted)
              }
            }
          }
        } catch (error) {
          return fail(new MachineRunnerFailure(`Unknown Error`, error))
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

  type S = StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>
  const nextValueAwaiter = (state?: S | undefined) => {
    const nva = NextValueAwaiter.make<S>({
      topLevelDestruction: internals.destruction,
      failure: () => internals.failure,
      cloneFrom: state,
    })

    emitter.on('next', nva.push)
    emitter.on('failure', nva.fail)
    internals.destruction.addDestroyHook(nva.kill)

    return nva
  }

  const defaultNextValueAwaiter = nextValueAwaiter()

  // Self API construction

  const getSnapshot = (): ThisStateOpaque | null =>
    internals.caughtUpFirstTime ? ImplStateOpaque.make(internals, internals.current) : null

  const api = {
    id: Symbol(),
    events: emitter,
    get: getSnapshot,
    initial: (): ThisStateOpaque => ImplStateOpaque.make(internals, internals.initial),
    destroy: internals.destruction.destroy,
    isDestroyed: internals.destruction.isDestroyed,
    noAutoDestroy: () =>
      MachineRunnerIterableIterator.make({
        nextValueAwaiter: nextValueAwaiter(defaultNextValueAwaiter.state()),
        destruction: (() => {
          const childDestruction = Destruction.make()

          internals.destruction.addDestroyHook(() => childDestruction.destroy())

          if (internals.destruction.isDestroyed()) {
            childDestruction.destroy()
          }

          return childDestruction
        })(),
      }),
  }

  const defaultIterator: MachineRunnerIterableIterator<SwarmProtocolName, MachineName, StateUnion> =
    MachineRunnerIterableIterator.make({
      nextValueAwaiter: defaultNextValueAwaiter,
      destruction: internals.destruction,
    })

  const refineStateType = <
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    Factories extends Readonly<StateFactory<SwarmProtocolName, MachineName, any, any, any, any>[]>,
  >(
    factories: Factories,
  ) => {
    const allStateNames = new Set(initialFactory.mechanism.protocol.states.registeredNames)
    factories.forEach((factory) => allStateNames.delete(factory.mechanism.name))
    if (allStateNames.size > 0) {
      throw new Error(
        'Call to refineStateType fails, some possible states are not passed into the parameter. Pass all states as arguments.',
      )
    }

    return self as MachineRunner<
      SwarmProtocolName,
      MachineName,
      StateFactory.ReduceIntoPayload<Factories>
    >
  }

  const self: ThisMachineRunner = {
    ...api,
    ...defaultIterator,
    refineStateType,
  }

  globals.activeRunners[ActiveRunnerRegistryRegisterSymbol](self, {
    initialFactory,
    tags,
  })

  return self
}

export type MachineRunnerIterableIterator<
  SwarmProtocolName extends string,
  MachineName extends string,
  StateUnion extends unknown,
> = AsyncIterable<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>> &
  AsyncIterableIterator<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>> &
  AsyncIterator<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>, null> & {
    /**
     * @deprecated use `peekNext` instead
     *
     * The returned promise resolves when the machine-runner async iterator has received more events and computed the next ready-state.
     * Ready state is invalidated by calls to `next` method which returns the same promise.
     *
     * Unlike `next`, it does not invalidate current ready-state.
     *
     * Unilke `get`, it waits for a ready-state instead of returning the immediate state of the machine runner, which is nullable
     *
     * @returns Promise<{ done: false, value: StateOpaque } | { done: true, value: null }>
     */
    peek: () => Promise<
      IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>, null>
    >
    /**
     * The returned promise resolves when the machine-runner async iterator has received more events and computed the next ready-state.
     * Ready state is invalidated by calls to `next` method which returns the same promise.
     *
     * Unlike `next`, it does not invalidate current ready-state.
     *
     * Unilke `get`, it waits for a ready-state instead of returning the immediate state of the machine runner, which is nullable
     *
     * @returns Promise<{ done: false, value: StateOpaque } | { done: true, value: null }>
     */
    peekNext: () => Promise<
      IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>, null>
    >
  }

namespace MachineRunnerIterableIterator {
  export const make = <
    SwarmProtocolName extends string,
    MachineName extends string,
    StateUnion extends unknown,
  >({
    nextValueAwaiter,
    destruction,
  }: {
    nextValueAwaiter: NextValueAwaiter<
      StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>
    >
    destruction: Destruction
  }): MachineRunnerIterableIterator<SwarmProtocolName, MachineName, StateUnion> => {
    const nextValueAwaiterConsume = nextValueAwaiter.generateConsumeAPI(destruction)

    const onThrowOrReturn = async (): Promise<
      IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>, null>
    > => {
      destruction.destroy()
      return Promise.resolve({ done: true, value: null })
    }

    const iterator: MachineRunnerIterableIterator<SwarmProtocolName, MachineName, StateUnion> = {
      peekNext: (): Promise<
        IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>>
      > => nextValueAwaiterConsume.peek(),
      peek: (): Promise<
        IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>>
      > => nextValueAwaiterConsume.peek(),
      next: (): Promise<
        IteratorResult<StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>>
      > => nextValueAwaiterConsume.consume(),
      return: onThrowOrReturn,
      throw: onThrowOrReturn,
      [Symbol.asyncIterator]: (): AsyncIterableIterator<
        StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>
      > => iterator,
    }

    return iterator
  }
}

/**
 * Object to help "awaiting" next value.
 */
export type NextValueAwaiter<S extends any> = ReturnType<typeof NextValueAwaiter.make<S>>

namespace NextValueAwaiter {
  export const make = <S extends any>({
    topLevelDestruction,
    failure,
    cloneFrom,
  }: {
    topLevelDestruction: Destruction
    failure: () => MachineRunnerFailure | null
    cloneFrom?: S
  }) => {
    const Done: IteratorResult<S, null> = { done: true, value: null }
    const wrapAsIteratorResult = (value: S): IteratorResult<S, null> => ({ done: false, value })

    let store: null | { state: S } | RequestedPromisePair<IteratorResult<S, null>> =
      cloneFrom === undefined ? null : { state: cloneFrom }

    /**
     * Allows different level of destructions
     * For no-auto-destroy
     *
     * shared behavior:
     *  kill, fail, push
     *
     * destruction-dependant behavior:
     *  peek, next
     */
    const generateConsumeAPI = (currentLevelDestruction: Destruction) => {
      const peek = (): Promise<IteratorResult<S, null>> => {
        const failureCause = failure()
        if (failureCause) return Promise.reject(failureCause)
        if (currentLevelDestruction.isDestroyed()) return Promise.resolve(Done)
        if (store && 'state' in store) return Promise.resolve(wrapAsIteratorResult(store.state))

        const promisePair = store || createPromisePair()
        store = promisePair
        return promisePair.promise
      }
      return {
        peek,
        consume: () => {
          const shouldNullify = !!store && 'state' in store
          const retval = peek()
          if (shouldNullify) {
            store = null
          }
          return retval
        },
      }
    }

    return {
      kill: () => {
        if (store && 'control' in store) {
          store.control.resolve(Done)
        }
        store = null
      },
      fail: (f: MachineRunnerFailure) => {
        if (store && 'control' in store) {
          store.control.reject(f)
        }
        store = null
      },
      push: (state: S) => {
        if (topLevelDestruction.isDestroyed()) return

        if (store && 'control' in store) {
          store.control.resolve(wrapAsIteratorResult(state))
          store = null
        } else {
          store = { state }
        }
      },
      state: () => (store && 'state' in store ? store.state : undefined),
      generateConsumeAPI,
    }
  }

  type RequestedPromisePair<T extends any> = {
    promise: Promise<T>
    control: {
      resolve: (_: T) => unknown
      reject: (_: unknown) => unknown
    }
  }

  const createPromisePair = <T extends any>(): RequestedPromisePair<T> => {
    const self: RequestedPromisePair<T> = {
      promise: null as any,
      control: null as any,
    }

    self.promise = new Promise<T>(
      (resolve, reject) =>
        (self.control = {
          resolve,
          reject,
        }),
    )

    return self
  }
}

/**
 * StateOpaque is an opaque snapshot of a MachineRunner state. A StateOpaque
 * does not have direct access to the state's payload or command. In order to
 * access the state's payload, a StateOpaque has to be successfully cast into a
 * particular typed State.
 */
export interface StateOpaque<
  SwarmProtocolName extends string,
  MachineName extends string,
  StateName extends string = string,
  Payload = unknown,
  Commands extends CommandDefinerMap<
    object,
    any,
    Contained.ContainedEvent<MachineEvent.Any>[]
  > = object,
> extends StateRaw<StateName, Payload> {
  /**
   * Checks if the StateOpaque's type equals to the StateFactory's type.
   *
   * @param factory - A StateFactory used to narrow the StateOpaque's type.
   *
   * @return boolean that narrows the type of the StateOpaque based on the
   * supplied StateFactory.
   *
   * @example
   * const state = machine.get()
   * if (state.is(HangarControlIdle)) {
   *   // StateOpaque is narrowed inside this block
   * }
   */
  is<
    DeduceMachineName extends MachineName,
    DeduceStateName extends string,
    DeducePayload,
    DeduceCommands extends CommandDefinerMap<
      object,
      any,
      Contained.ContainedEvent<MachineEvent.Any>[]
    > = object,
  >(
    factory: StateFactory<
      SwarmProtocolName,
      DeduceMachineName,
      any,
      DeduceStateName,
      DeducePayload,
      DeduceCommands
    >,
  ): this is StateOpaque<
    SwarmProtocolName,
    DeduceMachineName,
    DeduceStateName,
    DeducePayload,
    DeduceCommands
  >

  /**
   * Attempt to cast the StateOpaque into a specific StateFactory and optionally
   * transform the value with the `then` function. Whether casting is successful
   * or not depends on whether the StateOpaque's State matches the factory
   * supplied via the first parameter.
   *
   * @param factory - A StateFactory used to cast the StateOpaque.
   *
   * @param then - an optional transformation function accepting the typed state
   * and returns an arbitrary value. This function will be executed if the
   * casting is successful.
   *
   * @return a typed State with access to payload and commands if the `then`
   * function is not supplied and the casting is successful, any value returned
   * by the `then` function if supplied and casting is successful, null if
   * casting is not successful.
   *
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
    DeduceMachineName extends MachineName,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >(
    factory: StateFactory<
      SwarmProtocolName,
      DeduceMachineName,
      any,
      StateName,
      StatePayload,
      Commands
    >,
  ): State<StateName, StatePayload, Commands> | undefined

  /**
   * Attempt to cast the StateOpaque into a specific StateFactory and optionally
   * transform the value with the `then` function. Whether casting is successful
   * or not depends on whether the StateOpaque's State matches the factory
   * supplied via the first parameter.
   *
   * @param factory - A StateFactory used to cast the StateOpaque.
   *
   * @param then - an optional transformation function accepting the typed state
   * and returns an arbitrary value. This function will be executed if the
   * casting is successful.
   *
   * @return a typed State with access to payload and commands if the `then`
   * function is not supplied and the casting is successful, any value returned
   * by the `then` function if supplied and casting is successful, null if
   * casting is not successful.
   *
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
    DeduceMachineName extends MachineName,
    DeduceFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
    Then extends (arg: State<StateName, StatePayload, Commands>) => any,
  >(
    factory: StateFactory<
      SwarmProtocolName,
      DeduceMachineName,
      DeduceFactories,
      StateName,
      StatePayload,
      Commands
    >,
    then: Then,
  ): ReturnType<Then> | undefined

  /**
   * Cast into a typed State. Usable only inside a block where this
   * StateOpaque's type is narrowed.
   *
   * @return typed State with access to payload and commands.
   *
   * @example
   * const state = machine.get()
   * if (state.is(HangarControlIdle)) {
   *   const typedState = state.cast()                  // typedState is an instance of HangarControlIdle
   *   console.log(typedState.payload.dockingRequests)  // payload is accessible
   *   console.log(typedState.commands())                 // commands MAY be accessible depending on the state of the MachineRunners
   * }
   */
  cast(): State<StateName, Payload, Commands>
}

export namespace StateOpaque {
  /**
   * The widest type of StateOpaque. Any other StateOpaque extends this type
   */
  export type Any = StateOpaque<string, string, string, any, object>

  /**
   * Derive StateOpaque type from a SwarmProtocol, a Machine, or a MachineRunner
   * @example
   *
   * const HangarBay = SwarmProtocol.make(
   *   'HangarBay',
   *   [HangarDoorTransitioning, HangarDoorClosed, HangarDoorOpen]
   * )
   * const Door = HangarBay.makeMachine('door')
   * const Initial = Door.designEmpty().finish()
   * const machineRunner = createMachineRunner(actyx, where, Passenger.Initial, void 0);
   *
   * // Two types below refers to any StateOpaque coming from Door machine, HangarBay protocol
   * type ThisStateOpaque1 = StateOpaque.Of<typeof machineRunner>;
   * type ThisStateOpaque2 = StateOpaque.Of<typeof Door>;
   *
   * // The type below refers to any StateOpaque coming from HangarBay protocol
   * type ThisStateOpaque3 = StateOpaque.Of<typeof HangarBay>;
   */
  export type Of<M extends MachineRunner.Any | Machine.Any | SwarmProtocol<any, any>> =
    M extends MachineRunner<infer S, infer N, infer SU>
      ? StateOpaque<S, N, string, SU>
      : M extends Machine<infer S, infer N, any>
      ? StateOpaque<S, N, string, unknown>
      : M extends SwarmProtocol<infer S, any>
      ? StateOpaque<S, any, string, unknown>
      : never
}

export namespace ImplStateOpaque {
  export const isExpired = (
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory.Any,
  ) =>
    stateAndFactoryForSnapshot.factory !== internals.current.factory ||
    stateAndFactoryForSnapshot.data !== internals.current.data

  export const isCommandLocked = (internals: RunnerInternals.Any): boolean =>
    !!internals.commandLock

  export const isRunnerDestroyed = (internals: RunnerInternals.Any): boolean =>
    internals.destruction.isDestroyed()

  export const make = <
    SwarmProtocolName extends string,
    MachineName extends string,
    StateUnion extends unknown,
  >(
    internals: RunnerInternals.Any,
    stateAndFactoryForSnapshot: StateAndFactory<SwarmProtocolName, MachineName, any, any, any, any>,
  ): StateOpaque<SwarmProtocolName, MachineName, string, StateUnion> => {
    type ThisStateOpaque = StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>

    // Captured data at snapshot call-time
    const stateAtSnapshot = stateAndFactoryForSnapshot.data
    const factoryAtSnapshot = stateAndFactoryForSnapshot.factory as StateFactory.Any

    const commandGeneratorCriteria: CommandGeneratorCriteria = {
      isCaughtUp: () => internals.caughtUp && internals.caughtUpFirstTime,
      isQueueEmpty: () => internals.queue.length === 0,
      isNotExpired: () => !ImplStateOpaque.isExpired(internals, stateAndFactoryForSnapshot),
      isNotLocked: () => !ImplStateOpaque.isCommandLocked(internals),
      isNotDestroyed: () => !ImplStateOpaque.isRunnerDestroyed(internals),
    }

    const commandEnabledAtSnapshot =
      CommandGeneratorCriteria.allOkForSnapshotTimeCommandEnablementAssessment(
        commandGeneratorCriteria,
      )

    const is: ThisStateOpaque['is'] = (factory) => factoryAtSnapshot.mechanism === factory.mechanism

    const as: ThisStateOpaque['as'] = <
      StateName extends string,
      StatePayload,
      Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
    >(
      factory: StateFactory<SwarmProtocolName, MachineName, any, StateName, StatePayload, Commands>,
      then?: any,
    ) => {
      if (factoryAtSnapshot.mechanism === factory.mechanism) {
        const snapshot = ImplState.makeForSnapshot({
          factory: factoryAtSnapshot,
          commandEmitFn: internals.commandEmitFn,
          commandGeneratorCriteria,
          commandEnabledAtSnapshot,
          stateAtSnapshot,
        })
        return then ? then(snapshot) : snapshot
      }
      return undefined
    }

    const cast: ThisStateOpaque['cast'] = () =>
      ImplState.makeForSnapshot({
        factory: factoryAtSnapshot,
        commandEmitFn: internals.commandEmitFn,
        commandGeneratorCriteria,
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
 * payload and the associated commands.
 *
 * Commands are available only if at the time the snapshot is created these
 * conditions are met: 1.) the MachineRunner has caught up with Actyx's events
 * stream, 2.) there are no events in the internal queue awaiting processing,
 * 3.) no command has been issued from this State yet.
 *
 * Commands run the associated handler defined on the state-design step and will
 * persist all the events returned by the handler into Actyx. It returns a
 * promise that is resolved when persisting is successful and rejects when
 * persisting is failed.
 */
export type State<
  StateName extends string,
  StatePayload,
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = StateRaw<StateName, StatePayload> & {
  /**
   * A dictionary containing commands previously registered during the State
   * Design process. Undefined when commands are unavailable during the time of
   * the state snapshot.
   *
   * Commands are available only if at the time the snapshot is created these
   * conditions are met: 1.) the MachineRunner has caught up with Actyx's events
   * stream, 2.) there are no events in the internal queue awaiting processing,
   * 3.) no command has been issued from this State yet
   *
   * Commands run the associated handler defined on the state-design step and
   * will persist all the events returned by the handler into Actyx. It returns
   * a promise that is resolved when persisting is successful and rejects when
   * persisting is failed.
   */
  commands: CommandsOfStateGenerator<Commands>
}

type CommandsOfState<
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = ToCommandSignatureMap<Commands, any, Contained.ContainedEvent<MachineEvent.Any>[]>

type CommandsOfStateGenerator<
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
> = () =>
  | ToCommandSignatureMap<Commands, any, Contained.ContainedEvent<MachineEvent.Any>[]>
  | undefined

/**
 * A collection of type utilities around the State.
 */
export namespace State {
  export type Minim = State<
    string,
    any,
    CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>
  >

  export type NameOf<T extends State.Minim> = T extends State<infer Name, any, any> ? Name : never

  /**
   * Extract the typed state from a StateFactory.
   *
   * @example
   * const Active = machine
   *   .designEmpty("Active")
   *   .command("deactivate", [Deactivate], () => [Deactivate.make()])
   *   .finish();
   *
   * // this function accepts a typed state instance of Active
   * const deactivate = (state: StateOf<Active>) => {
   *   if (SOME_THRESHOLD()) {
   *     state.commands()?.deactivate()
   *   }
   * }
   *
   * // calling the function
   * machine.get()?.as(Active, (state) => deactivate(state));
   */
  export type Of<T extends StateFactory.Any> = T extends StateFactory<
    any,
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
    SwarmProtocolName extends string,
    MachineName extends string,
    MachineEventFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >({
    factory,
    commandGeneratorCriteria,
    commandEnabledAtSnapshot,
    commandEmitFn,
    stateAtSnapshot,
  }: {
    factory: StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      StateName,
      StatePayload,
      Commands
    >
    commandGeneratorCriteria: CommandGeneratorCriteria
    commandEnabledAtSnapshot: boolean
    commandEmitFn: CommandCallback<MachineEventFactories>
    stateAtSnapshot: StateRaw<StateName, StatePayload>
  }): State<StateName, StatePayload, Commands> => {
    const mechanism = factory.mechanism
    const commands = () =>
      commandEnabledAtSnapshot && CommandGeneratorCriteria.allOk(commandGeneratorCriteria)
        ? makeCommandsOfState({
            mechanismCommands: mechanism.commands,
            stateAtSnapshot,
            commandGeneratorCriteria,
            commandEmitFn,
          })
        : undefined

    const snapshot = {
      type: stateAtSnapshot.type,
      payload: stateAtSnapshot.payload,
      commands,
    }

    return snapshot
  }

  const makeCommandsOfState = <
    MachineEventFactories extends MachineEvent.Factory.Any,
    StateName extends string,
    StatePayload extends any,
    Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
  >({
    mechanismCommands,
    commandGeneratorCriteria,
    commandEmitFn,
    stateAtSnapshot,
  }: {
    mechanismCommands: Commands
    stateAtSnapshot: StateRaw<StateName, StatePayload>
    commandGeneratorCriteria: CommandGeneratorCriteria
    commandEmitFn: CommandCallback<MachineEventFactories>
  }): CommandsOfState<Commands> => {
    const commandCalls: ToCommandSignatureMap<
      Commands,
      any,
      Contained.ContainedEvent<MachineEvent.Any>[]
    > = convertCommandMapToCommandSignatureMap<
      any,
      CommandContext<StatePayload, MachineEvent.Factory.Any>,
      Contained.ContainedEvent<MachineEvent.Of<MachineEventFactories>>[]
    >(mechanismCommands, {
      commandGeneratorCriteria,
      getActualContext: () => makeContextGetter(stateAtSnapshot),
      onReturn: commandEmitFn,
    })

    return commandCalls
  }

  const makeContextGetter = <StateName extends string, StatePayload extends any>(
    stateAtSnapshot: StateRaw<StateName, StatePayload>,
  ): Readonly<CommandContext<StatePayload, MachineEvent.Factory.Any>> => ({
    self: stateAtSnapshot.payload,
    withTags: (additionalTags, payload) =>
      Contained.ContainedPayload.wrap(payload, {
        additionalTags,
      }),
  })
}

const makeIdentityStringForCommandError = (
  swarmProtocolName: string,
  machineName: string,
  tags: string,
  commandKey: string,
) =>
  [
    `protocol:${swarmProtocolName}`,
    `machine:${machineName}`,
    `tags:${tags.toString()}`,
    `commandKey:${commandKey}`,
  ].join(', ')

const makeBootTimeLogger = (
  identity: Readonly<{
    swarmProtocolName: string
    machineName: string
    tags: Readonly<Tags>
  }>,
  emitters: TypedEventEmitter<CommonEmitterEventMap>[],
) => {
  const initDate = new Date()
  let eventCount = 0
  return {
    incrementEventCount: () => {
      eventCount++
    },
    emit: () => {
      const listeningEmitters = emitters.filter(
        (emitter) => emitter.listenerCount('debug.bootTime') > 0,
      )

      if (listeningEmitters.length > 0) {
        const durationMs = new Date().getTime() - initDate.getTime()
        listeningEmitters.forEach((emitter) =>
          emitter.emit('debug.bootTime', {
            durationMs,
            identity,
            eventCount,
          }),
        )
      }
    },
  }
}
