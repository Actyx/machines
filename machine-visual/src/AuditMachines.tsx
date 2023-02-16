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
  | { idx: number; type: 'unhandled'; state: State<Ev> }
  | { idx: number; type: 'queued' }
  | { idx: number; type: 'error'; error: unknown }

type TimePoint = {
  eventId: string
  event: ActyxEvent<Ev>
  machines: MachineState[]
}

type MachinePoint =
  | { type: 'state'; state: State<Ev>; events: ActyxEvent<Ev>[] }
  | { type: 'unhandled'; state: State<Ev>; event: ActyxEvent<Ev> }
  | { type: 'error'; state: State<Ev>; events: ActyxEvent<Ev>[]; err: unknown }

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
      } else if (point.type === 'error') {
        for (const [i, event] of point.events.entries()) {
          const state: MachineState =
            i === point.events.length - 1
              ? { idx, type: 'error', error: point.err }
              : { idx, type: 'queued' }
          addEvent(merged, event, state)
        }
      } else {
        addEvent(merged, point.event, { idx, type: 'unhandled', state: point.state })
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
      if (minutes.length > 0 && minutes[minutes.length - 1].center > currPos - 2.1) {
        currPos += 1
        beginMinute += 1
        perPoint[perPoint.length - 1].center += 1
      }
      minutes.push(mkMinute(beginMinute))
      beginMinute = null
    }
    if (Math.abs(time - latest) > 60_000) currPos += 1
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

function mkState(
  x: number,
  y: number,
  s: string,
  f: string,
  cb: (() => void) | undefined,
  rect?: boolean,
) {
  return (
    <>
      {rect ? (
        <Rect x={x - 5} y={y - 5} width={10} height={10} stroke={s} fill={f} strokeWidth={1} />
      ) : (
        <Circle x={x} y={y} stroke={s} fill={f} radius={4} strokeWidth={s === 'red' ? 2 : 1} />
      )}
      <Rect
        x={x - 9}
        y={y - 9}
        width={18}
        height={18}
        onClick={cb}
        opacity={0.3}
        fill={cb ? undefined : 'black'}
      />
    </>
  )
}

