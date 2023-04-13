import { Door, Control, HangarBay } from './example-proto.js'
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from './src/index.js'

const swarmProtocol: SwarmProtocolType = {
  initial: 'Closed',
  transitions: [
    {
      source: 'Closed',
      target: 'Opening',
      label: { cmd: 'open', role: 'Control', logType: ['opening'] },
    },
    {
      source: 'Opening',
      target: 'Opening',
      label: { cmd: 'update', role: 'Door', logType: ['opening'] },
    },
    {
      source: 'Opening',
      target: 'Open',
      label: { cmd: 'open', role: 'Door', logType: ['opened'] },
    },
    {
      source: 'Open',
      target: 'Closing',
      label: { cmd: 'close', role: 'Control', logType: ['closing'] },
    },
    {
      source: 'Closing',
      target: 'Closing',
      label: { cmd: 'update', role: 'Door', logType: ['closing'] },
    },
    {
      source: 'Closing',
      target: 'Closed',
      label: { cmd: 'close', role: 'Door', logType: ['closed'] },
    },
  ],
}

const subscriptions = {
  Control: ['closing', 'closed', 'opening', 'opened'],
  Door: ['closing', 'closed', 'opening', 'opened'],
}

console.log(checkSwarmProtocol(swarmProtocol, subscriptions))
console.log(
  checkProjection(
    swarmProtocol,
    subscriptions,
    'Control',
    Control.Control.createJSONForAnalysis(Control.Closed),
  ),
)
console.log(
  checkProjection(
    swarmProtocol,
    subscriptions,
    'Door',
    Door.Door.createJSONForAnalysis(Door.Closed),
  ),
)
