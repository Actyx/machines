import { EventsOrTimetravel, MsgType, OnCompleteOrErr } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import { internalStartRunner } from './runner.js'
import { Reactions, State } from './types.js'

type One = { type: 'One'; x: number }
type Two = { type: 'Two'; y: number }
type Events = One | Two

class Initial extends State<Events> {
  public transitioned = false
  public unhandled: Events[] = []
  onOne(one: One, two: Two) {
    this.transitioned = true
    return new Second(one.x, two.y)
  }
  handleOrphan(event: Events): void {
    this.unhandled.push(event)
  }
  reactions(): Reactions {
    return { One: { moreEvents: ['Two'], target: 'Second' } }
  }
}

class Second extends State<Events> {
  public unhandled: Events[] = []
  constructor(public x: number, public y: number) {
    super()
  }
  handleOrphan(event: Events): void {
    this.unhandled.push(event)
  }
}

type StateUtil<E> = {
  transitioned: boolean
  unhandled: E[]
}

class Runner<E extends { type: string }> {
  private cb: null | ((i: EventsOrTimetravel<E>) => void) = null
  private err: null | OnCompleteOrErr = null
  private states: [State<E>, boolean][] = []
  private subCancel
  private cancelCB

  constructor(private initial: State<E> & StateUtil<E>) {
    this.cancelCB = () => {
      if (this.cb === null) throw new Error('not subscribed')
      this.cb = null
      this.err = null
    }

    const subscribe = (cb0: (i: EventsOrTimetravel<E>) => void, err0: OnCompleteOrErr) => {
      if (this.cb !== null) throw new Error('already subscribed')
      this.cb = cb0
      this.err = err0
      return this.cancelCB
    }

    const stateCB = (state: State<E>, commands: boolean) => {
      this.states.push([state, commands])
    }

    this.subCancel = internalStartRunner(subscribe, initial, stateCB)
  }

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
  assertState<U extends State<Events>, T extends new (...args: any[]) => U>(
    t: T,
    cmd: boolean,
    f: (t: U) => void,
  ) {
    expect(this.initial.transitioned).toBeFalsy()
    expect(this.initial.unhandled).toHaveLength(0)
    const [[s0, cmd0], ...s0rest] = this.states.splice(0)
    expect(s0rest).toHaveLength(0)
    if (s0 instanceof t) {
      f(s0)
    }
    expect(cmd0).toBe(cmd)
  }

  assertNoState() {
    expect(this.states).toHaveLength(0)
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
}

describe('machine runner', () => {
  it('should run', () => {
    const r = new Runner(new Initial())
    r.feed([{ type: 'One', x: 1 }], true)
    r.assertState(Initial, false, (s: Initial) => {
      expect(s.transitioned).toBeFalsy()
    })
    r.feed([{ type: 'Two', y: 2 }], true)
    r.assertState(Second, true, (s: Second) => {
      expect(s.x).toBe(1)
      expect(s.y).toBe(2)
    })
    r.timeTravel()
    r.assertNoState()
    r.feed(
      [
        { type: 'One', x: 1 },
        { type: 'One', x: 4 },
        { type: 'Two', y: 3 },
        { type: 'Two', y: 2 },
      ],
      true,
    )
    r.assertState(Second, true, (s: Second) => {
      expect(s.x).toBe(1)
      expect(s.y).toBe(3)
      expect(s.unhandled).toEqual([{ type: 'Two', y: 2 }])
    })
  })
  it('should emit initial state', () => {
    const r = new Runner(new Initial())
    r.feed([], false)
    r.assertNoState()
    r.feed([], true)
    r.assertState(Initial, true, (s: Initial) => {
      expect(s.transitioned).toBeFalsy()
    })
  })
  it('should cancel when empty', () => {
    const r = new Runner(new Initial())
    r.assertSubscribed(true)
    r.cancel()
    r.assertSubscribed(false)
  })
  it('should cancel when not empty', () => {
    const r = new Runner(new Initial())
    r.feed([{ type: 'One', x: 1 }], true)
    r.cancel()
    r.assertSubscribed(false)
  })
  it('should cancel after time travel', () => {
    const r = new Runner(new Initial())
    r.feed([{ type: 'One', x: 1 }], true)
    r.timeTravel()
    r.cancel()
    r.assertSubscribed(false)
  })
})
