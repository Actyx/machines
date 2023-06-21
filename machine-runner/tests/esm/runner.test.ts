import { ActyxEvent, MsgType, Tag, Tags } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import {
  createMachineRunner,
  StateOpaque,
  MachineEvent,
  SwarmProtocol,
  StateFactory,
  State,
  StateMechanism,
} from '../../lib/esm/index.js'
import { createMachineRunnerInternal } from '../../lib/esm/runner/runner.js'
import { deepCopy } from '../../lib/esm/utils/object-utils.js'
import { NOP } from '../../lib/esm/utils/misc.js'
import {
  Equal,
  Expect,
  NotAnyOrUnknown,
  NotEqual,
  SerializableObject,
  SerializableValue,
} from '../../lib/esm/utils/type-utils.js'
import { MachineAnalysisResource } from '../../lib/esm/design/protocol.js'
import { PromiseDelay, Subscription, mockMeta } from '../../lib/esm/test-utils/mock-runner.js'
import * as ProtocolSwitch from './protocol-switch.js'
import * as ProtocolOneTwo from './protocol-one-two.js'
import * as ProtocolScorecard from './protocol-scorecard.js'

class Unreachable extends Error {
  constructor() {
    super('should be unreachable')
  }
}

// Mock Runner

class Runner<
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

  /* eslint-disable @typescript-eslint/no-explicit-any */
  constructor(
    factory: StateFactory<SwarmProtocolName, MachineName, MachineEventFactories, any, Payload, any>,
    payload: Payload,
  ) {
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
        this.persisted.push(...actyxEvents)
        const pair = this.delayer.make()
        const retval = pair[0].then(() => {
          this.feed(
            actyxEvents.map((e) => e.payload),
            true,
          )
          return actyxEvents.map((e) => e.meta)
        })
        return retval
      },
      Tag(factory.mechanism.protocol.swarmName),
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
}

describe('machine runner', () => {
  const { Events, Initial, Second } = ProtocolOneTwo
  const { One, Two } = Events

  it('should emit initial state', () => {
    const r = new Runner(Initial, { transitioned: false })

    r.feed([], false)
    r.assertNoStateChange()
    r.assertNoCaughtUp()
    r.assertNoCurrentUnhandled()

    r.feed([], true)
    r.assertNoStateChange()
    r.assertLastCaughtUp(Initial)
    r.assertNoCurrentUnhandled()
  })

  it('should run', () => {
    const r = new Runner(Initial, { transitioned: false })

    r.feed([{ type: 'One', x: 1 }], true)
    r.assertNoStateChange()
    r.assertLastCaughtUp(Initial, ({ snapshot }) => {
      expect(snapshot.payload.transitioned).toBe(false)
    })
    r.assertNoCurrentUnhandled()

    r.feed([{ type: 'Two', y: 2 }], true)
    r.assertLastCaughtUp(Second, ({ snapshot }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(2)
    })
    r.assertLastStateChange(Second, ({ snapshot }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(2)
    })
    r.assertNoCurrentUnhandled()

    r.resetCaughtUpHistory()
    r.resetStateChangeHistory()

    r.timeTravel()
    r.assertNoStateChange()
    r.assertNoCaughtUp()
    r.assertNoCurrentUnhandled()

    r.feed([One.make({ x: 1 }), One.make({ x: 4 }), Two.make({ y: 3 }), Two.make({ y: 2 })], true)
    r.assertLastStateChange(Second, ({ snapshot, unhandled }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(3)
      expect(unhandled).toEqual([One.make({ x: 4 })])
    })

    expect(r.getLastUnhandled()).toEqual([Two.make({ y: 2 })])
  })

  it('should mark itself as destroyed after "destroy" is called', () => {
    const r = new Runner(Initial, { transitioned: false })
    expect(r.machine.isDestroyed()).toBe(false)
    r.machine.destroy()
    expect(r.machine.isDestroyed()).toBe(true)
  })

  it('should cancel when empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.assertSubscribed(true)
    r.machine.destroy()
    r.assertSubscribed(false)
  })

  it('should cancel when not empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.machine.destroy()
    r.assertSubscribed(false)
  })

  it('should cancel after time travel', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.timeTravel()
    r.machine.destroy()
    r.assertSubscribed(false)
  })
})

