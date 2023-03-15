import { MachineRunner } from '@actyx/machine-runner'
import { useEffect, useState } from 'react'
import { AuctionP, AuctionT, FirstBidT, InitialP, InitialT, RideP, RideT } from './machines.js'
import { PrintState } from './UIMachineCommon.js'
import { UIAuctionP, UIInitialP, UIRideP } from './UIMachinePassenger.js'
import { UIAuctionT, UIFirstBidT, UIInitialT, UIRideT } from './UIMachineTaxi.js'

export const UIMachine = ({ machine, name }: { name: string; machine: MachineRunner }) => {
  const [state, setState] = useState(machine.get())

  useEffect(() => {
    let active = true

    ;(async () => {
      for await (const state of machine) {
        if (!active) {
          break
        }
        setState(state)
      }
    })()

    return () => {
      active = false
    }
  }, [machine.id])

  return (
    <div>
      <PrintState state={state} />
      {state.as(InitialP, (state) => (
        <UIInitialP state={state} />
      ))}
      {state.as(AuctionP, (state) => (
        <UIAuctionP state={state} />
      ))}
      {state.as(RideP, (state) => (
        <UIRideP state={state} />
      ))}
      {state.as(InitialT, (state) => (
        <UIInitialT state={state} />
      ))}
      {state.as(FirstBidT, (state) => (
        <UIFirstBidT state={state} />
      ))}
      {state.as(AuctionT, (state) => (
        <UIAuctionT state={state} />
      ))}
      {state.as(RideT, (state) => (
        <UIRideT state={state} />
      ))}
    </div>
  )
}
