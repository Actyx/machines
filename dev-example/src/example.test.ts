import {
  createMockMachineRunner,
  createMockState,
  createMockStateOpaque,
} from '@actyx/machine-runner/test-utils'
import { BidData, Passenger, ProtocolEvents } from './machines/index.js'
import { toPrettyJSONString } from './UIMachineCommon.js'
import { isTaxiRideCancelEnabled } from './UIMachinePassenger.js'

describe('State transformation tests', () => {
  it('should verify if state transformation as written by the consumer code is correct', () => {
    const requestDestination = 'destination'
    const requestPickup = 'pickup'
    const bidTime = new Date()
    const bidPrice = 1
    const bidderId = 'bidderId'

    const machineRunner = createMockMachineRunner(Passenger.Initial, void 0)

    machineRunner.test.feed([
      ProtocolEvents.Requested.make({
        destination: requestDestination,
        pickup: requestPickup,
      }),
      ProtocolEvents.Bid.make({
        price: bidPrice,
        time: bidTime.toISOString(),
      }),
      ProtocolEvents.BidderID.make({
        id: bidderId,
      }),
    ])

    const auction1 = machineRunner.test.assertAs(Passenger.Auction, (auction) => {
      expect(auction.payload.bids.at(0)).toEqual({
        bidderID: bidderId,
        time: bidTime,
        price: bidPrice,
      } as BidData)

      return auction
    })

    // Alternative usage example of `assertAs`
    const auction2 = machineRunner.test.assertAs(Passenger.Auction)
    expect(auction2.payload.bids.at(0)).toEqual({
      bidderID: bidderId,
      time: bidTime,
      price: bidPrice,
    } as BidData)

    // Comparing arrays of objects that has a Date member is broken in jest. This doesn't work.
    // expect(auction.payload.bids)
    //  .toEqual([{
    //    time: new Date(bidTime.ToIsoString), ...otherfields
    //  }])
  })
})

describe('State mocking', () => {
  // This is useful to test functions and React components
  it('should support state-opaque mocking', () => {
    const stateOpaque = createMockStateOpaque(Passenger.Initial, void 0)
    const object: unknown = JSON.parse(toPrettyJSONString(stateOpaque))
    expect(object).toEqual({ type: 'Initial' })
  })

  it('should support state mocking', () => {
    const state = createMockState(Passenger.Ride, { taxiID: 'someTaxiID' })
    expect(isTaxiRideCancelEnabled(state)).toBe(true)
  })

  it('should support state mocking with command disablement', () => {
    const state = createMockState(Passenger.Ride, { taxiID: 'someTaxiID' }, { disableCommands: true })
    expect(isTaxiRideCancelEnabled(state)).toBe(false)
  })

  it('should support capturing events from commands', () => {
    const capturedEvents = [] as unknown[]
    const state = createMockState(Passenger.Ride, { taxiID: 'someTaxiID' }, { capturedEvents })
    state.commands()?.cancel()
    expect(capturedEvents).toEqual([ProtocolEvents.Cancelled.make({ reason: "don't wanna" })])
  })
})
