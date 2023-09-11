import { State } from '@actyx/machine-runner'
import { useState } from 'react'
import { Taxi } from './machines/index.js'

type UITaxiInitialProps = { state: State.Of<typeof Taxi.Initial> }

export const UITaxiInitial = ({ state }: UITaxiInitialProps) => {
  return <div>Waiting for passengers...</div>
}

type UITaxiFirstBidProps = { state: State.Of<typeof Taxi.FirstBid> }

export const UITaxiFirstBid = ({ state }: UITaxiFirstBidProps) => {
  const [price, setPrice] = useState<number | null>(null)
  const buttonEnabled = state!== undefined
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
            state.commands()?.bid({
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

type UITaxiAuctionProps = { state: State.Of<typeof Taxi.Auction> }

export const UITaxiAuction = ({ state }: UITaxiAuctionProps) => {
  const [price, setPrice] = useState<number | null>(null)
  const buttonEnabled = state.commands() !== undefined
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
            state.commands()?.bid({
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

type UITaxiRideProps = { state: State.Of<typeof Taxi.Ride> }

export const UITaxiRide = ({ state }: UITaxiRideProps) => {
  return null
}
