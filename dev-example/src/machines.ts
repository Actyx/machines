import { Tag } from '@actyx/sdk'
import { State } from '@actyx/machine-runner'
import { proto } from './proto.js'

/**
 * Actyx pub-sub is based on topics selected by tagging (which supports
 * boolean operators to perform event set union and intersection).
 *
 * The taxi ride machines use events tagged with `taxi`.
 */
export const TaxiTag = Tag<Events>('taxi')

type BidData = {
  price: number
  time: Date
  bidderID: string
}

// Events

type Requested = {
  type: 'Requested'
  pickup: string
  destination: string
}

type Bid = {
  type: 'Bid'
  price: number
  time: Date
}

type BidderID = {
  type: 'BidderID'
  id: string
}

type Selected = {
  type: 'Selected'
  taxiID: string
}

type PassengerID = {
  type: 'PassengerID'
  id: string
}

type Arrived = {
  type: 'Arrived'
  taxiID: string
}

type Started = {
  type: 'Started'
}

type Path = {
  type: 'Path'
  lat: number
  lon: number
}

type Finished = {
  type: 'Finished'
}

type Cancelled = {
  type: 'Cancelled'
  reason: string
}

type Receipt = {
  type: 'Receipt'
  amount: number
}

type Events =
  | Requested
  | Bid
  | BidderID
  | Selected
  | PassengerID
  | Arrived
  | Started
  | Path
  | Finished
  | Cancelled
  | Receipt

// States

/**
 * Initial state for role P
 */
@proto('taxiRide')
export class InitialP extends State<Events> {
  execRequest(arg: { pickup: string; destination: string }) {
    const { pickup, destination } = arg
    return this.events({ type: 'Requested', pickup, destination })
  }
  onRequested(ev: Requested, ev1: Bid, ev2: BidderID) {
    return new AuctionP(ev.pickup, ev.destination, {
      price: ev1.price,
      time: ev1.time,
      bidderID: ev2.id,
    })
  }
}

@proto('taxiRide')
export class AuctionP extends State<Events> {
  private bids: BidData[]
  constructor(public pickup: string, public destination: string, bid: BidData) {
    super()
    this.bids = [bid]
  }
  execSelect() {
    return this.events(
      { type: 'Selected', taxiID: this.bids[this.bids.length - 1].bidderID },
      { type: 'PassengerID', id: 'me' },
    )
  }
  onBid(ev1: Bid, ev2: BidderID) {
    this.bids.push({ price: ev1.price, time: ev1.time, bidderID: ev2.id })
    return this
  }
  onSelected(ev: Selected, id: PassengerID) {
    return new RideP(ev.taxiID)
  }
}

@proto('taxiRide')
export class RideP extends State<Events> {
  constructor(public bidder: string) {
    super()
  }
  execCancel() {
    return this.events({ type: 'Cancelled', reason: 'don’t wanna' })
  }
  onCancelled(ev: Cancelled) {
    return new InitialP()
  }
}

/**
 * Initial state for role T
 */
@proto('taxiRide')
export class InitialT extends State<Events> {
  constructor(public id: string) {
    super()
  }
  onRequested(ev: Requested) {
    return new FirstBidT(this.id, ev.pickup, ev.destination)
  }
}

@proto('taxiRide')
export class FirstBidT extends State<Events> {
  constructor(public id: string, public pickup: string, public dest: string) {
    super()
  }
  execBid(time: Date, price: number) {
    return this.events({ type: 'Bid', time, price }, { type: 'BidderID', id: this.id })
  }
  onBid(bid: Bid, id: BidderID) {
    return new AuctionT(this.id, this.pickup, this.dest)
  }
}

@proto('taxiRide')
export class AuctionT extends State<Events> {
  constructor(public id: string, public pickup: string, public destination: string) {
    super()
  }
  execBid(time: Date, price: number) {
    return this.events({ type: 'Bid', time, price }, { type: 'BidderID', id: this.id })
  }
  onBid(bid: Bid, id: BidderID) {
    return this
  }
  onSelected(ev1: Selected, ev2: PassengerID) {
    return new RideT(this.id, ev1.taxiID, ev2.id)
  }
}

@proto('taxiRide')
export class RideT extends State<Events> {
  constructor(public id: string, public winner: string, public passenger: string) {
    super()
  }
  onCancelled(ev: Cancelled) {
    return new InitialT(this.id)
  }
}
