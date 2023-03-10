import { MachineRunner } from '@actyx/machine-runner/lib/api2.js'
import { AgentReact } from '@actyx/machine-visual'
import { AuctionP, AuctionT, FirstBidT, InitialP, InitialT, RideP, RideT } from './machines.js'
import { UIAuctionP, UIInitialP, UIRideP } from './UIMachinePassenger.js'
import { UIAuctionT, UIFirstBidT, UIInitialT, UIRideT } from './UIMachineTaxi.js'

export const UIMachine = ({ machine: runner, name }: { name: string; machine: MachineRunner }) => {
  AgentReact.useBorrowed(runner)

  const machine = runner.api.get()

  return (
    <>
      {match(machine.as(InitialP), (machine) => (
        <UIInitialP machine={machine} />
      ))}
      {match(machine.as(AuctionP), (machine) => (
        <UIAuctionP machine={machine} />
      ))}
      {match(machine.as(RideP), (machine) => (
        <UIRideP machine={machine} />
      ))}
      {match(machine.as(InitialT), (machine) => (
        <UIInitialT machine={machine} />
      ))}
      {match(machine.as(FirstBidT), (machine) => (
        <UIFirstBidT machine={machine} />
      ))}
      {match(machine.as(AuctionT), (machine) => (
        <UIAuctionT machine={machine} />
      ))}
      {match(machine.as(RideT), (machine) => (
        <UIRideT machine={machine} />
      ))}
    </>
  )
}

export const match: <Val, RetVal>(
  initVal: Val | undefined | null,
  fn: (val: Val) => RetVal,
) => RetVal | undefined = (val, fn) => {
  if (val) {
    return fn(val)
  }
  return undefined
}
