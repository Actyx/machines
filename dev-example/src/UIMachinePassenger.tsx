import { State } from '@actyx/machine-runner'
import { useState } from 'react'
import { AuctionP, BidData, InitialP, RideP } from './machines.js'

export const UIInitialP = ({ state: state }: { state: State.Of<typeof InitialP> }) => {
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const buttonEnabled = !!pickup.trim() && !!destination.trim() && !!state.commands
  return (
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
          state.commands?.request({
            pickup,
            destination,
          })
        }
      >
        Send Request
      </button>
    </div>
  )
}

export const UIAuctionP = ({ state: state }: { state: State.Of<typeof AuctionP> }) => {
  const [selection, setSelection] = useState<BidData | null>(state.payload.bids[0] || null)
  const buttonEnabled = selection !== null && !!state.commands

  return (
    <div>
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
        disabled={!buttonEnabled}
        onClick={() => {
          if (selection !== null) {
            state.commands?.select(selection.bidderID)
          }
        }}
      >
        Select
      </button>
    </div>
  )
}

export const UIRideP = ({ state: state }: { state: State.Of<typeof RideP> }) => {
  const buttonEnabled = !!state.commands
  return (
    <div>
      <button
        disabled={!buttonEnabled}
        onClick={() => {
          state.commands?.cancel()
        }}
      >
        Cancel Ride
      </button>
    </div>
  )
}
