import { Tag } from '@actyx/sdk'
import { ProtocolDesigner } from '@actyx/machine-runner/lib/api2/protocol-designer.js'
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
  time: Date
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

export const protocol = ProtocolDesigner.init([
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
// ProtocolDesigner.EventsOf<typeof protocol> is not convenient
export const TaxiTag = Tag<ProtocolDesigner.EventsOf<typeof protocol>>('taxi')

// States

// TODO: fix ergonomic
// Writing reactions before all states are defined is janky because
// E.g. Writing AuctionP.make(...) before AuctionP makes TS marks AuctionP as a compile error in the IDE
// Consideration, focus on State creation and commands before writing reactions?
export const InitialP = protocol.designState('InitialP', () => null, {
  commands: {
    request: (_, params: { pickup: string; destination: string }) => [Requested.new(params)],
  },
  designReaction: (reactTo) => {
    reactTo([Requested, Bid, BidderID], (context, [requested, bid, bidderId]) => {
      const { pickup, destination } = requested
      return AuctionP.make({
        pickup,
        destination,
        bidData: {
          bidderID: bidderId.id,
          price: bid.price,
          time: bid.time,
        },
      })
    })
  },
})

export const AuctionP = protocol.designState(
  'AuctionP',
  ({ bidData, ...rest }: { pickup: string; destination: string; bidData: BidData }) => ({
    ...rest,
    bids: [bidData] as BidData[],
  }),
  {
    designReaction: (reactTo) => {
      reactTo([Bid, BidderID], ({ self }, [bid, bidderID]) => {
        self.bids.push({ ...bid, bidderID: bidderID.id })
        return null
      })
      reactTo([Selected, PassengerID], (self, [selected]) => {
        const { taxiID } = selected
        return RideP.make(taxiID)
      })
    },
    commands: {
      select: (context, bidderID: string) => {
        const bids = context.self.bids
        const matchingBid = bids.find((bid) => {
          return bid.bidderID === bidderID
        })

        // Note: might need something like this
        // Logic inside commands
        if (matchingBid) {
          return [Selected.new({ taxiID: matchingBid.bidderID }), PassengerID.new({ id: 'me' })]
        }

        return []
      },
    },
  },
)

export const RideP = protocol.designState('RideP', (taxiID: string) => ({ taxiID }), {
  designReaction: (reactTo) => {
    reactTo([Cancelled], () => InitialP.make())
  },
  commands: {
    cancel: () => [
      Cancelled.new({
        reason: "don't wanna",
      }),
    ],
  },
})

export const InitialT = protocol.designState(
  'InitialT',
  // PROPOSAL: a syntactic sugar to write (params: {id :string}) => params
  // TODO: choose to keep or trash
  (params: { id: string }) => params,
  {
    designReaction: (reactTo) => {
      reactTo([Requested], ({ self }, [{ pickup, destination }]) =>
        FirstBidT.make({
          id: self.id,
          pickup,
          destination,
        }),
      )
    },
    commands: {},
  },
)

export const FirstBidT = protocol.designState(
  'FirstBidT',
  // PROPOSAL: a syntactic sugar to write (params: {id :string}) => params
  // TODO: choose to keep or trash
  ProtocolDesigner.StateUtils.accepts<{ id: string; pickup: string; destination: string }>(),
  {
    designReaction: (reactTo) => {
      reactTo([Bid, BidderID], ({ self }) => AuctionT.make({ ...self }))
    },
    commands: {
      bid: (context, { time, price }: { time: Date; price: number }) => {
        return [Bid.new({ time, price }), BidderID.new({ id: context.self.id })]
      },
    },
  },
)

export const AuctionT = protocol.designState(
  'AuctionT',
  // PROPOSAL: a syntactic sugar to write (params: {id :string}) => params
  // TODO: choose to keep or trash
  ProtocolDesigner.StateUtils.accepts<{ id: string; pickup: string; destination: string }>(),
  {
    designReaction: (reactTo) => {
      reactTo([Bid, BidderID], ({ self }, [bid, bidderID]) => {
        if (bid.price === 14) throw new Error('Der Clown')
        return null
      })
      reactTo([Selected, PassengerID], ({ self }, [selected, passengerId]) => {
        return RideT.make({
          id: self.id,
          winner: selected.taxiID,
          passenger: passengerId.id,
        })
      })
    },
    commands: {
      bid: ({ self }, { time, price }: { time: Date; price: number }) => [
        Bid.new({ time, price }),
        BidderID.new({ id: self.id }),
      ],
    },
  },
)

export const RideT = protocol.designState(
  'RideT',
  // PROPOSAL: a syntactic sugar to write (params: {id :string}) => params
  // TODO: choose to keep or trash
  ProtocolDesigner.StateUtils.accepts<{ id: string; winner: string; passenger: string }>(),
  {
    designReaction: (reactTo) => {
      reactTo([Cancelled], ({ self }, []) => InitialT.make({ id: self.id }))
    },
    commands: {},
  },
)