describe('machine as async generator', () => {
  const { On, Off } = ProtocolSwitch
  const { ToggleOff, ToggleOn } = ProtocolSwitch.Events

  it('should not yield snapshot if destroyed', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1
    machine.destroy()
    const iterResult = await machine.next()
    expect(iterResult.done).toBe(true)
  })

  it('should yield initial state after first caughtUp', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1

    let resolved = false
    const promise = machine.next()
    promise.then(() => {
      resolved = true
    })

    // First caughtUp after TIMEOUT
    r1.feed([], false)
    expect(resolved).toBe(false)
    r1.feed([], true)

    // await promise here
    const iterResult = await promise
    expect(resolved).toBe(true)

    if (iterResult.done !== false) throw new Unreachable()

    const snapshot = iterResult.value
    const typeTest = snapshot.as(On)
    const typeTest2: NotAnyOrUnknown<typeof typeTest> = typeTest
    NOP(typeTest2)

    expect(snapshot).toBeTruthy()
    expect(snapshot.as(Off)).toBeFalsy()
    expect(snapshot.as(On, (state) => state.payload.toggleCount)).toBe(0)
    machine.destroy()
  })

  it('should resolve all previously unsolved yielded promises on one caughtUp event', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1

    const promise1 = machine.next()
    const promise2 = machine.next()

    r1.feed([ToggleOff.make({})], true)
    const res1 = await promise1
    const res2 = await promise2

    const val1 = (!res1.done && res1.value) || null
    const val2 = (!res2.done && res2.value) || null
    expect(val1).toBeTruthy()
    expect(val2).toBeTruthy()
    expect(val1?.as(Off)).toBeTruthy()
    expect(val2?.as(Off)).toBeTruthy()

    machine.destroy()
  })

  it('should be destroyed on breaks from for-await loop', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    r1.feed([], true)
    let i = 0
    for await (const _ of r1.machine) {
      i++
      if (i > 3) {
        break
      }
      r1.feed([], true)
    }
    expect(r1.machine.isDestroyed()).toBe(true)
  })

  it('should iterate only on state-change and caughtUp', async () => {
    const { Off, On } = ProtocolSwitch

    const r = new Runner(On, { toggleCount: 0 })
    const machine = r.machine
    r.feed([], true)

    let toggleCount = 0
    let iterationCount = 0

    for await (const state of machine) {
      iterationCount += 1
      toggleCount =
        state.as(On, (x) => x.payload.toggleCount) ||
        state.as(Off, (x) => x.payload.toggleCount) ||
        toggleCount

      const whenOn = state.as(On)
      if (whenOn) {
        console.log(state.type, state.payload)
        if (whenOn.payload.toggleCount > 0) {
          break
        }

        // spam toggle commands

        // two of these should go to "locked" case
        const promises = [
          whenOn.commands?.toggle(),
          whenOn.commands?.toggle(),
          whenOn.commands?.toggle(),
        ]
        await Promise.all(promises)

        // this one should go to the expired case
        await new Promise((res) => setTimeout(res, 5)) // should be enough so that the previous commands are received back and processed
        await whenOn.commands?.toggle()
      }

      const whenOff = state.as(Off)
      if (whenOff) {
        await whenOff.commands?.toggle()
      }
    }

    // iterationCount = toggleCount + initial iteration from r.feed([], true)
    expect(iterationCount).toBe(toggleCount + 1)
    // The circuit above should go this way: On->Off->On
    // that's 2 toggles
    expect(toggleCount).toBe(2)
  })

  describe('peek', () => {
    it('should not consume nextqueue', async () => {
      const r1 = new Runner(On, { toggleCount: 0 })
      const machine = r1.machine

      r1.feed([], true)

      const peekResult = await machine.peek()
      expect(peekResult).toBeTruthy()

      const nextResult = await machine.next()
      expect(nextResult.done).toBe(peekResult.done)
      expect(nextResult.value).toBe(peekResult.value)
    })

    it('should be resolved together with next regardless of order', async () => {
      const r1 = new Runner(On, { toggleCount: 0 })
      const machine = r1.machine

      await (async () => {
        // Peek first
        const peekPromise = machine.peek()
        const nextPromise = machine.next()

        r1.feed([], true)

        const peekResult = await peekPromise
        const nextResult = await nextPromise

        expect(nextResult.done).toBe(peekResult.done)
        expect(nextResult.value).toBe(peekResult.value)
      })()

      await (async () => {
        // Next first
        const nextPromise = machine.next()
        const peekPromise = machine.peek()

        r1.feed([], true)

        const peekResult = await peekPromise
        const nextResult = await nextPromise

        expect(nextResult.done).toBe(peekResult.done)
        expect(nextResult.value).toBe(peekResult.value)
      })()
    })
  })

  describe('non-destroying cloned async generator', () => {
    it('should generate the same snapshot as parent', async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      r.feed([{ type: ToggleOff.type }], true)

      const mres1 = await machine.next()
      const cres1 = await cloned.next()
      const mval1 = (!mres1.done && mres1.value) || null
      const cval1 = (!cres1.done && cres1.value) || null

      expect(mval1?.as(Off)).toBeTruthy()
      expect(cval1?.as(Off)).toBeTruthy()

      r.feed([{ type: ToggleOn.type }], true)

      const mres2 = await machine.next()
      const cres2 = await cloned.next()
      const mval2 = (!mres2.done && mres2.value) || null
      const cval2 = (!cres2.done && cres2.value) || null

      expect(mval2?.as(On)).toBeTruthy()
      expect(cval2?.as(On)).toBeTruthy()
    })

    it("should not affect parent's destroyed status", async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      r.feed([{ type: ToggleOff.type }], true)
      const mres1 = await machine.next()
      const cres1 = await cloned.next()
      expect(mres1.done).toBeFalsy()
      expect(cres1.done).toBeFalsy()

      r.feed([{ type: ToggleOn.type }], true)

      // attempt to kill
      cloned.return?.()
      cloned.throw?.()

      const mres2 = await machine.next()
      const cres2 = await cloned.next()

      expect(mres2.done).toBeFalsy()
      expect(cres2.done).toBeTruthy()
    })

    it('should be destroyed when parent is destroyed', async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      r.feed([{ type: ToggleOff.type }], true)

      machine.destroy()

      const mres1 = await machine.next()
      const cres1 = await cloned.next()

      expect(mres1.done).toBeTruthy()
      expect(cres1.done).toBeTruthy()
    })
  })
})

