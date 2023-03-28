import { EventsOrTimetravel, MsgType, OnCompleteOrErr, SnapshotStore } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import { createMachineRunnerInternal, State, StateOpaque, SubscribeFn } from './runner/runner.js'
import { MachineEvent } from './design/event.js'
import { Protocol } from './index.js'
import { StateFactory, StateRaw } from './design/state.js'
import { deepCopy } from './utils/object-utils.js'
import { NOP } from './utils/index.js'
import { NotAnyOrUnknown } from './utils/type-utils.js'

class Unreachable extends Error {
  constructor() {
    super('should be unreachable')
  }
}

// Event definitions

const One = MachineEvent.design('One').withPayload<{ x: number }>()
const Two = MachineEvent.design('Two').withPayload<{ y: number }>()

// Protocol and States

const protocol = Protocol.make('testProtocol', [One, Two])

const Initial = protocol
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

const Second = protocol
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
        return events.map((_) => ({
          isLocalEvent: true,
          tags: [],
          timestampMicros: 0,
          timestampAsDate: () => new Date(),
          lamport: 1,
          eventId: 'id1',
          appId: 'test',
          stream: 'stream1',
          offset: 3,
        }))
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

  feed(ev: E[], caughtUp: boolean) {
    if (this.cb === null) throw new Error('not subscribed')
    return this.cb({
      type: MsgType.events,
      caughtUp,
      events: ev.map((payload) => ({
        meta: {
          isLocalEvent: true,
          tags: [],
          timestampMicros: 0,
          timestampAsDate: () => new Date(),
          lamport: 1,
          eventId: 'id1',
          appId: 'test',
          stream: 'stream1',
          offset: 3,
        },
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

  const protocol = Protocol.make('switch', [Toggle])

  type StatePayload = { toggleCount: number }
  const On = protocol.designState('On').withPayload<StatePayload>().finish()
  const Off = protocol.designState('Off').withPayload<StatePayload>().finish()

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
  it("should not have command when it hasn't caught up at snapshot-time", () => {
    const r1 = new Runner(Initial, { transitioned: false })
    r1.feed([], true)
    r1.feed([], false)

    const asInitial = r1.machine.get()?.as(Initial)
    if (!asInitial) throw new Unreachable()

    expect(asInitial.commands).toBe(undefined)
  })

  it("should not have command when its queue isn't zero at snapshot-time", () => {
    const r1 = new Runner(Initial, { transitioned: false })
    r1.feed([], true)
    r1.feed([One.make({ x: 1 })], true)

    const asInitial = r1.machine.get()?.as(Initial)
    if (!asInitial) throw new Unreachable()

    expect(asInitial.commands).toBe(undefined)
  })

  it('should not ignore issued commands when expired', () => {
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
    commands?.Y()

    r1.assertPersisted(Two.make({ y: 2 }))
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
        const typetestCommands: NotAnyOrUnknown<typeof commands.X> = NOP
        NOP(typetest, typetestCommands)
      }
    }

    snapshot.as(Initial)
    snapshot.as(Second)

    r.machine.destroy()
  })
})
