import {
  createMockMachineRunner,
  createMockState,
  createMockStateOpaque,
} from '@actyx/machine-runner/lib/test-utils'
import { Bid, BidData, BidderID, Cancelled, Passenger, Requested } from './machines/index.js'
import { toPrettyJSONString } from './UIMachineCommon.js'
import { isTaxiRideCancelEnabled } from './UIMachinePassenger.js'
import { Machine, MachineEvent } from '@actyx/machine-runner'
import { createEventCaptureArray } from '@actyx/machine-runner/lib/test-utils/mock-state-opaque.js'

describe('State transformation tests', () => {
  it('should verify if state transformation as written by the consumer code is correct', () => {
    const requestDestination = 'destination'
    const requestPickup = 'pickup'
    const bidTime = new Date()
    const bidPrice = 1
    const bidderId = 'bidderId'

    const machineRunner = createMockMachineRunner(Passenger.Initial, void 0)

    machineRunner.test.feed([
      Requested.make({
        destination: requestDestination,
        pickup: requestPickup,
      }),
      Bid.make({
        price: bidPrice,
        time: bidTime.toISOString(),
      }),
      BidderID.make({
        id: bidderId,
      }),
    ])

    machineRunner.test.assertAs(Passenger.Auction, (auction) => {
      expect(auction.payload.bids.at(0)).toEqual({
        bidderID: bidderId,
        time: bidTime,
        price: bidPrice,
      } as BidData)
    })

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
    const state = createMockState(
      Passenger.Ride,
      { taxiID: 'someTaxiID' },
      { disableCommands: true },
    )
    expect(isTaxiRideCancelEnabled(state)).toBe(false)
  })

  it('should support capturing events from commands', () => {
    const capturedEvents = createEventCaptureArray()
    const state = createMockState(Passenger.Ride, { taxiID: 'someTaxiID' }, { capturedEvents })
    state.commands?.cancel()
    expect(capturedEvents).toEqual([Cancelled.make({ reason: "don't wanna" })])
  })
})
