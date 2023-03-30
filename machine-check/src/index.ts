import { check_swarm } from '../pkg/machine_check.js'

export type Protocol<Label> = {
  initial: string
  transitions: { source: string; target: string; label: Label }[]
}
export type SwarmLabel = {
  cmd: string
  logType: string[]
  role: string
}

export type MachineLabel =
  | { tag: 'Execute'; cmd: string; logType: string[] }
  | { tag: 'Input'; eventType: string }

export type SwarmProtocol = Protocol<SwarmLabel>
export type Machine = Protocol<MachineLabel>

export type Subscriptions = Record<string, string[]>

export type Result = { type: 'OK' } | { type: 'ERROR'; errors: string[] }

export function checkSwarmProtocol(proto: SwarmProtocol, subscriptions: Subscriptions): Result {
  const p = JSON.stringify(proto)
  const s = JSON.stringify(subscriptions)
  const result = check_swarm(p, s)
  return JSON.parse(result)
}
