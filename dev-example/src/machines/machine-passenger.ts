import { protocol, ProtocolEvents, BidData } from './protocol.js'
const { Bid, BidderID, Cancelled, PassengerID, Requested, Selected } = ProtocolEvents

const machine = protocol.makeMachine('passenger')
export const Initial = machine
  .designEmpty('Initial')
  .command('request', [Requested], (_, params: { pickup: string; destination: string }) => [
    Requested.make(params),
  ])
  .finish()

export const Auction = machine
  .designState('Auction')
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

export const Ride = machine
  .designState('Ride')
  .withPayload<{ taxiID: string }>()
  .command('cancel', [Cancelled], () => [{ reason: "don't wanna" }])
  .finish()

// Designing Reactions

Initial.react([Requested, Bid, BidderID], Auction, (context, requested, bid, bidderId) => {
  const { pickup, destination } = requested.payload
  return Auction.make({
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

Auction.react([Bid, BidderID], Auction, (context, bid, bidderID) => {
  context.self.bids.push({
    bidderID: bidderID.payload.id,
    price: bid.payload.price,
    time: new Date(bid.payload.time),
  })
  return context.self
})

Auction.react([Selected, PassengerID], Ride, (context, selected) =>
  Ride.make({ taxiID: selected.payload.taxiID }),
)

Ride.react([Cancelled], Initial, () => Initial.make())