export function AuditMachines({ actyx, machines }: Props) {
  const [states] = useState<States>(() => init(machines))
  const [places, setPlaces] = useState<Placement>({ minutes: [], perPoint: [] })
  const [se, setSE] = useState<{
    state: State<Ev>
    name: string
    machNr: number
    tpIdx: number
  }>()

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
    const subs = machines.map(({ initial, where }, machNr) =>
      auditMachine(
        actyx,
        where,
        initial,
        new (class {
          reset() {
            states.split[machNr].length = 0
            recompute()
          }
          state(state: State<Ev>, events: ActyxEvent<Ev>[]) {
            states.split[machNr].push({ type: 'state', state, events })
            recompute()
          }
          dropped(state: State<Ev>, event: ActyxEvent<Ev>) {
            states.split[machNr].push({ type: 'unhandled', event, state })
            recompute()
          }
          error(state: State<Ev>, events: ActyxEvent<Ev>[], err: unknown) {
            states.split[machNr].push({ type: 'error', events, err, state })
          }
        })(),
      ),
    )
    return () => {
      if (timer !== null) clearTimeout(timer)
      subs.forEach((cancel) => cancel())
    }
  }, [actyx, machines, states])

  const mkX = (w: number) => w * 20 + 150
  const height = 240 + 40 * machines.length
  const width = (places.perPoint[places.perPoint.length - 1]?.center ?? 0) * 20 + 180
  const typeLabels = 40 * machines.length + 120

  const effect = (machNr: number, tpIdx: number) => {
    const mach = states.merged[tpIdx].machines.find((m) => m.idx === machNr)
    const event = states.merged[tpIdx].event
    massage(event)
    if (mach === undefined) return
    const tpe = mach.type
    const mkErr = (err: unknown) => {
      const s1 = `${err}`
      const s2 = (err as Error).stack ?? ''
      return s2.startsWith(s1) ? s2 : `${s1}\n${s2}`
    }
    return tpe === 'state' ? (
      <>
        <h1>event triggered state update</h1>
        <pre>{pretty(event)}</pre>
      </>
    ) : tpe === 'queued' ? (
      <>
        <h1>event was enqueued</h1>
        <pre>{pretty(event)}</pre>
      </>
    ) : tpe === 'unhandled' ? (
      <>
        <h1>event was unhandled</h1>
        <pre>{pretty(event)}</pre>
      </>
    ) : (
      <>
        <h1>event caused exception</h1>
        <pre
          style={{
            overflow: 'scroll',
            maxHeight: '5rem',
            border: '1px solid gray',
            padding: '4px',
          }}
        >
          {mkErr(mach.error)}
        </pre>
        <pre>{pretty(event)}</pre>
      </>
    )
  }
  const event =
    se === undefined ? undefined : se.tpIdx < 0 ? (
      <h1>initial state</h1>
    ) : (
      effect(se.machNr, se.tpIdx)
    )

  function pretty(obj: unknown) {
    return JSON.stringify(obj, undefined, 2)
  }
  function massage(event: ActyxEvent<Ev>) {
    const ts = event.meta.timestampAsDate().toISOString()
    const meta = event.meta as Record<string, unknown>
    meta.timestamp = ts
    delete meta.eventId
    delete meta.offset
  }

  return (
    <div>
      <Stage width={width} height={height} style={{ overflow: 'scroll' }}>
        <Layer>
          {places.minutes.map((minute, mIdx) => (
            <>
              <Text
                x={mkX(minute.center) - 30}
                y={60}
                text={`${new Date(minute.date).toISOString().substring(5, 16).replace('T', '\n')}`}
                width={60}
                align="center"
                verticalAlign="middle"
                fill={mIdx > 0 && minute.date < places.minutes[mIdx - 1].date ? 'red' : 'black'}
              />
              <Line
                y={90}
                points={[mkX(minute.left) + 2, 0, mkX(minute.right) - 2, 0]}
                stroke="gray"
              />
            </>
          ))}
          {places.perPoint.map((pp, ppIdx) => (
            <>
              <Text
                x={mkX(pp.center) - 10}
                y={100}
                text={`${pp.seconds}`}
                align="center"
                width={20}
                verticalAlign="middle"
                fill="gray"
              />
              <Text
                x={mkX(pp.center) + 10}
                y={typeLabels}
                text={states.merged[ppIdx].event.payload.type}
                rotation={90}
                verticalAlign="middle"
                height={20}
              />
            </>
          ))}
          {machines.map(({ name, initial }, machNr) => {
            const y = 40 * machNr + 130
            let prevState = initial
            const initCB =
              machNr === se?.machNr && -1 === se?.tpIdx
                ? undefined
                : () => setSE({ name, state: initial, machNr, tpIdx: -1 })
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
                {mkState(mkX(-1), y, 'orange', 'orange', initCB, true)}
                {states.merged.map((tp, tpIdx) => {
                  const mPos = tp.machines.findIndex((m) => m.idx === machNr)
                  if (mPos < 0) return
                  const m = tp.machines[mPos]
                  const x = mkX(places.perPoint[tpIdx].center)
                  const mkCB = (state: State<Ev>) =>
                    machNr === se?.machNr && tpIdx === se?.tpIdx
                      ? undefined
                      : () => setSE({ name, state, machNr, tpIdx })
                  if (m.type === 'queued') {
                    return mkState(x, y, 'orange', 'white', mkCB(prevState))
                  } else if (m.type === 'state') {
                    prevState = m.state
                    return mkState(x, y, 'orange', 'orange', mkCB(m.state))
                  } else if (m.type === 'error') {
                    return mkState(x, y, 'red', 'red', mkCB(prevState))
                  } else {
                    return mkState(x, y, 'red', 'white', mkCB(prevState))
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
              {se.state.constructor.name} {pretty(se.state)}
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
            {event}
          </div>
        </div>
      )}
    </div>
  )
}
