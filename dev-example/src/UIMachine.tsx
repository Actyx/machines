import { MachineRunner } from '@actyx/machine-runner'
import { useEffect, useState } from 'react'
import { AuctionP, AuctionT, FirstBidT, InitialP, InitialT, RideP, RideT } from './machines.js'
import { PrintState } from './UIMachineCommon.js'
import { UIAuctionP, UIInitialP, UIRideP } from './UIMachinePassenger.js'
import { UIAuctionT, UIFirstBidT, UIInitialT, UIRideT } from './UIMachineTaxi.js'

export const UIMachine = ({ machine, name }: { name: string; machine: MachineRunner }) => {
  const [state, setState] = useState(machine.get())

  useEffect(() => {
    const onChange = () => setState(machine.get())
    machine.events.on('change', onChange)
    return () => {
      machine.events.off('change', onChange)
    }
  }, [machine.id])

  if (state.is(AuctionP)) {
    const { bids } = state.payload
    // just to demonstrate that `state.is()` works

    // inside this block the type below will fail
    // state.cast(AuctionT)
    console.log(bids)
  }

  return (
    <div>
      {state && (
        <>
          <PrintState state={state} />
          {state.is(InitialP) && <UIInitialP state={state.cast()} />}
          {state.is(AuctionP) && <UIAuctionP state={state.cast()} />}
          {state.is(RideP) && <UIRideP state={state.cast()} />}
          {state.is(InitialT) && <UIInitialT state={state.cast()} />}
          {state.is(FirstBidT) && <UIFirstBidT state={state.cast()} />}
          {state.is(AuctionT) && <UIAuctionT state={state.cast()} />}
          {state.is(RideT) && <UIRideT state={state.cast()} />}
        </>
      )}
    </div>
  )
}
