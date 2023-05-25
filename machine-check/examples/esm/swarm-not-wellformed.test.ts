import { describe, expect, it } from '@jest/globals'
import { Events } from './proto.js'
import { SwarmProtocolType, checkSwarmProtocol } from '../..'

/*
 * This file holds the code for the README, see there for a description of the protocol.
 */

const swarmProtocol: SwarmProtocolType = {
  initial: 'Closed',
  transitions: [
    {
      source: 'Closed',
      target: 'Opening',
      label: { cmd: 'open', role: 'Control', logType: [Events.Opening.type] },
    },
    {
      source: 'Opening',
      target: 'Opening',
      label: { cmd: 'update', role: 'Door', logType: [Events.Opening.type] },
    },
    {
      source: 'Opening',
      target: 'Open',
      label: { cmd: 'open', role: 'Door', logType: [Events.Opened.type] },
    },
    {
      source: 'Open',
      target: 'Closing',
      label: { cmd: 'close', role: 'Control', logType: [Events.Closing.type] },
    },
    {
      source: 'Closing',
      target: 'Closing',
      label: { cmd: 'update', role: 'Door', logType: [Events.Closing.type] },
    },
    {
      source: 'Closing',
      target: 'Closed',
      label: { cmd: 'close', role: 'Door', logType: [Events.Closed.type] },
    },
  ],
}

const subscriptions = {
  Control: [Events.Closing.type, Events.Closed.type, Events.Opening.type, Events.Opened.type],
  Door: [Events.Closing.type, Events.Closed.type, Events.Opening.type, Events.Opened.type],
}

describe('checkSwarmProtocol', () => {
  it('should catch not well-formed protocol', () => {
    expect(checkSwarmProtocol(swarmProtocol, subscriptions)).toEqual({
      type: 'ERROR',
      errors: [
        `guard event type ${Events.Opening.type} appears in transitions from multiple states`,
        `guard event type ${Events.Closing.type} appears in transitions from multiple states`,
      ],
    })
  })
})
