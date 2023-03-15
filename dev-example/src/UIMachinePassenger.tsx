import { StateSnapshot } from '@actyx/machine-runner'
import { useState } from 'react'
import { AuctionP, BidData, InitialP, RideP } from './machines.js'

export const UIInitialP = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof InitialP> }) => {
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const buttonEnabled = !!pickup.trim() && !!destination.trim()
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
          snapshot.commands.request({
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

export const UIAuctionP = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof AuctionP> }) => {
  const [selection, setSelection] = useState<BidData | null>(snapshot.payload.bids[0] || null)

  return (
    <div>
      <select
        onChange={(e) => {
          const selectedBidderId = e.target.value
          const matchingBidder = snapshot.payload.bids.find(
            (bid) => bid.bidderID === selectedBidderId,
          )

          setSelection(matchingBidder || null)
        }}
      >
        {selection === null && <option>No taxis available</option>}
        {snapshot.payload.bids.map((bid) => {
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
            snapshot.commands.select(selection.bidderID)
          }
        }}
      >
        Select
      </button>
    </div>
  )
}

export const UIRideP = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof RideP> }) => {
  return (
    <div>
      <button
        onClick={() => {
          snapshot.commands.cancel()
        }}
      >
        Cancel Ride
      </button>
    </div>
  )
}
