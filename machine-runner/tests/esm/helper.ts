import { ActyxEvent, MsgType, Tag } from '@actyx/sdk'
import { expect } from '@jest/globals'
import { StateOpaque, MachineEvent, StateFactory, State, globals } from '../../lib/esm/index.js'
import { createMachineRunnerInternal } from '../../lib/esm/runner/runner.js'
import { PromiseDelay, Subscription, mockMeta } from '../../lib/esm/test-utils/mock-runner.js'
import { CommonEmitterEventMap, TypedEventEmitter } from '../../lib/esm/runner/runner-utils.js'
import { EventEmitter } from 'events'

export const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur))

// TODO: join this cloned code with the one on runner.tss
type RequestedPromisePair<T extends any> = {
  promise: Promise<T>
  control: {
    resolve: (_: T) => unknown
    reject: (_: unknown) => unknown
  }
}
export const createPromisePair = <T extends any>(): RequestedPromisePair<T> => {
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

export const errorCatcher = (emitter: TypedEventEmitter<Pick<CommonEmitterEventMap, 'error'>>) => {
  const self = {
    error: null as unknown,
  }
  emitter.once('error', (e) => {
    self.error = e
  })
  return self
}

export class Unreachable extends Error {
  constructor() {
    super('should be unreachable')
  }
}

export class Runner<
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  Payload,
  MachineEvent extends MachineEvent.Any = MachineEvent.Of<MachineEventFactories>,
> {
  static EVENT_ROUNDTRIP_DELAY = 1

  private persisted: ActyxEvent<MachineEvent.Any>[] = []
  private unhandled: MachineEvent.Any[] = []
  private caughtUpHistory: StateOpaque<SwarmProtocolName, MachineName, string, unknown>[] = []
  private stateChangeHistory: {
    state: StateOpaque<SwarmProtocolName, MachineName, string, unknown>
    unhandled: MachineEvent.Any[]
  }[] = []
  private sub = Subscription.make<MachineEvent>()
  public machine

  private commandDelay = PromiseDelay.make()
  public caughtUpDelay = CaughtUpDelay.make(async () => {
    await this.eventRoundtrip.waitAllDone()
    await this.feed([], true)
  })
  public eventRoundtrip = ActivePromiseSet.make()

  public tag
  /* eslint-disable @typescript-eslint/no-explicit-any */
  constructor(
    factory: StateFactory<SwarmProtocolName, MachineName, MachineEventFactories, any, Payload, any>,
    payload: Payload,
  ) {
    const tag = Tag(factory.mechanism.protocol.swarmName).and('test-tag-and')
    this.tag = tag
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const machine = createMachineRunnerInternal(
      this.sub.subscribe,
      async (events) => {
        const actyxEvents = events.map(
          ({ event: payload, tags }): ActyxEvent<MachineEvent.Of<MachineEventFactories>> => ({
            meta: { ...mockMeta(), tags },
            payload: payload as MachineEvent.Of<MachineEventFactories>,
          }),
        )

        const pair = this.commandDelay.make()
        const caughtUpDelay = this.caughtUpDelay.shouldDelay()
        const commandPromise = pair[0].then(() => actyxEvents.map((e) => e.meta))

        // event roundtrip
        commandPromise
          .then(() =>
            this.eventRoundtrip.queue(async () => {
              await sleep(Runner.EVENT_ROUNDTRIP_DELAY)
              this.persisted.push(...actyxEvents)
              this.feed(
                actyxEvents.map((e) => e.payload),
                !caughtUpDelay,
              )
            }),
          )
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          .catch(() => {})

        return commandPromise
      },
      tag,
      factory,
      payload,
    )

    machine.events.addListener('audit.state', ({ state }) => {
      if (!state) return
      this.stateChangeHistory.unshift({
        state,
        unhandled: this.unhandled,
      })
      this.unhandled = []
    })

    machine.events.addListener('change', (snapshot) => {
      this.caughtUpHistory.unshift(snapshot)
    })

    machine.events.addListener('audit.dropped', (dropped) => {
      this.unhandled.push(dropped.event.payload)
    })

    this.machine = machine
  }

  resetStateChangeHistory = () => (this.stateChangeHistory = [])
  resetCaughtUpHistory = () => (this.caughtUpHistory = [])

  async toggleCommandDelay(
    delayControl: { delaying: true } | { delaying: false; reject?: boolean },
  ): Promise<void> {
    await this.commandDelay.toggle(delayControl)
    if (!delayControl.delaying) {
      await this.eventRoundtrip.waitAllDone()
    }
  }

  feed = (ev: MachineEvent[], caughtUp: boolean) => {
    const cb = this.sub.cb
    if (!cb) {
      console.warn('not subscribed')
      return
    }
    return cb({
      type: MsgType.events,
      caughtUp,
      events: ev.map((payload) => ({
        meta: mockMeta(),
        payload,
      })),
    })
  }

  timeTravel() {
    if (this.sub.cb === null) throw new Error('not subscribed')
    const cb = this.sub.cb
    cb({ type: MsgType.timetravel, trigger: { lamport: 0, offset: 0, stream: 'stream' } })
    if (this.sub.cb === null) throw new Error('did not resubscribe')
  }

  error() {
    const err = this.sub.err
    if (!err) throw new Error('not subscribed')
    err(new Error('boo!'))
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  assertLastStateChange<
    Factory extends StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      any,
      any,
      any
    >,
  >(
    factory: Factory,
    assertStateFurther?: (params: {
      snapshot: State.Of<Factory>
      unhandled: MachineEvent.Any[]
    }) => void,
  ) {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const last = this.stateChangeHistory.at(0)
    if (!last) throw new Unreachable()

    const { state, unhandled } = last

    const snapshot = state.as(factory) as State.Of<Factory> | void
    expect(snapshot).toBeTruthy()
    if (assertStateFurther && !!snapshot) {
      assertStateFurther({ snapshot, unhandled })
    }
    // expect(cmd0).toBe(cmd)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  assertLastCaughtUp<
    Factory extends StateFactory<
      SwarmProtocolName,
      MachineName,
      MachineEventFactories,
      any,
      any,
      any
    >,
  >(factory: Factory, assertStateFurther?: (params: { snapshot: State.Of<Factory> }) => void) {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const state = this.caughtUpHistory.at(0)
    if (!state) throw new Unreachable()

    const snapshot = state.as(factory) as State.Of<Factory> | void
    expect(snapshot).toBeTruthy()
    if (assertStateFurther && !!snapshot) {
      assertStateFurther({ snapshot })
    }
    // expect(cmd0).toBe(cmd)
  }

  getLastUnhandled = () => [...this.unhandled]

  assertNoStateChange = () => expect(this.stateChangeHistory.length).toBe(0)
  assertNoCaughtUp = () => expect(this.caughtUpHistory.length).toBe(0)
  assertNoCurrentUnhandled = () => expect(this.unhandled.length).toBe(0)

  assertSubscribed(b: boolean) {
    if (b) {
      expect(this.sub.cb).not.toBeNull()
      expect(this.sub.err).not.toBeNull()
    } else {
      expect(this.sub.cb).toBeNull()
      expect(this.sub.err).toBeNull()
    }
  }

  assertPersistedAsMachineEvent = async (...e: MachineEvent[]) => {
    await this.eventRoundtrip.waitAllDone()
    expect(this.persisted.map((e) => e.payload)).toEqual(e)
    this.persisted.length = 0
  }

  assertPersistedWithFn = async (fn: (events: ActyxEvent<MachineEvent.Any>[]) => void) => {
    await this.eventRoundtrip.waitAllDone()
    fn([...this.persisted])
    this.persisted.length = 0
  }

  clearPersisted() {
    this.persisted.length = 0
  }

  makeErrorCatchers() {
    return [errorCatcher(this.machine.events), errorCatcher(globals.emitter)]
  }
}

export const createBufferLog = () => {
  let buffer = ''

  const log: typeof console['error'] = (...args: []) => {
    args.forEach((arg) => {
      buffer = buffer + String(arg)
    })
  }

  return {
    log,
    get: () => buffer,
  }
}

export type ActivePromiseSet = ReturnType<typeof ActivePromiseSet['make']>
export namespace ActivePromiseSet {
  const EMPTY = 'empty'

  export const make = () => {
    const internals = {
      working: new Set<Promise<unknown>>(),
      emitter: new EventEmitter(),
    }
    internals.emitter.setMaxListeners(Infinity)

    const whenEmptyNotify = () => {
      if (internals.working.size === 0) {
        internals.emitter.emit(EMPTY, undefined)
      }
    }

    const queue = (fn: () => Promise<unknown>) => {
      const task = fn().finally(() => {
        internals.working.delete(task)
        whenEmptyNotify()
      })
      internals.working.add(task)
    }

    const waitAllDone = () =>
      new Promise<void>((res) => {
        if (internals.working.size === 0) {
          return res()
        }
        internals.emitter.once(EMPTY, res)
      })

    return { waitAllDone, queue }
  }
}

export type CaughtUpDelay = ReturnType<typeof CaughtUpDelay['make']>
export namespace CaughtUpDelay {
  export const make = (onRelease: () => Promise<unknown>) => {
    const internals = { delaying: false, buffered: false }

    const releaseBuffer = async () => {
      if (!internals.buffered) return
      internals.buffered = false
      await onRelease()
    }

    const toggle = async (delaying: boolean) => {
      internals.delaying = delaying
      if (!delaying) {
        await releaseBuffer()
      }
    }

    const shouldDelay = () => {
      internals.buffered = internals.delaying
      return internals.delaying
    }

    return { toggle, shouldDelay }
  }
}
