import { auditMachine, State } from '@actyx/machine-runner'
import { Actyx, ActyxEvent, Where } from '@actyx/sdk'
import { useEffect, useState } from 'react'
import { Stage, Layer, Circle, Line, Label, Tag, Text, Rect } from 'react-konva'
import Konva from 'konva'

type Ev = { type: string }
type Machine = { name: string; where: Where<Ev>; initial: State<Ev> }
type Props = {
  actyx: Actyx
  machines: Machine[]
  className?: string
}

type MachineState =
  | { idx: number; type: 'state'; state: State<Ev> }
  | { idx: number; type: 'unhandled' }
  | { idx: number; type: 'queued' }
  | { idx: number; type: 'error'; error: unknown }

type TimePoint = {
  eventId: string
  event: ActyxEvent<Ev>
  machines: MachineState[]
}

type MachinePoint =
  | { type: 'state'; state: State<Ev>; events: ActyxEvent<Ev>[] }
  | { type: 'unhandled'; event: ActyxEvent<Ev> }

type States = {
  merged: TimePoint[]
  split: MachinePoint[][]
}

function init(mach: Machine[]): States {
  const split = mach.map(() => [])
  return { merged: [], split }
}

function addEvent(merged: TimePoint[], event: ActyxEvent<Ev>, state: MachineState) {
  const eventId = event.meta.eventId
  const pos = binarySearch(merged, eventId)
  if (pos < 0) {
    merged.splice(~pos, 0, {
      eventId,
      event,
      machines: [state],
    })
  } else {
    merged[pos].machines.push(state)
  }
}

function merge({ merged, split }: States) {
  merged.length = 0
  for (const [idx, machine] of split.entries()) {
    for (const point of machine) {
      if (point.type === 'state') {
        for (const [i, event] of point.events.entries()) {
          const state: MachineState =
            i === point.events.length - 1
              ? { idx, type: 'state', state: point.state }
              : { idx, type: 'queued' }
          addEvent(merged, event, state)
        }
      } else {
        addEvent(merged, point.event, { idx, type: 'unhandled' })
      }
    }
  }
}

function binarySearch<T extends { eventId: string }>(arr: T[], el: string) {
  let m = 0
  let n = arr.length - 1
  while (m <= n) {
    const k = (n + m) >> 1
    const cmp = arr[k].eventId
    if (el > cmp) {
      m = k + 1
    } else if (el < cmp) {
      n = k - 1
    } else {
      return k
    }
  }
  return ~m
}

type Placement = {
  minutes: Minute[]
  perPoint: PerPoint[]
}
type Minute = {
  date: number
  center: number
  left: number
  right: number
}
type PerPoint = {
  seconds: number
  center: number
}

function placement(merged: TimePoint[]): Placement {
  // every point is 1 wide, with one “empty spot” where >1min passes
  let currPos = 0.5
  let latest = merged[0]?.event.meta.timestampMicros / 1000 ?? 0
  let beginMinute: number | null = null

  const mkMinute = (begin: number) => ({
    date: latest,
    center: (currPos + begin) / 2 - 0.5,
    left: begin - 0.5,
    right: currPos - 0.5,
  })

  const minutes: Minute[] = []
  const perPoint: PerPoint[] = []

  for (const tp of merged) {
    const time = tp.event.meta.timestampMicros / 1000
    const minute = Math.floor(time / 60_000)
    const lastMinute = Math.floor(latest / 60_000)
    if (beginMinute !== null && minute !== lastMinute) {
      minutes.push(mkMinute(beginMinute))
      beginMinute = null
    }
    if (time - latest > 60_000) currPos += 1
    if (beginMinute === null) beginMinute = currPos
    const seconds = Math.floor((time / 1000) % 60)
    perPoint.push({ seconds, center: currPos })
    latest = time
    currPos += 1
  }
  if (beginMinute !== null) {
    minutes.push(mkMinute(beginMinute))
  }
  return { minutes, perPoint }
}

function mkState(x: number, y: number, s: string, f: string, cb: () => void, rect?: boolean) {
  return (
    <>
      {rect ? (
        <Rect x={x - 5} y={y - 5} width={10} height={10} stroke={s} fill={f} strokeWidth={1} />
      ) : (
        <Circle x={x} y={y} stroke={s} fill={f} radius={4} strokeWidth={1} />
      )}
      <Rect x={x - 9} y={y - 9} width={18} height={18} onClick={cb} />
    </>
  )
}