describe('StateOpaque', () => {
  const { Events, Initial, Second, XCommandParam } = ProtocolOneTwo
  const { One, Two } = Events
  describe('Commands', () => {
    it("should be undefined when StateOpaque hasn't caught up at snapshot-time", () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)
      r1.feed([], false)

      const asInitial = r1.machine.get()?.as(Initial)
      if (!asInitial) throw new Unreachable()

      expect(asInitial.commands).toBe(undefined)
    })

    it("should be undefined when StateOpaque's queue isn't zero at snapshot-time", () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)
      r1.feed([One.make({ x: 1 })], true)

      const asInitial = r1.machine.get()?.as(Initial)
      if (!asInitial) throw new Unreachable()

      expect(asInitial.commands).toBe(undefined)
    })

    it('should be ignored when expired', () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      const stateBeforeExpiry = r1.machine.get()?.as(Initial)
      if (!stateBeforeExpiry) throw new Unreachable()

      r1.assertPersistedAsMachineEvent()

      // Expire here by transforming it
      r1.feed([One.make({ x: 1 }), Two.make({ y: 1 })], true)

      expect(stateBeforeExpiry.commands).toBeTruthy()
      // Persisted should be 0
      r1.assertPersistedAsMachineEvent()

      const stateAfterExpiry = r1.machine.get()?.as(Second)
      if (!stateAfterExpiry) throw new Unreachable()

      expect(stateAfterExpiry.commands).toBeTruthy()
      const commands = stateAfterExpiry.commands
      // run command here
      if (!commands) throw new Unreachable()

      // should persist Two.make({ y: 2 })
      commands.Y()

      r1.assertPersistedAsMachineEvent(Two.make({ y: 2 }))
    })

    it('should be ignored when MachineRunner is destroyed', () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      const stateBeforeDestroy = r1.machine.get()
      const state = stateBeforeDestroy?.as(Initial)
      const commands = state?.commands

      r1.machine.destroy()

      if (!commands) throw new Unreachable()

      commands.X(...XCommandParam)

      r1.assertPersistedAsMachineEvent()
    })

    it('should be locked after a command issued', async () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      const snapshot = r1.machine.get()?.as(Initial)
      const commands = snapshot?.commands
      if (!snapshot || !commands) throw new Unreachable()

      await r1.toggleCommandDelay({ delaying: true })
      commands.X(...XCommandParam)
      r1.assertPersistedAsMachineEvent(One.make({ x: 42 }))

      // subsequent command call is not issued
      commands.X(...XCommandParam)
      r1.assertPersistedAsMachineEvent()

      await r1.toggleCommandDelay({ delaying: false })

      // subsequent command call is not issued
      commands.X(...XCommandParam)
      r1.assertPersistedAsMachineEvent()
    })

    it('should be unlocked after previous command is rejected', async () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      const snapshot = r1.machine.get()?.as(Initial)
      const commands = snapshot?.commands
      if (!snapshot || !commands) throw new Unreachable()

      await r1.toggleCommandDelay({ delaying: true })

      let rejectionSwitch1 = false
      commands.X(...XCommandParam).catch(() => (rejectionSwitch1 = true))
      r1.assertPersistedAsMachineEvent(One.make({ x: 42 }))

      // subsequent command call is not issued
      let rejectionSwitch2 = false
      commands.X(...XCommandParam).catch(() => (rejectionSwitch2 = true))
      r1.assertPersistedAsMachineEvent()

      await r1.toggleCommandDelay({ delaying: false, reject: true })

      expect(rejectionSwitch1).toBe(true)
      expect(rejectionSwitch2).toBe(false) // second commmand should not be issued

      // subsequent command after previous rejection is issued
      commands.X(...XCommandParam)
      r1.assertPersistedAsMachineEvent(One.make({ x: 42 }))
    })

    it('should be unlocked after state-change', async () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      await r1.toggleCommandDelay({ delaying: true })
      ;(() => {
        const snapshot = r1.machine.get()?.as(Initial)
        const commands = snapshot?.commands
        if (!snapshot || !commands) throw new Unreachable()

        commands.X(...XCommandParam)
        r1.assertPersistedAsMachineEvent(One.make({ x: 42 }))

        // subsequent command call is not issued
        commands.X(...XCommandParam)
        r1.assertPersistedAsMachineEvent()
      })()

      // disable delay here, let all promise runs
      await r1.toggleCommandDelay({ delaying: false })
      // feed Two to transform r1
      r1.feed([Two.make({ y: 2 })], true)
      ;(() => {
        const snapshot = r1.machine.get()?.as(Second)
        if (!snapshot) throw new Unreachable()
        // subsequent command call is not issued
        snapshot.commands?.Y()
        r1.assertPersistedAsMachineEvent(Two.make({ y: 2 }))
      })()
    })

    describe('additional tags', () => {
      const ToggleOn = MachineEvent.design('ToggleOn').withoutPayload()
      const ToggleOff = MachineEvent.design('ToggleOff').withoutPayload()

      const protocol = SwarmProtocol.make('switch', [ToggleOn, ToggleOff])

      const machine = protocol.makeMachine('switch')

      type StatePayload = { toggleCount: number }
      const On = machine
        .designState('On')
        .withPayload<StatePayload>()
        .command('off', [ToggleOff], ({ withTags }) => [
          withTags(['extra-tag-off'], ToggleOff.make({})),
        ])
        .finish()
      const Off = machine
        .designState('Off')
        .withPayload<StatePayload>()
        .command('on', [ToggleOn], () => [ToggleOn.make({})])
        .finish()

      On.react([ToggleOff], Off, (context) => ({ toggleCount: context.self.toggleCount + 1 }))
      Off.react([ToggleOn], On, (context) => ({ toggleCount: context.self.toggleCount + 1 }))

      it('should support additional tags via command definition', () => {
        const r1 = new Runner(On, { toggleCount: 0 })
        r1.feed([], true)

        r1.machine.get()?.as(On)?.commands?.off()
        r1.assertPersistedWithFn(([ev]) => {
          expect(ev.meta.tags).toContain('extra-tag-off')
        })
      })
    })
  })

  describe('.get function', () => {
    it('should return null beforee encountering caughtUp for the first time', () => {
      const r1 = new Runner(Initial, { transitioned: false })

      expect(r1.machine.get()).toBe(null)
      r1.feed([], false)
      expect(r1.machine.get()).toBe(null)
      r1.feed([], true)
      expect(r1.machine.get()).toBeTruthy()
      r1.feed([], false)
      expect(r1.machine.get()).toBeTruthy()
    })
  })

  describe('.is function', () => {
    it('should match by factory and reduce type inside block', () => {
      const r1 = new Runner(Initial, { transitioned: false })

      r1.feed([], true)

      const s1 = r1.machine.get()

      if (!s1) throw new Unreachable()

      expect(s1.is(Initial)).toBe(true)
      expect(s1.is(Second)).toBe(false)

      if (!s1.is(Initial)) throw new Unreachable()
      expect(s1.payload.transitioned).toBe(false)

      const r2 = new Runner(Second, { x: 1, y: 2 })
      r2.feed([], true)
      const s2 = r2.machine.get()

      if (!s2) throw new Unreachable()
      expect(s2.is(Second)).toBe(true)
      expect(s2.is(Initial)).toBe(false)

      if (!s2.is(Second)) throw new Unreachable()
      expect(s2.payload.x).toBe(1)
      expect(s2.payload.y).toBe(2)
    })
  })

  describe('.cast function', () => {
    it('should produce state snapshot after is', () => {
      const r = new Runner(Initial, { transitioned: false })
      r.feed([], true)
      const s = r.machine.get()

      if (!s) throw new Unreachable()

      if (!s.is(Initial)) throw new Unreachable()
      const snapshot = s.cast()
      expect(snapshot.commands?.X).toBeTruthy()
    })
  })

  describe('.as function', () => {
    it('should produce state snapshot', () => {
      // Initial State

      ;(() => {
        const r = new Runner(Initial, { transitioned: false })
        r.feed([], true)

        const s = r.machine.get()

        r.feed([], true)
        const state = r.machine.get()

        if (!state) throw new Unreachable()

        const snapshot1Invalid = state.as(Second)
        expect(snapshot1Invalid).toBeFalsy()

        const snapshot1 = state.as(Initial)
        expect(snapshot1).toBeTruthy()

        if (!snapshot1) throw new Unreachable()

        expect(snapshot1.commands?.X).toBeTruthy()
        expect(snapshot1.payload.transitioned).toBe(false)
      })()

      // Second State
      ;(() => {
        const r = new Runner(Second, { x: 1, y: 2 })
        r.feed([], true)

        const s = r.machine.get()

        r.feed([], true)

        const state = r.machine.get()

        if (!state) throw new Unreachable()
        const snapshot2Invalid = state.as(Initial)
        expect(snapshot2Invalid).toBeFalsy()

        const stateAsSecond = state.as(Second)
        expect(stateAsSecond).toBeTruthy()

        if (stateAsSecond) {
          expect(stateAsSecond.payload.x).toBe(1)
          expect(stateAsSecond.payload.y).toBe(2)
        }
      })()
    })
  })
})

