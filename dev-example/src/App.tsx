import { Actyx } from '@actyx/sdk'
import { useEffect, useMemo, useState } from 'react'
import * as runnerAPI from '@actyx/machine-runner/lib/api2.js'
import { AuditMachines } from '@actyx/machine-visual'
import { InitialP, InitialT, TaxiTag } from './machines.js'

import { UIMachine } from './UIMachine.js'
import { deepCopy } from '@actyx/machine-runner/lib/runner.js'

export const AppImpl = ({ actyx }: { actyx: Actyx }) => {
  const [id, setId] = useState('1')

  const where = TaxiTag.withId(id)

  const passengerMachine: runnerAPI.MachineRunner = useMemo(() => {
    return runnerAPI.createMachineRunner(actyx, where, InitialP, void 0)
  }, [actyx, id])

  useEffect(() => {
    const unsubPrevstate = passengerMachine.channels.debug.eventHandlingPrevState.sub((prevstate) =>
      console.log('PassengerMachine prevstate', deepCopy(prevstate)),
    )

    const unsubDebug = passengerMachine.channels.debug.eventHandling.sub(
      ({ event, factory, handlingReport, mechanism, nextState }) => {
        console.log('PassengerMachine event handling', handlingReport.handling, {
          event,
          factory,
          handlingReport,
          mechanism,
          nextState: deepCopy(nextState),
        })
      },
    )

    const unsubCaughtUp = passengerMachine.channels.debug.caughtUp.sub(() => {
      console.log('PassengerMachine state after caughtUp', deepCopy(passengerMachine.get()))
    })

    const unsubAuditState = passengerMachine.channels.audit.state.sub((x) => {
      console.log('PassengerMachine state change to ', deepCopy(x.state))
    })

    return () => {
      console.log('called')
      unsubCaughtUp()
      unsubPrevstate()
      unsubDebug()
      unsubAuditState()
      passengerMachine.destroy()
    }
  }, [passengerMachine])

  const taxi1Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(actyx, where, InitialT, {
        id: 'one',
      }),
    [actyx, id],
  )

  useEffect(() => {
    const unsubPrevstate = taxi1Machine.channels.debug.eventHandlingPrevState.sub((prevstate) =>
      console.log('taxi1Machine1 prevstate', deepCopy(prevstate)),
    )

    const unsubDebug = taxi1Machine.channels.debug.eventHandling.sub(
      ({ event, factory, handlingReport, mechanism, nextState }) => {
        console.log('taxi1Machine1 event handling', handlingReport.handling, {
          event,
          factory,
          handlingReport,
          mechanism,
          nextState: deepCopy(nextState),
        })
      },
    )

    const unsubCaughtUp = taxi1Machine.channels.debug.caughtUp.sub(() => {
      console.log('taxi1Machine1 state after caughtUp', deepCopy(passengerMachine.get()))
    })

    const unsubAuditState = taxi1Machine.channels.audit.state.sub((x) => {
      console.log('taxi1Machine1 state change to ', deepCopy(x.state))
    })

    return () => {
      unsubCaughtUp()
      unsubPrevstate()
      unsubDebug()
      unsubAuditState()
      taxi1Machine.destroy()
    }
  }, [taxi1Machine])

  const taxi2Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(actyx, where, InitialT, {
        id: 'two',
      }),
    [actyx, id],
  )

  useEffect(() => {
    const unsubPrevstate = taxi2Machine.channels.debug.eventHandlingPrevState.sub((prevstate) =>
      console.log('taxi2Machine prevstate', deepCopy(prevstate)),
    )

    const unsubDebug = taxi2Machine.channels.debug.eventHandling.sub(
      ({ event, factory, handlingReport, mechanism, nextState }) => {
        console.log('taxi2Machine event handling', handlingReport.handling, {
          event,
          factory,
          handlingReport,
          mechanism,
          nextState: deepCopy(nextState),
        })
      },
    )

    const unsubCaughtUp = taxi2Machine.channels.debug.caughtUp.sub(() => {
      console.log('taxi2Machine state after caughtUp', deepCopy(passengerMachine.get()))
    })

    const unsubAuditState = taxi2Machine.channels.audit.state.sub((x) => {
      console.log('taxi2Machine state change to ', deepCopy(x.state))
    })
    return () => {
      unsubCaughtUp()
      unsubPrevstate()
      unsubDebug()
      unsubAuditState()
      taxi2Machine.destroy()
    }
  }, [taxi2Machine])

  return (
    <>
      <h1>Hello world!</h1>
      <input type="text" defaultValue={id} onChange={(e) => setId(e.target.value)} />
      <AuditMachines
        key={id}
        actyx={actyx}
        machines={[
          { name: 'passenger', machine: passengerMachine },
          { name: 'taxi1', machine: taxi1Machine },
          { name: 'taxi2', machine: taxi2Machine },
        ]}
      />
      <div style={{ display: 'flex' }}>
        <UIMachine name="passenger" machine={passengerMachine} />
        <UIMachine name="passenger" machine={taxi1Machine} />
        <UIMachine name="passenger" machine={taxi2Machine} />
      </div>
    </>
  )
}

export function App() {
  const [actyx, setActyx] = useState<Actyx>()
  useEffect(() => {
    Actyx.of({
      appId: 'com.example.taxi-ride',
      displayName: 'Taxi Ride',
      version: '1.0.0',
    }).then(setActyx)
  }, [])

  return (
    <>
      {actyx && <AppImpl actyx={actyx} />}
      {!actyx && <h1>loading …</h1>}
    </>
  )
}
