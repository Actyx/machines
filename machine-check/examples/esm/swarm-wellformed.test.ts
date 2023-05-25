import { describe, expect, it } from '@jest/globals'
import { Events, HangarBay } from './proto.js'
import { SwarmProtocolType, checkSwarmProtocol, checkProjection } from '../..'

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
  ],
}

const subscriptions = {
  Control: [
    Events.Closing.type,
    Events.Closed.type,
    Events.OpeningStatus.type,
    Events.ClosingStatus.type,
    Events.Opening.type,
    Events.Opened.type,
  ],
  Door: [
    Events.Closing.type,
    Events.Closed.type,
    Events.OpeningStatus.type,
    Events.ClosingStatus.type,
    Events.Opening.type,
    Events.Opened.type,
  ],
}

describe('checkSwarmProtocol', () => {
  it('should catch not well-formed protocol', () => {
    expect(checkSwarmProtocol(swarmProtocol, subscriptions)).toEqual({
      type: 'OK',
    })
  })
})

export namespace NotWellFormed {
  export namespace Door {
    export const machine = HangarBay.makeMachine('door')
    export const Open = machine.designEmpty('Open').finish()
    export const Closing = machine
      .designState('Closing')
      .withPayload<{ fractionOpen: number }>()
      .command('update', [Events.Closing], (_ctx, fractionOpen: number) => [{ fractionOpen }])
      .command('close', [Events.Closed], (_ctx) => [{}])
      .finish()
    export const Closed = machine.designEmpty('Closed').finish()
    export const Opening = machine
      .designState('Opening')
      .withPayload<{ fractionOpen: number }>()
      .command('update', [Events.Opening], (_ctx, fractionOpen: number) => [{ fractionOpen }])
      .command('open', [Events.Opened], (_ctx) => [{}])
      .finish()
    Open.react([Events.ClosingStatus], Closing, (_ctx, closing) => ({
      fractionOpen: closing.payload.fractionOpen,
    }))
    Closing.react([Events.ClosingStatus], Closing, (ctx, closing) => {
      ctx.self.fractionOpen = closing.payload.fractionOpen
      return ctx.self
    })
    Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
    Closed.react([Events.OpeningStatus], Opening, (_ctx, opening) => ({
      fractionOpen: opening.payload.fractionOpen,
    }))
    Opening.react([Events.OpeningStatus], Opening, (ctx, opening) => {
      ctx.self.fractionOpen = opening.payload.fractionOpen
      return ctx.self
    })
    Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
  }

  export namespace Control {
    export const machine = HangarBay.makeMachine('control')
    export const Open = machine
      .designEmpty('Open')
      .command('close', [Events.Closing], (_ctx) => [{ fractionOpen: 1 }])
      .finish()
    export const Closing = machine
      .designState('Closing')
      .withPayload<{ fractionOpen: number }>()
      .finish()
    export const Closed = machine
      .designEmpty('Closed')
      .command('open', [Events.Opening], (_ctx) => [{ fractionOpen: 0 }])
      .finish()
    export const Opening = machine
      .designState('Opening')
      .withPayload<{ fractionOpen: number }>()
      .finish()
    Open.react([Events.ClosingStatus], Closing, (_ctx, closing) => ({
      fractionOpen: closing.payload.fractionOpen,
    }))
    Closing.react([Events.ClosingStatus], Closing, (ctx, closing) => {
      ctx.self.fractionOpen = closing.payload.fractionOpen
      return ctx.self
    })
    Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
    Closed.react([Events.OpeningStatus], Opening, (_ctx, opening) => ({
      fractionOpen: opening.payload.fractionOpen,
    }))
    Opening.react([Events.OpeningStatus], Opening, (ctx, opening) => {
      ctx.self.fractionOpen = opening.payload.fractionOpen
      return ctx.self
    })
    Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
  }
}

