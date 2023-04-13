import { MsgType } from '@actyx/sdk'
import { MachineEvent } from '../index.js'
import { State, SubscribeFn } from '../runner/runner.js'
import { CommandDefinerMap, StateFactory } from '../design/state.js'
import { createMachineRunnerInternal } from '../runner/runner.js'

const mockMeta = () => ({
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

export namespace Subscription {
  export const make = <RegisteredEventsFactoriesTuple extends MachineEvent.Factory.Any[]>() => {
    type Subscribe = SubscribeFn<RegisteredEventsFactoriesTuple>
    type Cb = Parameters<Subscribe>[0]
    const cancel = () => {
      if (data.cb === null) throw new Error('not subscribed')
      data.cb = null
    }
    const subscribe: Subscribe = (onEvent) => {
      if (data.cb !== null) throw new Error('already subscribed')
      data.cb = onEvent
      return data.cancel
    }

    const data = {
      cb: null as null | Cb,
      cancel,
      subscribe,
    }
    return data
  }
}

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
) => {
  const delayer = PromiseDelay.make()
  const sub = Subscription.make<RegisteredEventsFactoriesTuple>()
  const persisted: MachineEvent.Any[] = []

  const feed = (
    ev: MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>[],
    props?: { caughtUp: true },
  ) => {
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

  const timeTravel = () => {
    if (sub.cb === null) throw new Error('not subscribed')
    const cb = sub.cb
    cb({ type: MsgType.timetravel, trigger: { lamport: 0, offset: 0, stream: 'stream' } })
    if (sub.cb === null) throw new Error('did not resubscribe')
  }

  const assertAs = <
    N extends string,
    P,
    C extends CommandDefinerMap<any, any, MachineEvent.Any[]>,
    Then extends (state: State<N, P, C>) => any,
  >(
    factory: StateFactory<SwarmProtocolName, MachineName, RegisteredEventsFactoriesTuple, N, P, C>,
    then?: Then,
  ) => {
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
  }
  // Below: public

  const delay = {
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
      delay,
      feed,
      timeTravel,
      assertAs,
    },
  }
}
