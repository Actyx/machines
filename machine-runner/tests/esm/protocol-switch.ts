import { MachineEvent, SwarmProtocol } from '../../lib/esm/index.js'

export namespace Events {
  export const ToggleOn = MachineEvent.design('ToggleOn').withoutPayload()
  export const ToggleOff = MachineEvent.design('ToggleOff').withoutPayload()
  export const all = [ToggleOff, ToggleOn] as const
}

export const SWARM_NAME = 'switch' as const
export const MACHINE_NAME = 'switch-machine' as const

export const protocol = SwarmProtocol.make(SWARM_NAME, Events.all)
export const machine = protocol.makeMachine(MACHINE_NAME)

type StatePayload = { toggleCount: number }
export const On = machine
  .designState('On')
  .withPayload<StatePayload>()
  .command('toggle', [Events.ToggleOff], () => [{}])
  .finish()
export const Off = machine
  .designState('Off')
  .withPayload<StatePayload>()
  .command('toggle', [Events.ToggleOn], () => [{}])
  .finish()

On.react([Events.ToggleOff], Off, (ctx) => ({ toggleCount: ctx.self.toggleCount + 1 }))
Off.react([Events.ToggleOn], On, (ctx) => ({ toggleCount: ctx.self.toggleCount + 1 }))
