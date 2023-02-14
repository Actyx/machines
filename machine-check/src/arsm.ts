import { States, ToEmit } from '@actyx/machine-runner'

export type Label =
  | { action: { cmd: string; logtype: string[] }; tag: 'Execute' }
  | { etype: string; tag: 'Input' }
export type Transition = {
  label: Label
  source: string
  target: string
}
export type Machine = {
  initial: string
  transitions: Transition[]
}

export function toARSM(emit: States['states'], initial: string): Machine {
  const states = { ...emit }
  const transitions: Transition[] = []
  let stateNumber = 0
  const nextState = () => (++stateNumber).toString()
  const one = (stateName: string) => {
    const state = states[stateName]
    if (!state) return
    delete states[stateName]
    for (const [cmd, { events }] of Object.entries(state.commands)) {
      const logtype = events
      transitions.push({
        label: { action: { cmd, logtype }, tag: 'Execute' },
        source: stateName,
        target: stateName,
      })
    }
    for (const [first, { moreEvents, target }] of Object.entries(state.events)) {
      let current = stateName
      const last = moreEvents.length
      ;[first, ...moreEvents].forEach((etype, idx) => {
        const t = idx === last ? target : nextState()
        transitions.push({ label: { etype, tag: 'Input' }, source: current, target: t })
        current = t
      })
      one(target)
    }
  }
  one(initial)
  return { initial, transitions }
}

export function getSubscriptions(emit: ToEmit['']): Record<string, string[]> {
  const ret: Record<string, string[]> = {}
  const traverse = (state: string, seen: string[], sub: Record<string, null>) => {
    if (seen.includes(state)) return
    seen.push(state)
    for (const [ev, { moreEvents, target }] of Object.entries(emit.states[state].events)) {
      sub[ev] = null
      for (const e of moreEvents) {
        sub[e] = null
      }
      traverse(target, seen, sub)
    }
  }
  for (const { state, role } of emit.entrypoints) {
    const sub: Record<string, null> = {}
    traverse(state, [], sub)
    ret[role] = Object.keys(sub)
  }
  return ret
}
