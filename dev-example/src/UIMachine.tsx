import { MachineRunner } from '@actyx/machine-runner'
import { MachineEmitterEventMap } from '@actyx/machine-runner/lib/runner/runner-utils.js'
import { useEffect, useState } from 'react'
import { PrintState } from './UIMachineCommon.js'
import { UIPassengerAuction, UIPassengerInitial, UIPassengerRide } from './UIMachinePassenger.js'
import { UITaxiAuction, UITaxiFirstBid, UITaxiInitial, UITaxiRide } from './UIMachineTaxi.js'
import { Passenger, Taxi, protocol } from './machines/index.js'

type ThisMachineRunner = MachineRunner.Of<typeof protocol>
type EventMap = MachineRunner.EventMapOf<ThisMachineRunner>

export const UIMachine = ({
  machine,
  name,
}: {
  name: string
  machine: MachineRunner.Of<typeof protocol>
}) => {
  const [state, setState] = useState(machine.get())

  useEffect(() => {
    const onChange: EventMap['change'] = (state) => setState(state)
    machine.events.on('change', onChange)
    return () => {
      machine.events.off('change', onChange)
    }
  }, [machine.id])

  if (state && state.is(Passenger.Auction)) {
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
          {state.is(Passenger.Initial) && <UIPassengerInitial state={state.cast()} />}
          {state.is(Passenger.Auction) && <UIPassengerAuction state={state.cast()} />}
          {state.is(Passenger.Ride) && <UIPassengerRide state={state.cast()} />}
          {state.is(Taxi.Initial) && <UITaxiInitial state={state.cast()} />}
          {state.is(Taxi.FirstBid) && <UITaxiFirstBid state={state.cast()} />}
          {state.is(Taxi.Auction) && <UITaxiAuction state={state.cast()} />}
          {state.is(Taxi.Ride) && <UITaxiRide state={state.cast()} />}
        </>
      )}
    </div>
  )
}
