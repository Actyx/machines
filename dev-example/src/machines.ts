import { Tag } from '@actyx/sdk'
import { MachineEvent, Protocol } from '@actyx/machine-runner'

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

export const protocol = Protocol.make('taxiRide', [
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
])

export const TaxiTag = protocol.tag('taxi')

// States

export const InitialP = protocol
  .designEmpty('InitialP')
  .command('request', [Requested], (_, params: { pickup: string; destination: string }) => [
    Requested.make(params),
  ])
  .finish()

export const AuctionP = protocol
  .designState('AuctionP')
  .withPayload<{
    pickup: string
    destination: string
    bids: BidData[]
  }>()
  .command('select', [Selected, PassengerID], (context, bidderID: string) => {
    const bids = context.self.bids
    const matchingBid = bids.find((bid) => {
      return bid.bidderID === bidderID
    })

    if (matchingBid) {
      return [{ taxiID: matchingBid.bidderID }, { id: 'me' }]
    }
    throw new Error('unknown bidderId')
  })
  .finish()

export const RideP = protocol
  .designState('RideP')
  .withPayload<{ taxiID: string }>()
  .command('cancel', [Cancelled], () => [{ reason: "don't wanna" }])
  .finish()

export const InitialT = protocol.designState('InitialT').withPayload<{ id: string }>().finish()

export const FirstBidT = protocol
  .designState('FirstBidT')
  .withPayload<{ id: string; pickup: string; destination: string }>()
  .command('bid', [Bid, BidderID], (context, { time, price }: { time: Date; price: number }) => [
    { time: time.toISOString(), price },
    { id: context.self.id },
  ])
  .finish()

export const AuctionT = protocol
  .designState('AuctionT')
  .withPayload<{ id: string; pickup: string; destination: string }>()
  .command('bid', [Bid, BidderID], (context, { time, price }: { time: Date; price: number }) => [
    { time: time.toISOString(), price },
    { id: context.self.id },
  ])
  .finish()

export const RideT = protocol
  .designState('RideT')
  .withPayload<{ id: string; winner: string; passenger: string }>()
  .finish()

// Designing Reactions

InitialP.react([Requested, Bid, BidderID], AuctionP, (context, requested, bid, bidderId) => {
  const { pickup, destination } = requested.payload
  return AuctionP.make({
    pickup,
    destination,
    bids: [
      {
        bidderID: bidderId.payload.id,
        price: bid.payload.price,
        time: new Date(bid.payload.time),
      },
    ],
  })
})

AuctionP.react([Bid, BidderID], AuctionP, (context, bid, bidderID) => {
  context.self.bids.push({
    bidderID: bidderID.payload.id,
    price: bid.payload.price,
    time: new Date(bid.payload.time),
  })
  return context.self
})

AuctionP.react([Selected, PassengerID], RideP, (context, selected) =>
  RideP.make({ taxiID: selected.payload.taxiID }),
)

RideP.react([Cancelled], InitialP, () => InitialP.make())

InitialT.react([Requested], FirstBidT, (context, { payload: { pickup, destination } }) =>
  FirstBidT.make({
    id: context.self.id,
    pickup,
    destination,
  }),
)

FirstBidT.react([Bid, BidderID], AuctionT, (context) => AuctionT.make({ ...context.self }))

AuctionT.react([Bid, BidderID], AuctionT, (context, bid) => {
  if (bid.payload.price === 14) throw Error('Der Clown')
  return context.self
})

AuctionT.react([Selected, PassengerID], RideT, (context, selected, passengerId) =>
  RideT.make({
    id: context.self.id,
    winner: selected.payload.taxiID,
    passenger: passengerId.payload.id,
  }),
)

RideT.react([Cancelled], InitialT, (context) =>
  InitialT.make({
    id: context.self.id,
  }),
)
