import { EventsOrTimetravel, Metadata, MsgType, OnCompleteOrErr } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import { createMachineRunnerInternal, State, StateOpaque, SubscribeFn } from './runner/runner.js'
import { MachineEvent } from './design/event.js'
import { Machine } from './index.js'
import { StateFactory, StateMechanism } from './design/state.js'
import { deepCopy } from './utils/object-utils.js'
import { NOP } from './utils/index.js'
import { NotAnyOrUnknown } from './utils/type-utils.js'
import { MachineAnalysisResource, SwarmProtocol } from './design/protocol.js'

class Unreachable extends Error {
  constructor() {
    super('should be unreachable')
  }
}

// Event definitions

const One = MachineEvent.design('One').withPayload<{ x: number }>()
const Two = MachineEvent.design('Two').withPayload<{ y: number }>()

// Machine and States

const protocol = SwarmProtocol.make('TestSwarm', ['testMachine'], [One, Two])

const machine = protocol.makeMachine('TestMachine')

const XCommandParam = [true, 1, '', { specificField: 'literal-a' }, Symbol()] as const
const Initial = machine
  .designState('Initial')
  .withPayload<{ transitioned: boolean }>()
  .command(
    'X',
    [One],
    // Types below are used for type tests
    (
      context,
      _supposedBoolean: boolean,
      _supposedNumber: number,
      _supposedString: string,
      _supposedObject: { specificField: 'literal-a' },
      _supposedSymbol: symbol,
    ) => [One.make({ x: 42 })],
  )
  .finish()

const Second = machine
  .designState('Second')
  .withPayload<{ x: number; y: number }>()
  .command('Y', [Two], () => [Two.make({ y: 2 })])
  .finish()

// Reactions

Initial.react([One, Two], Second, (c, one, two) => {
  c.self.transitioned = true
  return Second.make({
    x: one.payload.x,
    y: two.payload.y,
  })
})

// Mock Runner

type CommandPromisePair = [Promise<Metadata[]>, { resolve: () => void; reject: () => void }]

class Runner<
  RegisteredEventsFactoriesTuple extends MachineEvent.Factory.NonZeroTuple,
  Payload,
  E extends MachineEvent.Factory.ReduceToEvent<RegisteredEventsFactoriesTuple>,
