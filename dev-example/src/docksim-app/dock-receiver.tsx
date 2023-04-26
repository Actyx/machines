import { protocol } from './dock-protocol.js'

export namespace Receiver {
  export const machineProtocol = protocol.makeMachine('ShipReceivingAgent')

  export const Unhandled = machineProtocol.designEmpty('Requesting').finish()

  export const Done = machineProtocol.designEmpty('Done').finish()

  export const Aborted = machineProtocol.designEmpty('Expired').finish()
}
