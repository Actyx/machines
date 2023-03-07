import { StateContainer } from '@actyx/machine-runner/lib/api2/state-machine.js'
import { useState } from 'react'
import { AuctionT, FirstBidT, InitialT, RideT } from './machines.js'
import { PrintState } from './UIMachineCommon.js'

export const UIInitialT = ({ machine }: { machine: StateContainer.Of<typeof InitialT> }) => {
  return (
    <div>
      <PrintState state={machine.get()} />
      <div>Waiting for passengers...</div>
    </div>
  )
}

export const UIFirstBidT = ({ machine }: { machine: StateContainer.Of<typeof FirstBidT> }) => {
  const [price, setPrice] = useState<number | null>(null)
  return (
    <div>
      <PrintState state={machine.get()} />
      <div>
        <input
          type="text"
          value={String(price)}
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
              machine.commands.bid({
                price: price,
                time: new Date(),
              })
            }
          }}
        >
          Bid
        </button>
      </div>
    </div>
  )
}

export const UIAuctionT = ({ machine }: { machine: StateContainer.Of<typeof AuctionT> }) => {
  const [price, setPrice] = useState<number | null>(null)
  return (
    <div>
      <PrintState state={machine.get()} />
      <div>
        <input
          type="text"
          value={String(price)}
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
              machine.commands.bid({
                price: price,
                time: new Date(),
              })
            }
          }}
        >
          Bid
        </button>
      </div>
    </div>
  )
}

export const UIRideT = ({ machine }: { machine: StateContainer.Of<typeof RideT> }) => {
  return (
    <div>
      <PrintState state={machine.get()} />
    </div>
  )
}
