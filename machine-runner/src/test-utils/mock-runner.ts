import { ActyxEvent, MsgType, Tag } from '@actyx/sdk'
import { MachineEvent } from '../index.js'
import { MachineRunner, State, SubscribeFn } from '../runner/runner.js'
import { CommandDefinerMap, Contained, StateFactory } from '../design/state.js'
import { createMachineRunnerInternal } from '../runner/runner.js'
import { RetvalOrElse } from '../utils/type-utils.js'

/**
 * Detached machine runner used for unit tests. Events coming into the machine
 * are manually fed instead of being supplied by Actyx.
 */
export type MockMachineRunner<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateUnion extends unknown,
> = MachineRunner<SwarmProtocolName, MachineName, StateUnion> & {
  /**
   * Contains test utilities for MockMachineRunner
   * @see MockMachineRunnerTestUtils for more information
   */
  test: MockMachineRunnerTestUtils<SwarmProtocolName, MachineName, MachineEventFactories>

  /**
   * Add type refinement to the state payload produced by the mock
   * machine-runner
   *
   * @param stateFactories - All state factories produced by the
   * MachineProtocol. All state factories must be included, otherwise (i.e.
   * passing only some state factories) will result in an exception being
   * thrown.
   * @return a reference the mock machine-runner instance with added type
   * refinement
   *
   * @example
   * const machineRunner = createMockMachineRunner(StateA, undefined)
   *  .refineStateType([StateA, StateB, StateC] as const);
   *
   * const stateSnapshot = machineRunner.get();
   * if (!stateSnapshot) return
   *
   * const payload = stateSnapshot.payload; // union of payloads of StateA, StateB, and StateC
   */
  refineStateType: <
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    Factories extends Readonly<StateFactory<SwarmProtocolName, MachineName, any, any, any, any>[]>,
  >(
    _: Factories,
  ) => MockMachineRunner<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateFactory.ReduceIntoPayload<Factories>
  >
}

/**
 * Contains test utilities for MockMachineRunner
 */
type MockMachineRunnerTestUtils<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
> = {
  /**
   * Feed events into the MachineRunner.
   * @example
   * const machineRunner = createMockMachineRunner(Passenger.Initial, void 0)
   *
   * machineRunner.test.feed([
   *   Requested.make({
   *     destination: requestDestination,
   *     pickup: requestPickup,
   *   }),
   *   Bid.make({
   *     price: bidPrice,
   *     time: bidTime.toISOString(),
   *   }),
   *   BidderID.make({
   *     id: bidderId,
   *   }),
   * ])
   */
  feed: (
    ev: MachineEvent.Of<MachineEventFactories>[],
    props?: { caughtUp: boolean },
  ) => ReturnType<Subscription.CallbackFnOf<MachineEvent.Of<MachineEventFactories>>>

  /**
   * Asserts the state of the machine as being in the state  of a particular
   * StateFactory.
   * @example
   * const auction = machineRunner.test.assertAs(Passenger.Auction, (auction) => {
   *   expect(auction.payload.bids.at(0)).toEqual({
   *     bidderID: bidderId,
   *     time: bidTime,
   *     price: bidPrice,
   *   } as BidData)
   *
   *   return auction
   * })
   *
   * @example
   * const auction = machineRunner.test.assertAs(Passenger.Auction)
   * expect(auction.payload.bids.at(0)).toEqual({
   *   bidderID: bidderId,
   *   time: bidTime,
   *   price: bidPrice,
   * } as BidData)
   */
  assertAs: <
    N extends string,
    P,
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    C extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    Then extends (state: State<N, P, C>) => any,
  >(
    ...args:
      | [StateFactory<SwarmProtocolName, MachineName, MachineEventFactories, N, P, C>]
      | [StateFactory<SwarmProtocolName, MachineName, MachineEventFactories, N, P, C>, Then]
  ) => RetvalOrElse<typeof args[1], State<N, P, C>>
}

export type MockMachineRunnerDelayUtils = {
  toggle: PromiseDelay['toggle']
}

// Implementations
// ===============

/**
 * Creates a MockMachineRunner. This function intended as the equivalent of
 * createMachineRunner for unit-testing purpose.
 * @see MockMachineRunner for more information
 * @example
 * const machineRunner = createMockMachineRunner(Passenger.Initial, void 0)
 */
export const createMockMachineRunner = <
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  Payload,
  StateUnion extends unknown,
