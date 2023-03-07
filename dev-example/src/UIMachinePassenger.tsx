import { StateContainer } from '@actyx/machine-runner/lib/api2/state-machine.js'
import { useState } from 'react'
import { AuctionP, BidData, InitialP, RideP } from './machines.js'
import { PrintState } from './UIMachineCommon.js'

export const UIInitialP = ({ machine }: { machine: StateContainer.Of<typeof InitialP> }) => {
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const buttonEnabled = !!pickup.trim() && !!destination.trim()
  console.log('UIInitialP')
  return (
    <div>
      <PrintState state={machine.get()} />
      <div>
        <label>
          Pickup
          <input type="text" value={pickup} onChange={(e) => setPickup(e.target.value)}></input>
        </label>
        <label>
          Destination
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          ></input>
        </label>
        <button
          type="button"
          disabled={!buttonEnabled}
          onClick={() =>
            machine.commands.request({
              pickup,
              destination,
            })
          }
        >
          Send Request
        </button>
      </div>
    </div>
  )
}

export const UIAuctionP = ({ machine }: { machine: StateContainer.Of<typeof AuctionP> }) => {
  const state = machine.get()
  const [selection, setSelection] = useState<BidData | null>(state.payload.bids[0] || null)
  console.log('UIAuctionP')

  return (
    <div>
      <PrintState state={machine.get()} />
      <select
        onChange={(e) => {
          const selectedBidderId = e.target.value
          const matchingBidder = state.payload.bids.find((bid) => bid.bidderID === selectedBidderId)

          setSelection(matchingBidder || null)
        }}
      >
        {selection === null && <option>No taxis available</option>}
        {state.payload.bids.map((bid) => {
          return (
            <option key={bid.bidderID} value={bid.bidderID}>
              {bid.bidderID}/{bid.price} at {bid.time.toISOString()}
            </option>
          )
        })}
      </select>
      <button
        disabled={selection === null}
        onClick={() => {
          if (selection !== null) {
            machine.commands.select(selection.bidderID)
          }
        }}
      >
        Select
      </button>
    </div>
  )
}

export const UIRideP = ({ machine }: { machine: StateContainer.Of<typeof RideP> }) => {
  return (
    <div>
      <PrintState state={machine.get()} />
      <button
        onClick={() => {
          machine.commands.cancel()
        }}
      >
        Cancel Ride
      </button>
    </div>
  )
}