> {
  private cb: null | ((data: EventsOrTimetravel<E>) => Promise<void>) = null
  private err: null | OnCompleteOrErr = null
  private persisted: E[] = []
  private cancelCB
  private unhandled: MachineEvent.Any[] = []
  private caughtUpHistory: StateOpaque[] = []
  private stateChangeHistory: { state: StateOpaque; unhandled: MachineEvent.Any[] }[] = []
  private commandsDelay: {
    isDelaying: boolean
    delayedCommands: CommandPromisePair[]
  } = {
    isDelaying: false,
    delayedCommands: [],
  }
  public machine

  constructor(
    factory: StateFactory<any, RegisteredEventsFactoriesTuple, any, Payload, any>,
    payload: Payload,
  ) {
    this.cancelCB = () => {
      if (this.cb === null) throw new Error('not subscribed')
      this.cb = null
      this.err = null
    }

    const subscribe: SubscribeFn<RegisteredEventsFactoriesTuple> = (cb0, err0) => {
      if (this.cb !== null) throw new Error('already subscribed')
      this.cb = cb0
      this.err = err0 || null
      return this.cancelCB
    }

    const machine = createMachineRunnerInternal(
      subscribe,
      async (events) => {
        this.persisted.push(...events)
        const commandPromisePair = this.createDelayedCommandPair(events)
        if (this.commandsDelay.isDelaying) {
          this.commandsDelay.delayedCommands.push(commandPromisePair)
        } else {
          commandPromisePair[1].resolve()
        }
        return commandPromisePair[0]
      },
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

  private mockMeta() {
    return {
      isLocalEvent: true,
      tags: [],
      timestampMicros: 0,
      timestampAsDate: () => new Date(),
      lamport: 1,
      eventId: 'id1',
      appId: 'test',
      stream: 'stream1',
      offset: 3,
    }
  }

  private createDelayedCommandPair(events: E[]): CommandPromisePair {
    const pair: CommandPromisePair = [undefined as any, undefined as any]
    pair[0] = new Promise<void>((resolve, reject) => {
      pair[1] = {
        resolve,
        reject,
      }
    }).then(() => {
      this.feed(events, true)
      return events.map((_) => this.mockMeta())
    })

    return pair
  }

  async toggleCommandDelay(
    delayControl: { delaying: true } | { delaying: false; rejectAll?: boolean },
  ): Promise<void> {
    this.commandsDelay.isDelaying = delayControl.delaying

    if (delayControl.delaying) return

    await Promise.all(
      this.commandsDelay.delayedCommands.map(([promise, control]) => {
        if (delayControl.rejectAll) {
          control.reject()
        } else {
          control.resolve()
        }
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        return promise.catch(() => {})
      }),
    )

    this.commandsDelay.delayedCommands = []
  }

  feed(ev: E[], caughtUp: boolean) {
    if (this.cb === null) throw new Error('not subscribed')
    return this.cb({
      type: MsgType.events,
      caughtUp,
      events: ev.map((payload) => ({
        meta: this.mockMeta(),
        payload,
      })),
    })
  }

  timeTravel() {
    if (this.cb === null) throw new Error('not subscribed')
    const cb = this.cb
    cb({ type: MsgType.timetravel, trigger: { lamport: 0, offset: 0, stream: 'stream' } })
    if (this.cb === null) throw new Error('did not resubscribe')
  }

  error() {
    if (this.err === null) throw new Error('not subscribed')
    this.err(new Error('boo!'))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertLastStateChange<Factory extends StateFactory<any, any, any, any, any>>(
    factory: Factory,
    assertStateFurther?: (params: {
      snapshot: State.Of<Factory>
      unhandled: MachineEvent.Any[]
    }) => void,
  ) {
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

  assertLastCaughtUp<Factory extends StateFactory<any, any, any, any, any>>(
    factory: Factory,
    assertStateFurther?: (params: { snapshot: State.Of<Factory> }) => void,
  ) {
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
      expect(this.cb).not.toBeNull()
      expect(this.err).not.toBeNull()
    } else {
      expect(this.cb).toBeNull()
      expect(this.err).toBeNull()
    }
  }

  assertPersisted(...e: E[]) {
    expect(this.persisted).toEqual(e)
    this.persisted.length = 0
  }
}

describe('machine runner', () => {
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
  const Toggle = MachineEvent.design('Toggle').withoutPayload()

  const protocol = SwarmProtocol.make('switch', ['switch'], [Toggle])

  const machine = protocol.makeMachine('switch')

  type StatePayload = { toggleCount: number }
  const On = machine.designState('On').withPayload<StatePayload>().finish()
  const Off = machine.designState('Off').withPayload<StatePayload>().finish()

  On.react([Toggle], Off, ({ self }) => ({ toggleCount: self.toggleCount + 1 }))
  Off.react([Toggle], On, ({ self }) => ({ toggleCount: self.toggleCount + 1 }))

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

    const before = new Date()
    const promise = machine.next()

    // First caughtUp after TIMEOUT
    const TIMEOUT = 50 // milliseconds
    setTimeout(() => r1.feed([], true), TIMEOUT)

    // await promise here
    const iterResult = await promise
    const after = new Date()

    expect(after.getTime() - before.getTime()).toBeGreaterThanOrEqual(TIMEOUT)

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

    r1.feed([Toggle.make({})], true)
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

      r.feed([{ type: 'Toggle' }], true)

      const mres1 = await machine.next()
      const cres1 = await cloned.next()
      const mval1 = (!mres1.done && mres1.value) || null
      const cval1 = (!cres1.done && cres1.value) || null

      expect(mval1?.as(Off)).toBeTruthy()
      expect(cval1?.as(Off)).toBeTruthy()

      r.feed([{ type: 'Toggle' }], true)

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

      r.feed([{ type: 'Toggle' }], true)
      const mres1 = await machine.next()
      const cres1 = await cloned.next()
      expect(mres1.done).toBeFalsy()
      expect(cres1.done).toBeFalsy()

      r.feed([{ type: 'Toggle' }], true)

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

      r.feed([{ type: 'Toggle' }], true)

      machine.destroy()

      const mres1 = await machine.next()
      const cres1 = await cloned.next()

      expect(mres1.done).toBeTruthy()
      expect(cres1.done).toBeTruthy()
    })
  })
})

