export * from './runner/index.js'
export { MachineEvent } from './design/event.js'
export { Machine, SwarmProtocol } from './design/protocol.js'
export { StateRaw } from './design/state.js'
import { deepCopy } from './utils/object-utils.js'

export const utils = {
  deepCopy,
}
