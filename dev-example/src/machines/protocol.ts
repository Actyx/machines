import { MachineEvent } from '@actyx/machine-runner'
import { SwarmProtocol } from '@actyx/machine-runner/lib/design/protocol.js'

/**
 * Actyx pub-sub is based on topics selected by tagging (which supports
 * boolean operators to perform event set union and intersection).
 *
 * The taxi ride machines use events tagged with `taxi`.
 */

export type BidData = {
  price: number
  time: Date
  bidderID: string
}

// Events

export const Requested = MachineEvent.design('Requested').withPayload<{
  pickup: string
  destination: string
}>()

export const Bid = MachineEvent.design('Bid').withPayload<{
  price: number
  time: string
}>()

export const BidderID = MachineEvent.design('BidderID').withPayload<{
  id: string
}>()

export const Selected = MachineEvent.design('Selected').withPayload<{
  taxiID: string
}>()

export const PassengerID = MachineEvent.design('PassengerID').withPayload<{ id: string }>()

export const Arrived = MachineEvent.design('Arrived').withPayload<{ taxiID: string }>()

export const Started = MachineEvent.design('Arrived').withoutPayload()

export const Path = MachineEvent.design('Path').withPayload<{
  lat: number
  lon: number
}>()

export const Finished = MachineEvent.design('Path').withoutPayload()

export const Cancelled = MachineEvent.design('Path').withPayload<{ reason: string }>()

export const Receipt = MachineEvent.design('Path').withPayload<{ amount: number }>()

export const protocol = SwarmProtocol.make(
  'taxiRide',
  ['taxiRide'],
  [
    Requested,
    Bid,
    BidderID,
    Selected,
    PassengerID,
    Arrived,
    Started,
    Path,
    Finished,
    Cancelled,
    Receipt,
  ],
)