describe('reactIntoSelf', () => {
  it('should work', async () => {
    const r = new Runner(ProtocolScorecard.Initial, undefined)
    await r.feed(
      [
        ProtocolScorecard.Events.Begin.make({
          par: 3,
          playerIds: ['a', 'b', 'c'],
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'a',
          numberOfShots: 1,
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'b',
          numberOfShots: 2,
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'c',
          numberOfShots: 3,
        }),
        ProtocolScorecard.Events.End.make({}),
      ],
      true,
    )

    const scoreMap = r.machine.get()?.as(ProtocolScorecard.Result)?.payload.scoreMap
    if (!scoreMap) throw new Unreachable()

    const scoreMapAsArray = Array.from(scoreMap.entries())
    expect(scoreMapAsArray).toContainEqual(['a', 1])
    expect(scoreMapAsArray).toContainEqual(['b', 2])
    expect(scoreMapAsArray).toContainEqual(['c', 3])
  })
})

describe('deepCopy', () => {
  it('should copy the basics', () => {
    expect(deepCopy(null)).toBe(null)
    expect(deepCopy(false)).toBe(false)
    expect(deepCopy(42)).toBe(42)
    expect(deepCopy('hello')).toBe('hello')
    expect(deepCopy([null, true, 5, 'world'])).toEqual([null, true, 5, 'world'])
    expect({ a: '5' }).not.toEqual({ a: 5 }) // just double-checking jest here
    expect(deepCopy({ 0: true, a: '5' })).toEqual({ '0': true, a: '5' }) // JS only has string keys
  })

  it('should copy functions', () => {
    let v = 42
    const f = () => v
    const c = deepCopy(f)
    expect(c()).toBe(42)
    v = 5
    expect(c()).toBe(5)
    const x = deepCopy({ f })
    expect(x.f()).toBe(5)
    v = 6
    expect(x.f()).toBe(6)
  })
})

