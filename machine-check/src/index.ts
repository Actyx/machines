import { check } from '../pkg/machine_check.js'

export type SwarmProtocol = {
  initial: string
}

export type Result = { type: 'OK' } | { type: 'ERROR'; errors: string[] }

export function checkSwarmProtocol(proto: SwarmProtocol): Result {
  return JSON.parse(check(JSON.stringify(proto)))
}
