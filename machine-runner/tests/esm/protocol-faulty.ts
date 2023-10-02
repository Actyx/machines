import { MachineEvent, SwarmProtocol } from '../../lib/esm/index.js'

export namespace Events {
  export const Throw = MachineEvent.design('Throw').withoutPayload()
  export const all = [Throw] as const
}

export const SWARM_NAME = 'faulty' as const
export const MACHINE_NAME = 'faulty-machine' as const

export const protocol = SwarmProtocol.make(SWARM_NAME, Events.all)
export const machine = protocol.makeMachine(MACHINE_NAME)

export const Initial = machine
  .designEmpty('Initial')
  .command('throw', [Events.Throw], () => [{}])
  .finish()

export const ThrownError = new Error('faulty')

Initial.reactIntoSelf([Events.Throw], (ctx) => {
  throw ThrownError
})