export function AuditMachines({ actyx, machines }: Props) {
  const [states] = useState<States>(() => init(machines))
  const [places, setPlaces] = useState<Placement>({ minutes: [], perPoint: [] })
  const [se, setSE] = useState<{ state: State<Ev>; event?: ActyxEvent<Ev>; name: string }>()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const recompute = () => {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          merge(states)
          setPlaces(placement(states.merged))
        }, 250)
      }
    }
    const subs = machines.map(({ initial, where }, idx) =>
      auditMachine(
        actyx,
        where,
        initial,
        new (class {
          reset() {
            states.split[idx].length = 0
            recompute()
          }
          state(state: State<Ev>, events: ActyxEvent<Ev>[]) {
            states.split[idx].push({ type: 'state', state, events })
            recompute()
          }
          dropped(state: State<Ev>, event: ActyxEvent<Ev>) {
            states.split[idx].push({ type: 'unhandled', event })
            recompute()
          }
        })(),
      ),
    )
    return () => {
      if (timer !== null) clearTimeout(timer)
      subs.forEach((cancel) => cancel())
    }
  }, [actyx, machines, states])

  function x(w: number) {
    return w * 20 + 150
  }

  const height = 240 + 40 * machines.length
  const typeLabels = 40 * machines.length + 120

  return (
    <div>
      <Stage width={window.innerWidth} height={height}>
        <Layer>
          {places.minutes.map((m) => (
            <>
              <Text
                x={x(m.center) - 30}
                y={60}
                text={`${new Date(m.date).toISOString().substring(5, 16).replace('T', '\n')}`}
                width={60}
                align="center"
                verticalAlign="middle"
              />
              <Line y={90} points={[x(m.left) + 2, 0, x(m.right) - 2, 0]} stroke="gray" />
            </>
          ))}
          {places.perPoint.map((p, i) => (
            <>
              <Text
                x={x(p.center) - 10}
                y={100}
                text={`${p.seconds}`}
                align="center"
                width={20}
                verticalAlign="middle"
              />
              <Text
                x={x(p.center) + 10}
                y={typeLabels}
                text={states.merged[i].event.payload.type}
                rotation={90}
                verticalAlign="middle"
                height={20}
              />
            </>
          ))}
          {machines.map(({ name, initial }, idx) => {
            const y = 40 * idx + 130
            let prevState = initial
            return (
              <>
                <Label x={110} y={y}>
                  <Tag
                    fill="orange"
                    pointerDirection="right"
                    pointerHeight={10}
                    pointerWidth={10}
                  />
                  <Text text={name} fontFamily="sans-serif" fontSize={18} padding={6} />
                </Label>
                <Line
                  y={y}
                  points={[120, 0, window.innerWidth, 0]}
                  stroke="orange"
                  strokeWidth={2}
                />
                {mkState(x(-1), y, 'orange', 'orange', () => setSE({ name, state: initial }), true)}
                {states.merged.map((tp, i) => {
                  const mPos = tp.machines.findIndex((m) => m.idx === idx)
                  if (mPos < 0) return
                  const m = tp.machines[mPos]
                  const place = places.perPoint[i]
                  if (m.type === 'queued') {
                    const state = prevState
                    return mkState(x(place.center), y, 'orange', 'white', () =>
                      setSE({ name, state, event: tp.event }),
                    )
                  } else if (m.type === 'state') {
                    prevState = m.state
                    return mkState(x(place.center), y, 'orange', 'orange', () =>
                      setSE({ name, state: m.state, event: tp.event }),
                    )
                  } else if (m.type === 'error') {
                    const state = prevState
                    return mkState(x(place.center), y, 'red', 'red', () =>
                      setSE({ name, state, event: tp.event }),
                    )
                  } else {
                    const state = prevState
                    return mkState(x(place.center), y, 'red', 'white', () =>
                      setSE({ name, state, event: tp.event }),
                    )
                  }
                  return
                })}
              </>
            )
          })}
        </Layer>
      </Stage>
      {se && (
        <div style={{ display: 'flex' }}>
          <div
            style={{
              width: '50%',
              border: '1px gray solid',
              padding: 8,
              margin: 8,
              overflowX: 'scroll',
            }}
          >
            <h1>state of “{se.name}”</h1>
            <pre>
              {se.state.constructor.name} {JSON.stringify(se.state, undefined, 2)}
            </pre>
          </div>
          <div
            style={{
              width: '50%',
              border: '1px gray solid',
              padding: 8,
              margin: 8,
              overflowX: 'scroll',
            }}
          >
            <pre>{JSON.stringify(se.event, undefined, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