export namespace WellFormed {
  export namespace Door {
    export const machine = HangarBay.makeMachine('door')
    export const Open = machine.designEmpty('Open').finish()
    export const Closing = machine
      .designState('Closing')
      .withPayload<{ fractionOpen: number }>()
      .command('update', [Events.ClosingStatus], (_ctx, fractionOpen: number) => [{ fractionOpen }])
      .command('close', [Events.Closed], (_ctx) => [{}])
      .finish()
    export const Closed = machine.designEmpty('Closed').finish()
    export const Opening = machine
      .designState('Opening')
      .withPayload<{ fractionOpen: number }>()
      .command('update', [Events.OpeningStatus], (_ctx, fractionOpen: number) => [{ fractionOpen }])
      .command('open', [Events.Opened], (_ctx) => [{}])
      .finish()
    Open.react([Events.Closing], Closing, (_ctx) => ({
      fractionOpen: 0,
    }))
    Closing.react([Events.ClosingStatus], Closing, (ctx, closing) => {
      ctx.self.fractionOpen = closing.payload.fractionOpen
      return ctx.self
    })
    Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
    Closed.react([Events.Opening], Opening, (_ctx) => ({
      fractionOpen: 0,
    }))
    Opening.react([Events.OpeningStatus], Opening, (ctx, opening) => {
      ctx.self.fractionOpen = opening.payload.fractionOpen
      return ctx.self
    })
    Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
  }

  export namespace Control {
    export const machine = HangarBay.makeMachine('control')
    export const Open = machine
      .designEmpty('Open')
      .command('close', [Events.Closing], (_ctx) => [{ fractionOpen: 1 }])
      .finish()
    export const Closing = machine
      .designState('Closing')
      .withPayload<{ fractionOpen: number }>()
      .finish()
    export const Closed = machine
      .designEmpty('Closed')
      .command('open', [Events.Opening], (_ctx) => [{ fractionOpen: 0 }])
      .finish()
    export const Opening = machine
      .designState('Opening')
      .withPayload<{ fractionOpen: number }>()
      .finish()
    Open.react([Events.Closing], Closing, (_ctx) => ({
      fractionOpen: 0,
    }))
    Closing.react([Events.ClosingStatus], Closing, (ctx, closing) => {
      ctx.self.fractionOpen = closing.payload.fractionOpen
      return ctx.self
    })
    Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
    Closed.react([Events.Opening], Opening, (_ctx) => ({
      fractionOpen: 0,
    }))
    Opening.react([Events.OpeningStatus], Opening, (ctx, opening) => {
      ctx.self.fractionOpen = opening.payload.fractionOpen
      return ctx.self
    })
    Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
  }
}

describe('checkProjection', () => {
  describe('not wellformed', () => {
    it('should match Control', () => {
      expect(
        checkProjection(
          swarmProtocol,
          subscriptions,
          'Control',
          NotWellFormed.Control.machine.createJSONForAnalysis(NotWellFormed.Control.Closed),
        ),
      ).toEqual({
        type: 'ERROR',
        errors: [
          `missing transition ${Events.Opening.type}? in state Closed (from reference state Closed)`,
          `extraneous transition ${Events.OpeningStatus.type}? in state Closed`,
        ],
      })
    })

    it('should match Door', () => {
      expect(
        checkProjection(
          swarmProtocol,
          subscriptions,
          'Door',
          NotWellFormed.Door.machine.createJSONForAnalysis(NotWellFormed.Door.Closed),
        ),
      ).toEqual({
        type: 'ERROR',
        errors: [
          `missing transition ${Events.Opening.type}? in state Closed (from reference state Closed)`,
          `extraneous transition ${Events.OpeningStatus.type}? in state Closed`,
        ],
      })
    })
  })

  describe('wellformed', () => {
    it('should match Control', () => {
      expect(
        checkProjection(
          swarmProtocol,
          subscriptions,
          'Control',
          WellFormed.Control.machine.createJSONForAnalysis(WellFormed.Control.Closed),
        ),
      ).toEqual({
        type: 'OK',
      })
    })

    it('should match Door', () => {
      expect(
        checkProjection(
          swarmProtocol,
          subscriptions,
          'Door',
          WellFormed.Door.machine.createJSONForAnalysis(WellFormed.Door.Closed),
        ),
      ).toEqual({
        type: 'OK',
      })
    })
  })
})
