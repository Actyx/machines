import { ProtocolEvents, protocol } from './protocol.js'
const { Bid, BidderID, Cancelled, PassengerID, Requested, Selected } = ProtocolEvents

const machine = protocol.makeMachine('taxi')

export const Initial = machine.designState('InitialT').withPayload<{ id: string }>().finish()

export const FirstBid = machine
  .designState('FirstBid')
  .withPayload<{ id: string; pickup: string; destination: string }>()
  .command('bid', [Bid, BidderID], (context, { time, price }: { time: Date; price: number }) => [
    { time: time.toISOString(), price },
    { id: context.self.id },
  ])
  .finish()

export const Auction = machine
  .designState('Auction')
  .withPayload<{ id: string; pickup: string; destination: string }>()
  .command('bid', [Bid, BidderID], (context, { time, price }: { time: Date; price: number }) => [
    { time: time.toISOString(), price },
    { id: context.self.id },
  ])
  .finish()

export const Ride = machine
  .designState('Ride')
  .withPayload<{ id: string; winner: string; passenger: string }>()
  .finish()

Initial.react([Requested], FirstBid, (context, { payload: { pickup, destination } }) =>
  FirstBid.make({
    id: context.self.id,
    pickup,
    destination,
  }),
)

FirstBid.react([Bid, BidderID], Auction, (context) => Auction.make({ ...context.self }))

Auction.react([Bid, BidderID], Auction, (context, bid) => {
  if (bid.payload.price === 14) throw Error('Der Clown')
  return context.self
})

Auction.react([Selected, PassengerID], Ride, (context, selected, passengerId) =>
  Ride.make({
    id: context.self.id,
    winner: selected.payload.taxiID,
    passenger: passengerId.payload.id,
  }),
)

Ride.react([Cancelled], Initial, (context) =>
  Initial.make({
    id: context.self.id,
  }),
)
