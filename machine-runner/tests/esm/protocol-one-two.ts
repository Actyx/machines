import { MachineEvent, SwarmProtocol } from '../../lib/esm/index.js'

export namespace Events {
  export const One = MachineEvent.design('One').withPayload<{ x: number }>()
  export const Two = MachineEvent.design('Two').withPayload<{ y: number }>()
  export const all = [One, Two] as const
}

// Event definitions

// Machine and States

const protocol = SwarmProtocol.make('TestSwarm', Events.all)

const machine = protocol.makeMachine('TestMachine')

export const XCommandParam = [true, 1, '', { specificField: 'literal-a' }, Symbol()] as const
export const XEmittedEvents = [Events.One.make({ x: 42 })] as const
export const Initial = machine
  .designState('Initial')
  .withPayload<{ transitioned: boolean }>()
  .command(
    'X',
    [Events.One],
    // Types below are used for type tests
    (
      context,
      _supposedBoolean: boolean,
      _supposedNumber: number,
      _supposedString: string,
      _supposedObject: { specificField: 'literal-a' },
      _supposedSymbol: symbol,
    ) => [...XEmittedEvents],
  )
  .finish()

export const YEmittedEvents = [Events.Two.make({ y: 2 })] as const
export const Second = machine
  .designState('Second')
  .withPayload<{ x: number; y: number }>()
  .command('Y', [Events.Two], () => [...YEmittedEvents])
  .finish()

// Reactions

Initial.react([Events.One, Events.Two], Second, (c, one, two) => {
  c.self.transitioned = true
  return Second.make({
    x: one.payload.x,
    y: two.payload.y,
  })
})
