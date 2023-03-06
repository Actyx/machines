import { Actyx } from '@actyx/sdk'
import { useEffect, useMemo, useState } from 'react'
import * as runnerAPI from '@actyx/machine-runner/lib/api2.js'
import { AuditMachines, ShowMachine } from '@actyx/machine-visual'
import { InitialP, InitialT, TaxiTag } from './machines.js'

export const AppImpl = ({ actyx }: { actyx: Actyx }) => {
  const [id, setId] = useState('1')

  const where = TaxiTag.withId(id)

  const common = {
    className: 'card',
    actyx,
    where,
  }
  const passengerMachine: runnerAPI.MachineRunner = useMemo(() => {
    return runnerAPI.createMachineRunner(actyx, where, InitialP.make())
  }, [actyx])

  const taxi1Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(
        actyx,
        where,
        InitialT.make({
          id: 'one',
        }),
      ),
    [actyx],
  )

  const taxi2Machine: runnerAPI.MachineRunner = useMemo(
    () =>
      runnerAPI.createMachineRunner(
        actyx,
        where,
        InitialT.make({
          id: 'two',
        }),
      ),
    [actyx],
  )

  return (
    <>
      <h1>Hello world!</h1>
      <input type="text" defaultValue={id} onChange={(e) => setId(e.target.value)} />
      <AuditMachines
        key={id}
        actyx={actyx}
        machines={[
          { name: 'passenger', where, initial: new InitialP() },
          { name: 'taxi1', where, initial: new InitialT('one') },
        ]}
      />
      <div style={{ display: 'flex' }}>
        <ShowMachine key={`p-${id}`} id="passenger" initial={new InitialP()} {...common} />
        <ShowMachine key={`t1-${id}`} id="taxi1" initial={new InitialT('one')} {...common} />
        <ShowMachine key={`t2-${id}`} id="taxi2" initial={new InitialT('two')} {...common} />
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

  if (actyx === undefined) return <h1>loading …</h1>
}
