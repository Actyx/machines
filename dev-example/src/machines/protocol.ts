/* eslint-disable @typescript-eslint/no-namespace */

import { MachineEvent, SwarmProtocol } from '@actyx/machine-runner'
import * as z from 'zod'

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

export namespace ProtocolEvents {
  // == Example of usage with Zod ==
  export const Requested = MachineEvent.design('Requested').withZod(
    z.object({
      pickup: z.string(),
      destination: z.string(),
    }),
  )

  // == Example of usage with Zod ==
  export const Bid = MachineEvent.design('Bid').withZod(
    z.object({
      price: z.number(),
      time: z.string(),
    }),
  )

  export const BidderID = MachineEvent.design('BidderID').withPayload<{
    id: string
  }>()

  export const Selected = MachineEvent.design('Selected').withPayload<{
    taxiID: string
  }>()

  export const PassengerID = MachineEvent.design('PassengerID').withPayload<{ id: string }>()

  export const Arrived = MachineEvent.design('Arrived').withPayload<{ taxiID: string }>()

  export const Started = MachineEvent.design('Started').withoutPayload()

  export const Path = MachineEvent.design('Path').withPayload<{
    lat: number
    lon: number
  }>()

  export const Finished = MachineEvent.design('Finished').withoutPayload()

  export const Cancelled = MachineEvent.design('Cancelled').withPayload<{ reason: string }>()

  export const Receipt = MachineEvent.design('Receipt').withPayload<{ amount: number }>()

  export const All = [
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
  ] as const
}

export const protocol = SwarmProtocol.make('taxiRide', ProtocolEvents.All)
