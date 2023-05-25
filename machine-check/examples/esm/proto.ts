/* eslint-disable @typescript-eslint/no-namespace */
import { MachineEvent, SwarmProtocol } from '@actyx/machine-runner'

/*
 * This file holds the code for the README, see there for a description of the protocol.
 */

export namespace Events {
  export const Opened = MachineEvent.design('opened').withoutPayload()
  export const Closed = MachineEvent.design('closed').withoutPayload()
  export const Opening = MachineEvent.design('opening').withoutPayload()
  export const Closing = MachineEvent.design('closing').withoutPayload()
  export const OpeningStatus = MachineEvent.design('openingStatus').withPayload<{
    fractionOpen: number
  }>()
  export const ClosingStatus = MachineEvent.design('closingStatus').withPayload<{
    fractionOpen: number
  }>()

  export const all = [Opened, Closed, Opening, Closing, OpeningStatus, ClosingStatus] as const
}

export const HangarBay = SwarmProtocol.make('HangarBay', Events.all)
