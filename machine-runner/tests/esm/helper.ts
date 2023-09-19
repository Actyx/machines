import { ActyxEvent, Metadata, MsgType, Tag, Tags } from '@actyx/sdk'
import { expect } from '@jest/globals'
import { StateOpaque, MachineEvent, StateFactory, State, globals } from '../../lib/esm/index.js'
import { createMachineRunnerInternal } from '../../lib/esm/runner/runner.js'
import { PromiseDelay, Subscription, mockMeta } from '../../lib/esm/test-utils/mock-runner.js'
import { CommonEmitterEventMap, TypedEventEmitter } from '../../lib/esm/runner/runner-utils.js'
import { MachineAnalysisResource } from '../../lib/esm/design/protocol.js'

export const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur))

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
  private persisted: ActyxEvent<MachineEvent.Any>[] = []
  private unhandled: MachineEvent.Any[] = []
  private caughtUpHistory: StateOpaque<SwarmProtocolName, MachineName, string, unknown>[] = []
  private stateChangeHistory: {
    state: StateOpaque<SwarmProtocolName, MachineName, string, unknown>
    unhandled: MachineEvent.Any[]
  }[] = []
  private delayer = PromiseDelay.make()
  private sub = Subscription.make<MachineEvent>()
  public machine

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
        const pair = this.delayer.make()
        const retval = pair[0].then(() => {
          this.persisted.push(...actyxEvents)
          this.feed(
            actyxEvents.map((e) => e.payload),
            true,
          )
          return actyxEvents.map((e) => e.meta)
        })
        return retval
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
    await this.delayer.toggle(delayControl)
  }

  feed(ev: MachineEvent[], caughtUp: boolean) {
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

  assertPersistedAsMachineEvent(...e: MachineEvent[]) {
    expect(this.persisted.map((e) => e.payload)).toEqual(e)
    this.persisted.length = 0
  }

  assertPersistedWithFn(fn: (events: ActyxEvent<MachineEvent.Any>[]) => void) {
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
