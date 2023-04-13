import { check_swarm, check_projection } from '../pkg/machine_check.js'

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

export type SwarmProtocolType = Protocol<SwarmLabel>
export type MachineType = Protocol<MachineLabel>

export type Subscriptions = Record<string, string[]>

export type Result = { type: 'OK' } | { type: 'ERROR'; errors: string[] }

export function checkSwarmProtocol(proto: SwarmProtocolType, subscriptions: Subscriptions): Result {
  const p = JSON.stringify(proto)
  const s = JSON.stringify(subscriptions)
  const result = check_swarm(p, s)
  return JSON.parse(result)
}

export function checkProjection(
  swarm: SwarmProtocolType,
  subscriptions: Subscriptions,
  role: string,
  machine: MachineType,
): Result {
  const sw = JSON.stringify(swarm)
  const sub = JSON.stringify(subscriptions)
  const m = JSON.stringify(machine)
  const result = check_projection(sw, sub, role, m)
  return JSON.parse(result)
}
