import { MsgType } from '@actyx/sdk'
import { MachineEvent } from '../index.js'
import { MachineRunner, State, SubscribeFn } from '../runner/runner.js'
import { CommandDefinerMap, StateFactory } from '../design/state.js'
import { createMachineRunnerInternal } from '../runner/runner.js'
import { RetvalOrElse } from '../utils/type-utils.js'

/**
 * Detached machine runner used for unit tests. Events coming into the machine
 * are manually fed instead of being supplied by Actyx.
 */
export type MockMachineRunner<
  SwarmProtocolName extends string,
  MachineName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[],
> = MachineRunner<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple> & {
  /**
   * Contains test utilities for MockMachineRunner
   * @see MockMachineRunnerTestUtils for more information
   */
  test: MockMachineRunnerTestUtils<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple>
}

/**
 * Contains test utilities for MockMachineRunner
 */
type MockMachineRunnerTestUtils<
  SwarmProtocolName extends string,
  MachineName extends string,
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[],
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
    ev: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>[],
    props?: { caughtUp: boolean },
  ) => ReturnType<Subscription.CallbackFnOf<RegisteredEventsFactoriesTuple>>

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
    C extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    Then extends (state: State<N, P, C>) => any,
  >(
    ...args:
      | [StateFactory<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple, N, P, C>]
      | [
          StateFactory<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple, N, P, C>,
          Then,
        ]
  ) => RetvalOrElse<typeof args[1], State<N, P, C>>

  delay: MockMachineRunnerDelayUtils
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
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[],
  Payload,
>(
  factory: StateFactory<
    SwarmProtocolName,
    MachineName,
    RegisteredEventsFactoriesTuple,
    string,
    Payload,
    object
  >,
  payload: Payload,
): MockMachineRunner<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple> => {
  type Self = MockMachineRunner<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple>

  const delayer = PromiseDelay.make()
  const sub = Subscription.make<RegisteredEventsFactoriesTuple>()
  const persisted: MachineEvent.Any[] = []

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

  const delay: Self['test']['delay'] = {
    toggle: delayer.toggle,
  }

  const machine = createMachineRunnerInternal(
    sub.subscribe,
    async (events) => {
      persisted.push(...events)
      const pair = delayer.make()
      const retval = pair[0].then(() => {
        feed(events, { caughtUp: true })
        return events.map((_) => mockMeta())
      })
      return retval
    },
    factory,
    payload,
  )

  // TODO: make shareable with runner.ts
  feed([], { caughtUp: true })

  return {
    ...machine,
    test: {
      assertAs,
      feed,
      delay,
    },
  }
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

// TODO: reuse in unit test

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

// TODO: reuse in unit test

export namespace Subscription {
  export type CallbackFnOf<RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[]> =
    Parameters<SubscribeFn<RegisteredEventsFactoriesTuple>>[0]

  export const make = <RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[]>() => {
    type Subscribe = SubscribeFn<RegisteredEventsFactoriesTuple>
    type Cb = Parameters<Subscribe>[0]
    type ErrCb = Parameters<Subscribe>[1]

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
      cb: null as null | Cb,
      err: null as null | Exclude<ErrCb, undefined>,
      cancel,
      subscribe,
    }
    return data
  }
}
