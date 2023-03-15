import { StateSnapshot } from '@actyx/machine-runner'
import { useState } from 'react'
import { AuctionT, FirstBidT, InitialT, RideT } from './machines.js'

export const UIInitialT = ({ state: machine }: { state: StateSnapshot.Of<typeof InitialT> }) => {
  return <div>Waiting for passengers...</div>
}

export const UIFirstBidT = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof FirstBidT> }) => {
  const [price, setPrice] = useState<number | null>(null)
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
        onClick={() => {
          if (price !== null) {
            snapshot.commands.bid({
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

export const UIAuctionT = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof AuctionT> }) => {
  const [price, setPrice] = useState<number | null>(null)
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
        onClick={() => {
          if (price !== null) {
            snapshot.commands.bid({
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

export const UIRideT = ({ snapshot }: { snapshot: StateSnapshot.Of<typeof RideT> }) => {
  return null
}
