import { State } from '@actyx/machine-runner'
import { useState } from 'react'
import { BidData, Passenger } from './machines/index.js'

export const UIPassengerInitial = ({
  state: state,
}: {
  state: State.Of<typeof Passenger.Initial>
}) => {
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const buttonEnabled =
    pickup.trim().length > 0 && destination.trim().length > 0 && state.commands !== undefined
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

export const UIPassengerAuction = ({
  state: state,
}: {
  state: State.Of<typeof Passenger.Auction>
}) => {
  const [selection, setSelection] = useState<BidData | null>(state.payload.bids[0] || null)
  const buttonEnabled = selection !== null && state.commands !== undefined

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

export const UIPassengerRide = ({ state: state }: { state: State.Of<typeof Passenger.Ride> }) => {
  const buttonEnabled = state.commands !== undefined
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
