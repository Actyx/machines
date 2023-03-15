import { EventsOrTimetravel, MsgType, OnCompleteOrErr } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import { createMachineRunnerInternal, State, StateOpaque } from './runner/runner.js'
import { Event } from './design/event.js'
import { Protocol } from './index.js'
import { StateFactory } from './design/state.js'
import { deepCopy } from './utils/object-utils.js'

const One = Event.design('One').withPayload<{ x: number }>()
const Two = Event.design('Two').withPayload<{ y: number }>()

const protocol = Protocol.make('testProtocol', [One, Two])

// class Initial extends State<Events> {
//   public transitioned = false
//   public unhandled: Events[] = []
//   execX() {
//     return this.events({ type: 'One', x: 42 })
//   }
//   onOne(one: One, two: Two) {
//     this.transitioned = true
//     return new Second(one.x, two.y)
//   }
//   handleOrphan(event: ActyxEvent<Events>): void {
//     this.unhandled.push(event.payload)
//   }
//   reactions(): Reactions {
//     return { One: { moreEvents: ['Two'], target: 'Second' } }
//   }
// }

const Initial = protocol
  .designState('Initial')
  .withPayload<{ transitioned: boolean }>()
  .command('X', [One], () => [One.make({ x: 42 })])
  .finish()

const Second = protocol.designState('Second').withPayload<{ x: number; y: number }>().finish()

Initial.react([One, Two], Second, (c, [one, two]) => {
  c.self.transitioned = true
  return Second.make({
    x: one.x,
    y: two.y,
  })
})

// class Second extends State<Events> {
//   public unhandled: Events[] = []
//   constructor(public x: number, public y: number) {
//     super()
//   }
//   handleOrphan(event: ActyxEvent<Events>): void {
//     this.unhandled.push(event.payload)
//   }
// }

type StateUtil<E> = {
  transitioned: boolean
  unhandled: E[]
}

class Runner<E extends Event.Any, Payload> {
  private cb: null | ((i: EventsOrTimetravel<E>) => void) = null
  private err: null | OnCompleteOrErr = null
  private states: { snapshot: StateOpaque; unhandled: Event.Any[] }[] = []
  private persisted: E[] = []
  private cancelCB
  private subCancel
  private unhandled: Event.Any[] = []
  public machine

  constructor(factory: StateFactory<any, any, any, Payload, any>, payload: Payload) {
    this.cancelCB = () => {
      if (this.cb === null) throw new Error('not subscribed')
      this.cb = null
      this.err = null
    }

    const subscribe = (
      cb0: (i: EventsOrTimetravel<E>) => Promise<void>,
      err0?: OnCompleteOrErr,
    ) => {
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

    machine.channels.audit.state.sub(() => {
      this.states.push({
        snapshot: machine.get(),
        unhandled: this.unhandled,
      })
      this.unhandled = []
    })

    machine.channels.audit.dropped.sub((dropped) => {
      this.unhandled.push(...dropped.events.map((actyxEvent) => actyxEvent.payload))
    })

    this.machine = machine
    this.subCancel = () => machine.destroy()
  }

  resetStateHistory = () => (this.states = [])

  feed(ev: E[], caughtUp: boolean) {
    if (this.cb === null) throw new Error('not subscribed')
    this.cb({
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
    this.cancelCB()
    cb({ type: MsgType.timetravel, trigger: { lamport: 0, offset: 0, stream: 'stream' } })
    if (this.cb === null) throw new Error('did not resubscribe')
  }

  error() {
    if (this.err === null) throw new Error('not subscribed')
    this.err(new Error('boo!'))
  }

  cancel() {
    this.subCancel()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertState<Factory extends StateFactory<any, any, any, any, any>>(
    factory: Factory,
    assertStateFurther?: (params: { snapshot: State.Of<Factory>; unhandled: Event.Any[] }) => void,
  ) {
    expect(this.unhandled).toHaveLength(0)
    const firstStateHistory = this.states.at(0)
    expect(firstStateHistory).not.toBeFalsy()
    if (!firstStateHistory) return

    const { snapshot: s0, unhandled } = firstStateHistory

    const snapshot = s0.as(factory) as State.Of<Factory> | void
    expect(snapshot).toBeTruthy()
    if (assertStateFurther && !!snapshot) {
      assertStateFurther({ snapshot, unhandled })
    }
    // expect(cmd0).toBe(cmd)
  }

  assertNoState() {
    expect(this.states).toHaveLength(0)
  }

  getState() {
    expect(this.states).toHaveLength(1)
    return this.states[0]
  }

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
  it('should run', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.assertState(Initial, ({ snapshot, unhandled }) => {
      expect(snapshot.payload.transitioned).toBe(true)
      expect(unhandled).toHaveLength(0)
    })
    r.feed([{ type: 'Two', y: 2 }], true)
    r.assertState(Second, ({ snapshot }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(2)
    })
    r.timeTravel()
    r.assertNoState()
    r.feed([One.make({ x: 1 }), One.make({ x: 4 }), Two.make({ y: 3 }), Two.make({ y: 2 })], true)
    r.assertState(Second, ({ snapshot, unhandled }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(3)
      expect(unhandled).toEqual([Two.make({ y: 2 })])
    })
  })

  it('should emit initial state', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([], false)
    r.assertNoState()
    r.feed([], true)
    r.assertState(Initial, ({ snapshot }) => {
      expect(snapshot.payload.transitioned).toBeFalsy()
    })
  })

  it('should cancel when empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.assertSubscribed(true)
    r.cancel()
    r.assertSubscribed(false)
  })
  it('should cancel when not empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.cancel()
    r.assertSubscribed(false)
  })
  it('should cancel after time travel', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.timeTravel()
    r.cancel()
    r.assertSubscribed(false)
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
