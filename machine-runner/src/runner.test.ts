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

describe('machine runner', () => {
  it('should run', () => {
    let cb: null | ((i: EventsOrTimetravel<Events>) => void) = null
    let err: null | OnCompleteOrErr = null
    const cancel = () => {
      if (cb === null) throw new Error('not subscribed')
      cb = null
      err = null
    }
    const subscribe = (cb0: (i: EventsOrTimetravel<Events>) => void, err0: OnCompleteOrErr) => {
      if (cb !== null) throw new Error('already subscribed')
      cb = cb0
      err = err0
      return cancel
    }
    const states: [State<Events>, boolean][] = []
    const stateCB = (state: State<Events>, commands: boolean) => {
      states.push([state, commands])
    }
    const feed = (ev: Events[], caughtUp: boolean) => {
      if (cb === null) throw new Error('not subscribed')
      cb({
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
    const timeTravel = () => {
      if (cb === null) throw new Error('not subscribed')
      const cb1 = cb
      cancel()
      cb1({ type: MsgType.timetravel, trigger: { lamport: 0, offset: 0, stream: 'stream' } })
      if (cb === null) throw new Error('did not resubscribe')
    }
    const error = () => {
      if (err === null) throw new Error('not subscribed')
      err(new Error('boo!'))
    }
    const drainStates = () => states.splice(0)
    const assertState = <U extends State<Events>, T extends new (...args: any[]) => U>(
      t: T,
      cmd: boolean,
      f: (t: U) => void,
    ) => {
      expect(initial.transitioned).toBeFalsy()
      expect(initial.unhandled).toHaveLength(0)
      const [[s0, cmd0], ...s0rest] = drainStates()
      expect(s0rest).toHaveLength(0)
      if (s0 instanceof t) {
        f(s0)
      }
      expect(cmd0).toBe(cmd)
    }

    const initial = new Initial()
    const subCancel = internalStartRunner(subscribe, initial, stateCB)
    feed([{ type: 'One', x: 1 }], true)
    assertState(Initial, false, (s: Initial) => {
      expect(s.transitioned).toBeFalsy()
    })
    feed([{ type: 'Two', y: 2 }], true)
    assertState(Second, true, (s: Second) => {
      expect(s.x).toBe(1)
      expect(s.y).toBe(2)
    })
    timeTravel()
    expect(drainStates()).toHaveLength(0)
    feed(
      [
        { type: 'One', x: 1 },
        { type: 'Two', y: 3 },
        { type: 'Two', y: 2 },
      ],
      true,
    )
    assertState(Second, true, (s: Second) => {
      expect(s.x).toBe(1)
      expect(s.y).toBe(3)
      expect(s.unhandled).toEqual([{ type: 'Two', y: 2 }])
    })
  })
  it('should emit initial state', () => {
    //
  })
})