describe('MachineAnalysisResource.syntheticEventName', () => {
  const { Events, Initial, Second, XCommandParam } = ProtocolOneTwo
  const { One, Two } = Events
  it('should be as formatted in the test', () => {
    expect(MachineAnalysisResource.syntheticEventName(Initial, [One, Two])).toBe('§Initial§One§Two')
    expect(MachineAnalysisResource.syntheticEventName(Second, [One])).toBe('§Second§One')
  })
})

const nameOf = (m: StateMechanism.Any | StateFactory.Any | string): string =>
  typeof m === 'string' ? m : ('mechanism' in m ? m.mechanism : m).name

const expectExecute = (
  analysisData: MachineAnalysisResource,
  factory: StateMechanism.Any | StateFactory.Any,
  commandName: string,
  logType: { type: string }[],
) => {
  const transitionFound = analysisData.transitions.find(
    (t) =>
      t.source === nameOf(factory) &&
      t.target === nameOf(factory) &&
      t.label.tag === 'Execute' &&
      t.label.cmd === commandName,
  )
  expect(transitionFound).toBeTruthy()
  expect(transitionFound?.label.tag === 'Execute' && transitionFound.label.logType).toEqual(
    logType.map((item) => item.type),
  )
}

const extractInput = (
  analysisData: MachineAnalysisResource,
  source: string | StateMechanism.Any | StateFactory.Any,
  eventType: { type: string },
  target: string | StateMechanism.Any | StateFactory.Any,
) =>
  analysisData.transitions.find(
    (t) =>
      t.source === nameOf(source) &&
      t.target === nameOf(target) &&
      t.label.tag === 'Input' &&
      t.label.eventType === eventType.type,
  )

