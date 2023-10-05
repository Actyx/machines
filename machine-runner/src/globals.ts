import {
  ActiveRunnerRegistryRegisterSymbol,
  GlobalEmitter,
  makeEmitter,
} from './runner/runner-utils.js'
import type { MachineRunner } from './runner/runner.js'
import type { Tags } from '@actyx/sdk'
import type { StateFactory } from './design/state.js'

export const emitter = makeEmitter() as GlobalEmitter

export type ActiveRunnerRegistry = {
  all: () => [MachineRunner.Any, ActiveRunnerRegistryDetail][]
  [ActiveRunnerRegistryRegisterSymbol]: (
    machine: MachineRunner.Any,
    detail: ActiveRunnerRegistryDetail,
  ) => void
}

export type ActiveRegistryRunnerEntry = [MachineRunner.Any, ActiveRunnerRegistryDetail]

export type ActiveRunnerRegistryDetail = {
  tags: Tags
  initialFactory: StateFactory.Any
}

/**
 * Contains all active machine runners. Use `.all` method to get all active
 * machine-runners and its details
 *
 * @example
 * // Monitoring active machine runners
 *
 * while (true) {
 *  activeRunners.all().forEach(([machine, detail]) => {
 *    console.log(machine, detail)
 *  })
 *
 *  await new Promise(res => setTimeout(res, 1000))
 * }
 */
export const activeRunners = ((): ActiveRunnerRegistry => {
  const runners = new Map<MachineRunner.Any, { tags: Tags; initialFactory: StateFactory.Any }>()

  const all: ActiveRunnerRegistry['all'] = () => Array.from(runners.entries())
  const register: ActiveRunnerRegistry[typeof ActiveRunnerRegistryRegisterSymbol] = (
    machine,
    detail,
  ) => {
    if (machine.isDestroyed()) return
    machine.events.once('destroyed', () => {
      runners.delete(machine)
    })
    runners.set(machine, detail)
  }

  return { all, [ActiveRunnerRegistryRegisterSymbol]: register }
})()
