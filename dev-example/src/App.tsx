import { createMachineRunner, MachineRunner, utils } from '@actyx/machine-runner'
import { AuditMachines } from '@actyx/machine-visual'
import { Actyx } from '@actyx/sdk'
import { useEffect, useMemo, useState } from 'react'

import { UIMachine } from './UIMachine.js'
import { protocol } from './machines/protocol.js'
import { Passenger, Taxi } from './machines/index.js'

export const AppImpl = ({ actyx }: { actyx: Actyx }) => {
  const [id, setId] = useState('1')

  const where = protocol.tags

  const passengerMachine = useMachine(
    () => createMachineRunner(actyx, where, Passenger.Initial, void 0),
    [actyx, id],
  )

  const taxi1Machine: MachineRunner = useMachine(
    () =>
      createMachineRunner(actyx, where, Taxi.Initial, {
        id: 'one',
      }),
    [actyx, id],
  )

  const taxi2Machine: MachineRunner = useMachine(
    () =>
      createMachineRunner(actyx, where, Taxi.Initial, {
        id: 'two',
      }),
    [actyx, id],
  )

  useMachineDebug(passengerMachine, 'passengerMachine')
  useMachineDebug(taxi1Machine, 'taxi1Machine')
  useMachineDebug(taxi2Machine, 'taxi2Machine')

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

export const useMachineDebug = (machine: MachineRunner, label: string) => {
  useEffect(() => {
    const onPrevState: MachineRunner.EventListener<'debug.eventHandlingPrevState'> = (prevstate) =>
      console.log(label, 'prevstate', utils.deepCopy(prevstate))

    const onDebug: MachineRunner.EventListener<'debug.eventHandling'> = ({
      event,
      factory,
      handlingReport,
      mechanism,
      nextState,
    }) =>
      console.log(label, 'event handling', {
        event,
        factory,
        handlingReport,
        mechanism,
        nextState: utils.deepCopy(nextState),
      })

    const onChange: MachineRunner.EventListener<'change'> = () =>
      console.log(label, 'state after caughtUp', utils.deepCopy(machine.get()))

    const onAuditState: MachineRunner.EventListener<'audit.state'> = (x) =>
      console.log(label, 'state change to ', utils.deepCopy(x.state))

    const onLog: MachineRunner.EventListener<'log'> = (x) => console.log(label, `log`, x)

    machine.events.on('debug.eventHandlingPrevState', onPrevState)
    machine.events.on('debug.eventHandling', onDebug)
    machine.events.on('change', onChange)
    machine.events.on('audit.state', onAuditState)
    machine.events.on('log', onLog)

    return () => {
      machine.events.off('debug.eventHandlingPrevState', onPrevState)
      machine.events.off('debug.eventHandling', onDebug)
      machine.events.off('change', onChange)
      machine.events.off('audit.state', onAuditState)
      machine.events.off('log', onLog)
    }
  }, [machine])
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

  return actyx ? <AppImpl actyx={actyx} /> : <h1>loading …</h1>
}

export const useMachine = (factoryFn: () => MachineRunner, deps: unknown[]) => {
  const memoized = useMemo(factoryFn, deps)
  useEffect(() => {
    return () => {
      memoized.destroy()
    }
  }, [memoized])
  return memoized
}