describe('protocol.createJSONForAnalysis', () => {
  const E1 = MachineEvent.design('E1').withoutPayload()
  const E2 = MachineEvent.design('E2').withoutPayload()
  const protocol = SwarmProtocol.make('example', [E1, E2])
  const machine = protocol.makeMachine('example')
  const S1 = machine
    .designEmpty('S1')
    .command('a', [E1], () => [E1.make({})])
    .finish()
  const S2 = machine
    .designEmpty('S2')
    .command('b', [E2], () => [E2.make({})])
    .finish()
  S1.react([E1, E2], S1, () => S1.make())
  S1.react([E2], S2, () => S2.make())
  S2.react([E2, E1], S2, () => S2.make())
  S2.react([E1], S1, () => S1.make())

  it('should have all required data', () => {
    const analysisData = machine.createJSONForAnalysis(S1)

    expect(analysisData.initial).toBe(S1.mechanism.name)
    // 2 commands
    expect(analysisData.transitions.filter((t) => t.label.tag === 'Execute')).toHaveLength(2)
    // 6 reactions
    expect(analysisData.transitions.filter((t) => t.label.tag === 'Input')).toHaveLength(6)

    // expect each command
    expectExecute(analysisData, S1, 'a', [E1])
    expectExecute(analysisData, S2, 'b', [E2])

    const synthetic = MachineAnalysisResource.syntheticEventName

    // expect each reaction
    // S1.react([E1, E2], S1, () => S1.make())
    expect(extractInput(analysisData, S1, E1, synthetic(S1, [E1]))).toBeTruthy()
    expect(extractInput(analysisData, synthetic(S1, [E1]), E2, S1)).toBeTruthy()
    // S1.react([E2], S2, () => S2.make())
    expect(extractInput(analysisData, S1, E2, S2)).toBeTruthy()
    // S2.react([E2, E1], S2, () => S2.make())
    expect(extractInput(analysisData, S2, E2, synthetic(S2, [E2]))).toBeTruthy()
    expect(extractInput(analysisData, synthetic(S2, [E2]), E1, S2)).toBeTruthy()
    // S2.react([E1], S1, () => S1.make())
    expect(extractInput(analysisData, S2, E1, S1)).toBeTruthy()
  })
})

/**
 * In this particular test group, bad-good assertions are not required.
 * This blocks only tests types by making type assignments.
 * Bad type definitions are expected to fail the compilation
 */
