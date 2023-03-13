import { MachineRunner } from '@actyx/machine-runner/lib/api2.js'
import { useEffect, useState } from 'react'
import { AuctionP, AuctionT, FirstBidT, InitialP, InitialT, RideP, RideT } from './machines.js'
import { PrintState } from './UIMachineCommon.js'
import { UIAuctionP, UIInitialP, UIRideP } from './UIMachinePassenger.js'
import { UIAuctionT, UIFirstBidT, UIInitialT, UIRideT } from './UIMachineTaxi.js'

export const UIMachine = ({ machine, name }: { name: string; machine: MachineRunner }) => {
  const [stateSnapshot, setStateSnapshot] = useState(machine.get())

  useEffect(() => {
    let active = true

    ;(async () => {
      for await (const snapshot of machine) {
        if (!active) {
          break
        }
        setStateSnapshot(snapshot)
      }
    })()

    return () => {
      active = false
    }
  }, [machine.id])

  return (
    <div>
      <PrintState snapshot={stateSnapshot} />
      {match(stateSnapshot.as(InitialP), (machine) => (
        <UIInitialP state={machine} />
      ))}
      {match(stateSnapshot.as(AuctionP), (machine) => (
        <UIAuctionP state={machine} />
      ))}
      {match(stateSnapshot.as(RideP), (machine) => (
        <UIRideP state={machine} />
      ))}
      {match(stateSnapshot.as(InitialT), (machine) => (
        <UIInitialT state={machine} />
      ))}
      {match(stateSnapshot.as(FirstBidT), (machine) => (
        <UIFirstBidT state={machine} />
      ))}
      {match(stateSnapshot.as(AuctionT), (machine) => (
        <UIAuctionT state={machine} />
      ))}
      {match(stateSnapshot.as(RideT), (machine) => (
        <UIRideT state={machine} />
      ))}
    </div>
  )
}

export const match: <Val, RetVal>(
  initVal: Val | undefined | null | void,
  fn: (val: Val) => RetVal,
) => RetVal | undefined = (val, fn) => {
  if (val) {
    return fn(val)
  }
  return undefined
}
