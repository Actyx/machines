import { Tag } from '@actyx/sdk'
import { Protocol } from '@actyx/machine-runner/lib/api2.js'
import { Event } from '@actyx/machine-runner/lib/api2/event.js'

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

export const Requested = Event.design('Requested').withPayload<{
  pickup: string
  destination: string
}>()

export const Bid = Event.design('Bid').withPayload<{
  price: number
  time: string
}>()

export const BidderID = Event.design('BidderID').withPayload<{
  id: string
}>()

export const Selected = Event.design('Selected').withPayload<{
  taxiID: string
}>()

export const PassengerID = Event.design('PassengerID').withPayload<{ id: string }>()

export const Arrived = Event.design('Arrived').withPayload<{ taxiID: string }>()

export const Started = Event.design('Arrived').withPayload<{}>()

export const Path = Event.design('Path').withPayload<{
  lat: number
  lon: number
}>()

export const Finished = Event.design('Path').withPayload<{}>()

export const Cancelled = Event.design('Path').withPayload<{ reason: string }>()

export const Receipt = Event.design('Path').withPayload<{ amount: number }>()

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

// TODO: fix ergonomic
// Protocol.EventsOf<typeof protocol> is not convenient
export const TaxiTag = Tag<Protocol.EventsOf<typeof protocol>>('taxi')

// States

// TODO: fix ergonomic
// Writing reactions before all states are defined is janky because
// E.g. Writing AuctionP.make(...) before AuctionP makes TS marks AuctionP as a compile error in the IDE
// Consideration, focus on State creation and commands before writing reactions?
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

InitialP.react([Requested, Bid, BidderID], AuctionP, (context, [requested, bid, bidderId]) => {
  const { pickup, destination } = requested
  return AuctionP.make({
    pickup,
    destination,
    bids: [
      {
        bidderID: bidderId.id,
        price: bid.price,
        time: new Date(bid.time),
      },
    ],
  })
})

AuctionP.react([Bid, BidderID], AuctionP, (context, [bid, bidderID]) => {
  context.self.bids.push({ bidderID: bidderID.id, price: bid.price, time: new Date(bid.time) })
  return context.self
})

AuctionP.react([Selected, PassengerID], RideP, (context, [selected]) =>
  RideP.make({ taxiID: selected.taxiID }),
)

RideP.react([Cancelled], InitialP, () => InitialP.make())

InitialT.react([Requested], FirstBidT, (context, [{ pickup, destination }]) =>
  FirstBidT.make({
    id: context.self.id,
    pickup,
    destination,
  }),
)

FirstBidT.react([Bid, BidderID], AuctionT, (context, []) => AuctionT.make({ ...context.self }))

AuctionT.react([Bid, BidderID], AuctionT, (context, [bid]) => {
  if (bid.price === 14) throw Error('Der Clown')
  return context.self
})

AuctionT.react([Selected, PassengerID], RideT, (context, [selected, passengerId]) =>
  RideT.make({
    id: context.self.id,
    winner: selected.taxiID,
    passenger: passengerId.id,
  }),
)

RideT.react([Cancelled], InitialT, (context) =>
  InitialT.make({
    id: context.self.id,
  }),
)