describe('typings', () => {
  const { Initial, Second } = ProtocolOneTwo

  const E1 = MachineEvent.design('E1').withoutPayload()
  const E2 = MachineEvent.design('E2').withoutPayload()
  const E3 = MachineEvent.design('E3').withPayload<{ property: string }>()

  const protocol = SwarmProtocol.make('example', [E1, E2])

  it('event type transformation should be working well', () => {
    true as Expect<Equal<MachineEvent.Of<typeof E1>, { type: 'E1' } & Record<never, never>>>
    true as Expect<Equal<MachineEvent.Of<typeof E3>, { type: 'E3' } & { property: string }>>
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToActyxEvent<readonly [typeof E1, typeof E2, typeof E3]>,
        [
          ActyxEvent<MachineEvent.Of<typeof E1>>,
          ActyxEvent<MachineEvent.Of<typeof E2>>,
          ActyxEvent<MachineEvent.Of<typeof E3>>,
        ]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToMachineEvent<readonly [typeof E1, typeof E2, typeof E3]>,
        [MachineEvent.Of<typeof E1>, MachineEvent.Of<typeof E2>, MachineEvent.Of<typeof E3>]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToPayload<readonly [typeof E1, typeof E2, typeof E3]>,
        [
          MachineEvent.Payload.Of<typeof E1>,
          MachineEvent.Payload.Of<typeof E2>,
          MachineEvent.Payload.Of<typeof E3>,
        ]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.Reduce<readonly [typeof E1, typeof E2, typeof E3]>,
        typeof E1 | typeof E2 | typeof E3
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Of<MachineEvent.Factory.Reduce<readonly [typeof E1, typeof E2, typeof E3]>>,
        MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2> | MachineEvent.Of<typeof E3>
      >
    >
  })

  it("tags parameter from protocol should match createMachineRunner's", () => {
    // Accepted parameter type
    type TagsParamType = Parameters<
      typeof createMachineRunner<any, any, typeof E1 | typeof E2, any>
    >[1]

    // Argument type
    type TagsArgType = ReturnType<typeof protocol['tagWithEntityId']>

    type ExpectedTagsType = Tags<MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2>>

    NOP<[TagsParamType]>(undefined as any as TagsArgType)
    NOP<[NotAnyOrUnknown<TagsParamType>]>(undefined as any)
    NOP<[NotAnyOrUnknown<TagsArgType>]>(undefined as any)
    true as Expect<Equal<ExpectedTagsType, TagsParamType>>
  })

  it("state.as should not return 'any'", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    if (!snapshot) return

    const state = snapshot.as(Initial)
    if (!state) return

    const commands = state.commands
    if (!commands) return
    // This will fail to compile if `as` function returns nothing other than
    // "Initial", including if it returns any
    const supposedStateName: NotAnyOrUnknown<State.NameOf<typeof state>> = 'Initial'
    NOP(supposedStateName)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xTypeTest: NotAnyOrUnknown<typeof commands.X> = undefined as any
    const paramsOfXTypeTest: NotAnyOrUnknown<Parameters<typeof commands.X>> = [
      true,
      1,
      '',
      { specificField: 'literal-a' },
      Symbol(),
    ]
    NOP(xTypeTest, paramsOfXTypeTest)

    const transformedTypeTest = snapshot.as(Initial, (initial) => initial.payload.transitioned)
    const supposedBooleanOrUndefined: NotAnyOrUnknown<typeof transformedTypeTest> = true as
      | true
      | false
      | undefined

    NOP(transformedTypeTest, supposedBooleanOrUndefined)
    r.machine.destroy()
  })

  it("state.is should not return 'any' and should narrow cast", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    const snapshotTypeTest: NotAnyOrUnknown<typeof snapshot> = snapshot
    NOP(snapshotTypeTest)

    if (!snapshot) return

    if (snapshot.is(Initial)) {
      const state = snapshot.cast()
      const typetest: NotAnyOrUnknown<typeof state> = state
      const commands = state.commands
      if (commands) {
        const typetestCommands: NotAnyOrUnknown<typeof commands.X> = () =>
          Promise.resolve() as Promise<void>
        NOP(typetest, typetestCommands)
      }
    }

    snapshot.as(Initial)
    snapshot.as(Second)

    r.machine.destroy()
  })

  it("machine.refineStateType refines the type of the StateOpaque's payload", () => {
    const r = new Runner(ProtocolScorecard.Initial, undefined)
    const machine = r.machine
    const refinedMachine = machine.refineStateType(ProtocolScorecard.AllStates)

    // Partial param should throw
    expect(() => machine.refineStateType([ProtocolScorecard.Initial])).toThrow()

    const stateOpaque = machine.get()
    if (!stateOpaque) return

    const refinedStateOpaque = refinedMachine.get()
    if (!refinedStateOpaque) return

    true as Expect<Equal<typeof stateOpaque['payload'], unknown>>
    true as Expect<
      Equal<
        typeof refinedStateOpaque['payload'],
        | StateFactory.PayloadOf<typeof ProtocolScorecard.Initial>
        | StateFactory.PayloadOf<typeof ProtocolScorecard.Result>
        | StateFactory.PayloadOf<typeof ProtocolScorecard.ScoreKeeping>
      >
    >
  })

  describe('different-machines', () => {
    const E1 = MachineEvent.design('E1').withoutPayload()
    const E2 = MachineEvent.design('E2').withoutPayload()
    const protocol = SwarmProtocol.make('swarm', [E1, E2])

    const M1 = protocol.makeMachine('machine1')
    const M2 = protocol.makeMachine('machine2')

    const M1S = M1.designEmpty('m1s').finish()
    const M2S = M2.designEmpty('m2s').finish()

    it("should err when the wrong StateFactory is passed on react's NextFactory parameter", () => {
      type ExpectedFactory = Parameters<typeof M1S.react>[1]
      type IncorrectFactory = typeof M2S
      true as Expect<Equal<ExpectedFactory['mechanism']['protocol']['name'], 'machine1'>>
      true as Expect<Equal<ExpectedFactory['mechanism']['protocol']['swarmName'], 'swarm'>>
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })

    it('should err when the wrong parameter is passed on `is`', () => {
      const runner = new Runner(M1S, undefined)
      const state = runner.machine.get()
      if (!state) return
      type ExpectedFactory = Parameters<typeof state.is>[0]
      type IncorrectFactory = typeof M2S
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })

    it('should err when the wrong parameter is passed on `as`', () => {
      const runner = new Runner(M1S, undefined)
      const state = runner.machine.get()
      if (!state) return
      type ExpectedFactory = Parameters<typeof state.as>[0]
      type IncorrectFactory = typeof M2S
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })
  })

  describe('serializable-object', () => {
    it('should work correctly', () => {
      const s = (_s: SerializableValue) => {
        // empty
      }
      // @ts-expect-error undefined
      s(undefined)
      s(null)
      s(true)
      s(42)
      s('hello')
      // @ts-expect-error undefined
      s([undefined])
      s([null])
      s([true])
      s([42])
      s(['hello'])
      // @ts-expect-error undefined
      s({ c: undefined })
      s({ c: null })
      s({ c: true })
      s({ c: 42 })
      s({ c: 'hello' })

      // @ts-expect-error undefined
      s({} as { [_: string]: undefined })
      s({} as { [_: string]: null })
      s({} as { [_: string]: boolean })
      s({} as { [_: string]: number })
      s({} as { [_: string]: string })
      // @ts-expect-error function
      s({} as { [_: string]: () => void })
      s({} as Record<string, string>)

      const o = <T extends SerializableObject>() => {
        // empty
      }
      const somesymbol: unique symbol = Symbol()
      type somesymbol = typeof somesymbol

      o<{
        a: boolean
        b: null
        c: true
        d: 42
        e: 'hello'
        f: string
        g: {
          a: boolean
          b: null
          c: true
          d: 42
          e: 'hello'
          f: string
        }
      }>()
      o<{ a: Record<string, string>; b: Record<string, string>[] }>()
      o<{ a: { b: Record<string, { c: number }[]> } }>()
      o<{ a: { b: Record<string, { c: number }[]>[] }[] }>()
      // @ts-expect-error Date as property value
      o<{ a: Date; b: { c: Date } }>()
      // @ts-expect-error function as property value
      o<{ a: () => unknown; b: { c: () => unknown } }>()
      // @ts-expect-error bigint as property value
      o<{ a: bigint; b: { c: bigint } }>()
      // @ts-expect-error symbol as property value
      o<{ a: symbol; b: { c: symbol } }>()
      // @ts-expect-error symbol as property key
      o<{ [somesymbol]: boolean }>()
    })
  })
})
