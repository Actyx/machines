import { MachineRunner } from '@actyx/machine-runner/lib/api2.js'
import {
  StateContainer,
  StateContainerOpaque,
  StateFactory,
} from '@actyx/machine-runner/lib/api2/state-machine.js'
import { AgentReact } from '@actyx/machine-visual'
import { AuctionP, AuctionT, FirstBidT, InitialP, InitialT, RideP, RideT } from './machines.js'
import { UIAuctionP, UIInitialP, UIRideP } from './UIMachinePassenger.js'
import { UIAuctionT, UIFirstBidT, UIInitialT, UIRideT } from './UIMachineTaxi.js'

export const UIMachine = ({ machine: runner, name }: { name: string; machine: MachineRunner }) => {
  AgentReact.useBorrowed(runner)

  const machine = runner.api.get()

  return (
    MachineMatcher.init(machine)
      .matchThen(InitialP, (machine) => <UIInitialP machine={machine} />)
      .matchThen(AuctionP, (machine) => <UIAuctionP machine={machine} />)
      .matchThen(RideP, (machine) => <UIRideP machine={machine} />)
      .matchThen(InitialT, (machine) => <UIInitialT machine={machine} />)
      .matchThen(FirstBidT, (machine) => <UIFirstBidT machine={machine} />)
      .matchThen(AuctionT, (machine) => <UIAuctionT machine={machine} />)
      .matchThen(RideT, (machine) => <UIRideT machine={machine} />)
      .extract() || <h2>Unimplemented...</h2>
  )
}

export namespace MachineMatcher {
  export const init = <RetVal extends any = undefined>(
    machine: StateContainerOpaque,
    defaultRetval: RetVal = undefined as RetVal,
  ) => {
    const self = {
      matchThen: <
        Factory extends StateFactory.Any,
        Container extends StateContainer.Of<Factory>,
        NewRetVal extends any,
      >(
        factory: Factory,
        thenFn: (param: Container) => NewRetVal,
      ) => {
        const nextRetval =
          defaultRetval ||
          (() => {
            const downcasted = machine.as(factory)
            if (downcasted) {
              console.log('match with factory', factory.symbol())
              return thenFn(downcasted as Container)
            }
            return undefined
          })() ||
          undefined

        return init<RetVal | NewRetVal>(machine, nextRetval)
      },
      extract: () => defaultRetval,
    }
    return self
  }
}
