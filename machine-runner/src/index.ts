export { init, proto as protoUseGeneratedReExportInstead } from './decorator.js'
export { runMachine, auditMachine, Auditor } from './runner.js'
export { ToEmit, Reactions, Commands, State, Events, States } from './types.js'
import * as protocolDesigner from './api2/protocol-designer.js'
import * as stateMachine from './api2/state-machine.js'

export const api2 = {
  protocolDesigner,
  stateMachine,
}