describe('StateOpaque', () => {
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

      r1.assertPersisted()

      // Expire here by transforming it
      r1.feed([One.make({ x: 1 }), Two.make({ y: 1 })], true)

      expect(stateBeforeExpiry.commands).toBeTruthy()
      // Persisted should be 0
      r1.assertPersisted()

      const stateAfterExpiry = r1.machine.get()?.as(Second)
      if (!stateAfterExpiry) throw new Unreachable()

      expect(stateAfterExpiry.commands).toBeTruthy()
      const commands = stateAfterExpiry.commands
      // run command here
      if (!commands) throw new Unreachable()

      // should persist Two.make({ y: 2 })
      commands.Y()

      r1.assertPersisted(Two.make({ y: 2 }))
    })

    it('should be locked after a command issued', async () => {
      const r1 = new Runner(Initial, { transitioned: false })
      r1.feed([], true)

      const snapshot = r1.machine.get()?.as(Initial)
      const commands = snapshot?.commands
      if (!snapshot || !commands) throw new Unreachable()

      await r1.toggleCommandDelay({ delaying: true })
      commands.X(...XCommandParam)
      r1.assertPersisted(One.make({ x: 42 }))

      // subsequent command call is not issued
      commands.X(...XCommandParam)
      r1.assertPersisted()

      await r1.toggleCommandDelay({ delaying: false })

      // subsequent command call is not issued
      commands.X(...XCommandParam)
      r1.assertPersisted()
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
      r1.assertPersisted(One.make({ x: 42 }))

      // subsequent command call is not issued
      let rejectionSwitch2 = false
      commands.X(...XCommandParam).catch(() => (rejectionSwitch2 = true))
      r1.assertPersisted()

      await r1.toggleCommandDelay({ delaying: false, rejectAll: true })

      expect(rejectionSwitch1).toBe(true)
      expect(rejectionSwitch2).toBe(false) // second commmand should not be issued

      // subsequent command after previous rejection is issued
      commands.X(...XCommandParam)
      r1.assertPersisted(One.make({ x: 42 }))
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
        r1.assertPersisted(One.make({ x: 42 }))

        // subsequent command call is not issued
        commands.X(...XCommandParam)
        r1.assertPersisted()
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
        r1.assertPersisted(Two.make({ y: 2 }))
      })()
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

// describe('exec wrapper', () => {
//   it('should persist', () => {
//     const r = new Runner(new Initial())
//     r.feed([], true)
//     const s = r.getState()
//     if (!(s instanceof Initial)) throw new Error('not Initial')
//     expect(s.execX().events).toEqual([{ type: 'One', x: 42 }])
//     r.assertPersisted({ type: 'One', x: 42 })
//   })
//   it('should panic', () => {
//     const r = new Runner(new Initial())
//     r.feed([], true)
//     const s = r.getState()
//     if (!(s instanceof Initial)) throw new Error('not Initial')
//     s.execX()
//     expect(() => s.execX()).toThrow()
//   })
// })

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

  // it('should copy prototypes', () => {
  //   const i = new Initial()
  //   const c = deepCopy(i)
  //   expect(i).toEqual(c)
  //   expect(i.constructor).toBe(c.constructor)
  //   expect(Object.getPrototypeOf(i)).toBe(Object.getPrototypeOf(c))
  // })

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
  it('should be as formatted in the test', () => {
    expect(MachineAnalysisResource.syntheticEventName(Initial, [One, Two])).toBe(
      '§TestSwarm.TestMachine.Initial§One§Two',
    )
    expect(MachineAnalysisResource.syntheticEventName(Second, [One])).toBe(
      '§TestSwarm.TestMachine.Second§One',
    )
  })
})

const nameOf = (m: StateMechanism.Any | StateFactory.Any | string): string =>
  typeof m === 'string' ? m : ('mechanism' in m ? m.mechanism : m).name

const expectExecute = (
  analysisData: ReturnType<typeof machine['createJSONForAnalysis']>,
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
  analysisData: ReturnType<typeof machine['createJSONForAnalysis']>,
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
  const protocol = SwarmProtocol.make('example', ['example'], [E1, E2])
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
    const supposedStateName: NotAnyOrUnknown<State.NameOf<typeof state>> =
      'TestSwarm.TestMachine.Initial'
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
})
