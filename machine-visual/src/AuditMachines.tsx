import { auditMachine, State } from '@actyx/machine-runner'
import { Actyx, ActyxEvent, Where } from '@actyx/sdk'
import { useEffect, useReducer, useState } from 'react'

type Ev = { type: string }
type Machine = { where: Where<Ev>; initial: State<Ev> }
type Props = {
  actyx: Actyx
  machines: Machine[]
  className?: string
}

type MachineState = {
  state: State<Ev>
  events: ActyxEvent<Ev>[]
}
type TimePoint = {
  eventId: string
  timestamp: number
  machines: MachineState[]
}
type MachinePoint = {
  eventId: string
  timestamp: number
  state: State<Ev>
  events: ActyxEvent<Ev>[]
}
type States = {
  merged: TimePoint[]
  split: MachinePoint[][]
}

const PRIMORDIAL = '0 primordial'

function init(mach: Machine[]): States {
  const machines = mach.map(({ initial }) => ({ state: initial, events: [] }))
  const merged = [{ eventId: PRIMORDIAL, timestamp: 0, machines }]
  const split = mach.map(() => [])
  return { merged, split }
}

function merge({ merged, split }: States) {
  merged.length = 1

  function* iter() {
    const spos = split.map(() => 0)
    let active = spos.length
    let prevMachines = merged[0].machines
    while (active > 0) {
      active = spos.length
      const [eventId, timestamp, machines] = spos.reduce(
        (acc: [string, number, MachineState[]], pos, idx) => {
          if (pos >= split[idx].length) {
            active -= 1
            acc[2].push({ ...prevMachines[idx], events: [] })
            return acc
          }
          const curr = split[idx][pos]
          const min = acc[0]
          const states = acc[2]
          if (curr.eventId > min) states.push({ ...prevMachines[idx], events: [] })
          else if (curr.eventId === min) {
            spos[idx] += 1
            states.push({ state: curr.state, events: curr.events })
          } else {
            // found new oldest event
            acc[0] = curr.eventId
            acc[1] = curr.timestamp
            for (let i = 0; i < states.length; i += 1) {
              // “uncomsume” previously added state updates
              if (states[i].events.length > 0) spos[i] -= 1
              states[i] = { state: prevMachines[i].state, events: [] }
            }
            states.push({ state: curr.state, events: curr.events })
            spos[idx] += 1
          }
          return acc
        },
        ['999', 0, []],
      )
      if (eventId !== '999') yield { eventId, timestamp, machines }
      prevMachines = machines
    }
  }

  merged.push(...iter())
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

export function AuditMachines({ actyx, machines }: Props) {
  const [states] = useState<States>(() => init(machines))
  const [, update] = useReducer((x) => x + 1, 0)
  const [slot, setSlot] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const recompute = () => {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          merge(states)
          if (slot >= states.merged.length) setSlot(states.merged.length - 1)
          update()
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
          state(eventId: string, state: State<Ev>, events: ActyxEvent<Ev>[]) {
            const timestamp = events[events.length - 1].meta.timestampMicros / 1000
            states.split[idx].push({ eventId, timestamp, state, events })
            recompute()
          }
          dropped(state: State<Ev>, event: ActyxEvent<Ev>) {
            // TODO
          }
        })(),
      ),
    )
    return () => {
      if (timer !== null) clearTimeout(timer)
      subs.forEach((cancel) => cancel())
    }
  }, [actyx, machines, states])

  return (
    <div style={{ display: 'flex' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {states.merged[slot].machines.map((m) => (
          <div style={{ border: '1px gray solid', width: '300px', overflowX: 'scroll' }}>
            <pre>
              {m.state.constructor.name} {JSON.stringify(m.state, undefined, 2)}
            </pre>
          </div>
        ))}
      </div>
      <ul>
        {states.merged.map((state, idx) => (
          <li style={idx === slot ? { color: 'green' } : {}} onClick={() => setSlot(idx)}>
            {state.eventId}
          </li>
        ))}
      </ul>
    </div>
  )
}
