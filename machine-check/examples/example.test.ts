import { describe, expect, it } from '@jest/globals'
import { Door, Control } from './example-proto'
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from '../src/index.js'

/*
 * This file holds the code for the README, see there for a description of the protocol.
 */

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

describe('swarmProtocol', () => {
  it('should be well-formed', () => {
    expect(checkSwarmProtocol(swarmProtocol, subscriptions)).toEqual({ type: 'OK' })
  })
  it('should match Control', () => {
    expect(
      checkProjection(
        swarmProtocol,
        subscriptions,
        'Control',
        Control.Control.createJSONForAnalysis(Control.Closed),
      ),
    ).toEqual({ type: 'OK' })
  })
  it('should match Door', () => {
    expect(
      checkProjection(
        swarmProtocol,
        subscriptions,
        'Door',
        Door.Door.createJSONForAnalysis(Door.Closed),
      ),
    ).toEqual({ type: 'OK' })
  })
})