>(
  factory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    string,
    Payload,
    object
  >,
  payload: Payload,
): MockMachineRunner<SwarmProtocolName, MachineName, MachineEventFactories, StateUnion> => {
  type Self = MockMachineRunner<SwarmProtocolName, MachineName, MachineEventFactories, StateUnion>

  const delayer = PromiseDelay.make()
  const sub = Subscription.make<MachineEvent.Of<MachineEventFactories>>()
  const persisted: ActyxEvent<MachineEvent.Any>[] = []

  const feed: Self['test']['feed'] = (ev, props) => {
    const caughtUp = props === undefined || props.caughtUp === true
    if (sub.cb === null) throw new Error('not subscribed')
    return sub.cb({
      type: MsgType.events,
      caughtUp,
      events: ev.map((payload) => ({
        meta: mockMeta(),
        payload,
      })),
    })
  }

  const assertAs: Self['test']['assertAs'] = (...args) => {
    const [factory, then] = args
    const opaque = machine.get()
    if (!opaque) {
      throw new Error(`MachineRunnerTestError: opaque not retrievable yet`)
    }
    const snapshot = opaque.as(factory)
    if (!snapshot) {
      throw new Error(
        `MachineRunnerTestError: expected type ${factory.mechanism.name} found ${opaque.type}`,
      )
    }
    if (then) {
      return then(snapshot)
    }
    return snapshot
  }
  // Below: public

  const machine: MachineRunner<SwarmProtocolName, MachineName, StateUnion> =
    createMachineRunnerInternal(
      sub.subscribe,
      async (events) => {
        const actyxEvents = events.map(
          ({ event: payload, tags }): ActyxEvent<MachineEvent.Of<MachineEventFactories>> => ({
            meta: { ...mockMeta(), tags },
            payload: payload as MachineEvent.Of<MachineEventFactories>,
          }),
        )
        persisted.push(...actyxEvents)
        const pair = delayer.make()
        const retval = pair[0].then(() => {
          feed(
            actyxEvents.map((e) => e.payload),
            { caughtUp: true },
          )
          return actyxEvents.map((e) => e.meta)
        })
        return retval
      },
      Tag(factory.mechanism.protocol.swarmName),
      factory,
      payload,
    )

  // TODO: make shareable with runner.ts
  feed([], { caughtUp: true })

  const refineStateType = <
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    Factories extends Readonly<StateFactory<SwarmProtocolName, MachineName, any, any, any, any>[]>,
  >(
    factories: Factories,
  ) => {
    const allStateNames = new Set(factory.mechanism.protocol.states.registeredNames)
    factories.forEach((factory) => allStateNames.delete(factory.mechanism.name))
    if (allStateNames.size > 0) {
      throw new Error(
        'Call to refineStateType fails, some possible states are not passed into the parameter. Pass all states as arguments.',
      )
    }

    return self as MockMachineRunner<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      StateFactory.ReduceIntoPayload<Factories>
    >
  }

  const self: Self = {
    ...machine,
    refineStateType,
    test: {
      assertAs,
      feed,
    },
  }

  return self
}

// Utilities
// ===============

export const mockMeta = () => ({
  isLocalEvent: true,
  tags: [],
  timestampMicros: 0,
  timestampAsDate: () => new Date(),
  lamport: 1,
  eventId: 'id1',
  appId: 'test',
  stream: 'stream1',
  offset: 3,
})

type PromiseDelay = ReturnType<typeof PromiseDelay['make']>
export namespace PromiseDelay {
  type Pair = [
    Promise<void>,
    { resolve: () => void; reject: () => void; isFinished: () => boolean },
  ]

  export const make = () => {
    const data = {
      isDelaying: false as boolean,
      delayedCommands: [] as Pair[],
    }

    const make = (): Pair => {
      let finished = false
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const pair: Pair = [undefined as any, undefined as any]
      pair[0] = new Promise<void>((resolve, reject) => {
        pair[1] = {
          resolve,
          reject,
          isFinished: () => finished,
        }
      }).finally(() => (finished = true))

      if (data.isDelaying) {
        data.delayedCommands.push(pair)
      } else {
        pair[1].resolve()
      }
      return pair
    }

    const toggle = async (
      delayControl: { delaying: true } | { delaying: false; reject?: boolean },
    ): Promise<void> => {
      data.isDelaying = delayControl.delaying
      if (delayControl.delaying) return
      await Promise.all(
        data.delayedCommands.map(([promise, control]) => {
          if (delayControl.reject) {
            control.reject()
          } else {
            control.resolve()
          }
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          return promise.catch(() => {})
        }),
      )
      data.delayedCommands = []
    }

    return {
      make,
      toggle,
    }
  }
}

export namespace Subscription {
  export type CallbackFnOf<MachineEvents extends MachineEvent.Any> = Parameters<
    SubscribeFn<MachineEvents>
  >[0]

  export const make = <MachineEvents extends MachineEvent.Any>() => {
    type Subscribe = SubscribeFn<MachineEvents>
    type Callback = Parameters<Subscribe>[0]
    type ErrorCallback = Parameters<Subscribe>[1]

    const cancel = () => {
      if (data.cb === null) throw new Error('not subscribed')
      if (data.err === null) throw new Error('not subscribed')
      data.cb = null
      data.err = null
    }

    const subscribe: Subscribe = (onEvent, onError) => {
      if (data.cb !== null) throw new Error('already subscribed')
      if (data.err !== null) throw new Error('already subscribed')
      data.cb = onEvent
      data.err = onError || null
      return data.cancel
    }

    const data = {
      cb: null as null | Callback,
      err: null as null | Exclude<ErrorCallback, undefined>,
      cancel,
      subscribe,
    }
    return data
  }
}
