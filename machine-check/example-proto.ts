/* eslint-disable @typescript-eslint/no-namespace */
import { MachineEvent } from '@actyx/machine-runner'
import { SwarmProtocol } from '@actyx/machine-runner/lib/design/protocol.js'

const mkTuple = <T extends unknown[]>(...args: T) => args

export namespace Events {
  export const Opened = MachineEvent.design('opened').withoutPayload()
  export const Closed = MachineEvent.design('closed').withoutPayload()
  export const Opening = MachineEvent.design('opening').withPayload<{ fractionOpen: number }>()
  export const Closing = MachineEvent.design('closing').withPayload<{ fractionOpen: number }>()

  export const all = mkTuple(Opened, Closed, Opening, Closing)
}

export const HangarBay = SwarmProtocol.make('HangarBay', ['hangar-bay'], Events.all)

export namespace Door {
  export const Door = HangarBay.makeMachine('door')

  export const Open = Door.designEmpty('Open').finish()
  export const Closing = Door.designState('Closing')
    .withPayload<{ fractionOpen: number }>()
    .command('update', [Events.Closing], (_ctx, fractionOpen: number) => [{ fractionOpen }])
    .command('close', [Events.Closed], (_ctx) => [{}])
    .finish()
  export const Closed = Door.designEmpty('Closed').finish()
  export const Opening = Door.designState('Opening')
    .withPayload<{ fractionOpen: number }>()
    .command('update', [Events.Opening], (_ctx, fractionOpen: number) => [{ fractionOpen }])
    .command('open', [Events.Opened], (_ctx) => [{}])
    .finish()

  Open.react([Events.Closing], Closing, (_ctx, closing) => ({
    fractionOpen: closing.payload.fractionOpen,
  }))
  Closing.react([Events.Closing], Closing, (ctx, closing) => {
    ctx.self.fractionOpen = closing.payload.fractionOpen
    return ctx.self
  })
  Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
  Closed.react([Events.Opening], Opening, (_ctx, opening) => ({
    fractionOpen: opening.payload.fractionOpen,
  }))
  Opening.react([Events.Opening], Opening, (ctx, opening) => {
    ctx.self.fractionOpen = opening.payload.fractionOpen
    return ctx.self
  })
  Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
}

export namespace Control {
  export const Control = HangarBay.makeMachine('control')

  export const Open = Control.designEmpty('Open')
    .command('close', [Events.Closing], (_ctx) => [{ fractionOpen: 1 }])
    .finish()
  export const Closing = Control.designState('Closing')
    .withPayload<{ fractionOpen: number }>()
    .finish()
  export const Closed = Control.designEmpty('Closed')
    .command('open', [Events.Opening], (_ctx) => [{ fractionOpen: 0 }])
    .finish()
  export const Opening = Control.designState('Opening')
    .withPayload<{ fractionOpen: number }>()
    .finish()

  Open.react([Events.Closing], Closing, (_ctx, closing) => ({
    fractionOpen: closing.payload.fractionOpen,
  }))
  Closing.react([Events.Closing], Closing, (ctx, closing) => {
    ctx.self.fractionOpen = closing.payload.fractionOpen
    return ctx.self
  })
  Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
  Closed.react([Events.Opening], Opening, (_ctx, opening) => ({
    fractionOpen: opening.payload.fractionOpen,
  }))
  Opening.react([Events.Opening], Opening, (ctx, opening) => {
    ctx.self.fractionOpen = opening.payload.fractionOpen
    return ctx.self
  })
  Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
}
