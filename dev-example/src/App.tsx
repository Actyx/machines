import { Actyx } from '@actyx/sdk'
import { useEffect, useState } from 'react'
import { AuditMachines, ShowMachine } from '@actyx/machine-visual'
import { InitialP, InitialT, TaxiTag } from './machines.js'

export function App() {
  const [actyx, setActyx] = useState<Actyx>()
  useEffect(() => {
    Actyx.of({
      appId: 'com.example.taxi-ride',
      displayName: 'Taxi Ride',
      version: '1.0.0',
    }).then(setActyx)
  }, [])

  const [id, setId] = useState('1')

  if (actyx === undefined) return <h1>loading …</h1>

  const where = TaxiTag.withId(id)
  const common = {
    className: 'card',
    actyx,
    where,
  }

  return (
    <>
      <h1>Hello world!</h1>
      <input type="text" defaultValue={id} onChange={(e) => setId(e.target.value)} />
      <AuditMachines
        key={id}
        actyx={actyx}
        machines={[
          { where, initial: new InitialP() },
          { where, initial: new InitialT('one') },
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
