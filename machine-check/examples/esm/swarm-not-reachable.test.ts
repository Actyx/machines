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
      label: { cmd: 'update', role: 'Door', logType: [Events.OpeningStatus.type] },
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
      label: { cmd: 'update', role: 'Door', logType: [Events.ClosingStatus.type] },
    },
    {
      source: 'Closing',
      target: 'Closed',
      label: { cmd: 'close', role: 'Door', logType: [Events.Closed.type] },
    },
    {
      // Incoming neighbor to Initial
      source: 'SomeUnreachableState',
      target: 'Closed',
      label: { cmd: 'somecommand', role: 'Control', logType: [Events.Closed.type] },
    },
    {
      // Incoming neighbor to Initial
      source: 'SomeUnreachableState2',
      target: 'SomeUnreachableState',
      label: { cmd: 'somecommand', role: 'Control', logType: [Events.Closed.type] },
    },
    {
      // Disconnected graph
      source: 'SomeUnreachableState3',
      target: 'SomeUnreachableState4',
      label: { cmd: 'somecommand', role: 'Control', logType: [Events.Closed.type] },
    },
  ],
}

const subscriptions = {
  Control: [Events.Closing.type, Events.Closed.type, Events.Opening.type, Events.Opened.type],
  Door: [Events.Closing.type, Events.Closed.type, Events.Opening.type, Events.Opened.type],
}

describe('checkSwarmProtocol', () => {
  it('should catch unreachable states', () => {
    const result = checkSwarmProtocol(swarmProtocol, subscriptions)
    expect(result.type).toBe('ERROR')
    if (result.type === 'OK') throw new Error('unreachable')
    expect(result.errors).toContain('state SomeUnreachableState is unreachable from initial state')
    expect(result.errors).toContain('state SomeUnreachableState2 is unreachable from initial state')
    expect(result.errors).toContain('state SomeUnreachableState3 is unreachable from initial state')
    expect(result.errors).toContain('state SomeUnreachableState4 is unreachable from initial state')
  })
})
