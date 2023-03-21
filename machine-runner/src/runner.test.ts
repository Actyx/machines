import { EventsOrTimetravel, MsgType, OnCompleteOrErr } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import { createMachineRunnerInternal, State, StateOpaque, SubscribeFn } from './runner/runner.js'
import { MachineEvent } from './design/event.js'
import { Protocol } from './index.js'
import { StateFactory } from './design/state.js'
import { deepCopy } from './utils/object-utils.js'
import { NOP } from './utils/index.js'
import { NotAnyOrUnknown } from './utils/type-utils.js'

// Event definitions

const One = MachineEvent.design('One').withPayload<{ x: number }>()
const Two = MachineEvent.design('Two').withPayload<{ y: number }>()

// Protocol and States

const protocol = Protocol.make('testProtocol', [One, Two])

const Initial = protocol
  .designState('Initial')
  .withPayload<{ transitioned: boolean }>()
  .command('X', [One], () => [One.make({ x: 42 })])
  .finish()

const Second = protocol.designState('Second').withPayload<{ x: number; y: number }>().finish()

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
      },
      factory,
      payload,
    )

    machine.events.addListener('audit.state', () => {
      this.stateChangeHistory.unshift({
        state: machine.get(),
        unhandled: this.unhandled,
      })
      this.unhandled = []
    })

    machine.events.addListener('change', () => {
      this.caughtUpHistory.unshift(machine.get())
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
    expect(last).toBeTruthy()
    if (!last) return

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
    expect(state).toBeTruthy()
    if (!state) return

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

    expect(iterResult.done).toBe(false)
    if (iterResult.done !== false) return

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
  describe('.is function', () => {
    it('should match by factory and reduce type inside block', () => {
      const r1 = new Runner(Initial, { transitioned: false })
      const s1 = r1.machine.get()
      expect(s1.is(Initial)).toBe(true)
      expect(s1.is(Second)).toBe(false)
      if (s1.is(Initial)) {
        expect(s1.payload.transitioned).toBe(false)
      }

      const r2 = new Runner(Second, { x: 1, y: 2 })
      const s2 = r2.machine.get()
      expect(s2.is(Second)).toBe(true)
      expect(s2.is(Initial)).toBe(false)
      if (s2.is(Second)) {
        expect(s2.payload.x).toBe(1)
        expect(s2.payload.y).toBe(2)
      }
    })
  })

  describe('.as function', () => {
    it('should produce state snapshot', () => {
      // Initial State

      ;(() => {
        const r = new Runner(Initial, { transitioned: false })
        const s = r.machine.get()

        const snapshot1Invalid = s.as(Second)
        expect(snapshot1Invalid).toBeFalsy()

        const snapshot1 = s.as(Initial)
        expect(snapshot1).toBeTruthy()

        if (snapshot1) {
          expect(snapshot1.payload.transitioned).toBe(false)
        }
      })()

      // Second State
      ;(() => {
        const r = new Runner(Second, { x: 1, y: 2 })
        const s = r.machine.get()

        const snapshot2Invalid = s.as(Initial)
        expect(snapshot2Invalid).toBeFalsy()

        const snapshot2 = s.as(Second)
        expect(snapshot2).toBeTruthy()

        if (snapshot2) {
          expect(snapshot2.payload.x).toBe(1)
          expect(snapshot2.payload.y).toBe(2)
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

describe('typings', () => {
  it("state.as should not return 'any'", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    const state = snapshot.as(Initial)
    if (state) {
      // This will fail to compile if `as` function returns nothing other than
      // "Initial", including if it returns any
      const supposedStateName: NotAnyOrUnknown<State.NameOf<typeof state>> = 'Initial'
      NOP(supposedStateName)
    }

    const transformedTypeTest = snapshot.as(Initial, (initial) => initial.payload.transitioned)
    const supposedBooleanOrUndefined: NotAnyOrUnknown<typeof transformedTypeTest> = true as
      | true
      | false
      | undefined

    NOP(transformedTypeTest, supposedBooleanOrUndefined)
    expect(true).toBe(true)
    r.machine.destroy()
  })

  it("state.is should not return 'any'", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    const snapshotTypeTest: NotAnyOrUnknown<typeof snapshot> = snapshot
    NOP(snapshotTypeTest)
    if (snapshot.is(Initial)) {
      const snapshotTransparentTypeTest: NotAnyOrUnknown<typeof snapshot> = snapshot
      NOP(snapshotTransparentTypeTest)
    }
    expect(true).toBe(true)
    r.machine.destroy()
  })
})
