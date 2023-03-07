import { Actyx } from '@actyx/sdk'
import { useEffect, useMemo, useState } from 'react'
import * as runnerAPI from '@actyx/machine-runner/lib/api2.js'
import { AuditMachines } from '@actyx/machine-visual'
import { InitialP, InitialT, TaxiTag } from './machines.js'

import { UIMachine } from './UIMachine.js'

export const AppImpl = ({ actyx }: { actyx: Actyx }) => {
  const [id, setId] = useState('1')

  const where = TaxiTag.withId(id)

  const passengerMachine: runnerAPI.MachineRunner = useMemo(() => {
    return runnerAPI.createMachineRunner(actyx, where, InitialP.make())
  }, [actyx, id])

  useEffect(() => {
    return () => {
      passengerMachine.destroy()
    }
  }, [passengerMachine])

  const taxi1Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(
        actyx,
        where,
        InitialT.make({
          id: 'one',
        }),
      ),
    [actyx, id],
  )

  useEffect(() => {
    return () => {
      taxi1Machine.destroy()
    }
  }, [taxi1Machine])

  const taxi2Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(
        actyx,
        where,
        InitialT.make({
          id: 'two',
        }),
      ),
    [actyx, id],
  )

  useEffect(() => {
    return () => {
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
