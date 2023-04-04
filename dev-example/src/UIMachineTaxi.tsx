import { State } from '@actyx/machine-runner'
import { useState } from 'react'
import { Taxi } from './machines/index.js'

export const UITaxiInitial = ({ state: state }: { state: State.Of<typeof Taxi.Initial> }) => {
  return <div>Waiting for passengers...</div>
}

export const UITaxiFirstBid = ({ state: state }: { state: State.Of<typeof Taxi.FirstBid> }) => {
  const [price, setPrice] = useState<number | null>(null)
  const buttonEnabled = state.commands !== undefined
  return (
    <div>
      <input
        type="text"
        value={String(price || '')}
        onChange={(e) => {
          const nextValue = e.target.value.trim()

          if (nextValue === '') {
            setPrice(null)
          }

          const asNumber = Number(nextValue)
          if (!Number.isNaN(asNumber)) {
            setPrice(Math.max(asNumber, 1))
          }
        }}
      ></input>
      <button
        type="button"
        disabled={!buttonEnabled}
        onClick={() => {
          if (price !== null) {
            state.commands?.bid({
              price: price,
              time: new Date(),
            })
          }
        }}
      >
        Bid
      </button>
    </div>
  )
}

export const UITaxiAuction = ({ state: state }: { state: State.Of<typeof Taxi.Auction> }) => {
  const [price, setPrice] = useState<number | null>(null)
  const buttonEnabled = state.commands !== undefined
  return (
    <div>
      <input
        type="text"
        value={String(price || '')}
        onChange={(e) => {
          const nextValue = e.target.value.trim()

          if (nextValue === '') {
            setPrice(null)
          }

          const asNumber = Number(nextValue)
          if (!Number.isNaN(asNumber)) {
            setPrice(Math.max(asNumber, 1))
          }
        }}
      ></input>
      <button
        type="button"
        disabled={!buttonEnabled}
        onClick={() => {
          if (price !== null) {
            state.commands?.bid({
              price: price,
              time: new Date(),
            })
          }
        }}
      >
        Bid
      </button>
    </div>
  )
}

export const UITaxiRide = ({ state: state }: { state: State.Of<typeof Taxi.Ride> }) => {
  return null
}
