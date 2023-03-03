import { ProtocolDesigner } from './api2/protocol-designer.js'
import { Event } from './api2/state-machine.js'
export * from './api2utils/agent.js'

// Example Implementation

const Toggle = Event.design('Toggle').withPayload<{ c: 1 }>()
const False = Event.design('False').withPayload<{ c: 1 }>()

const protocol = ProtocolDesigner.init([Toggle])

const Open = protocol.designState(
  'Open',
  (x: number) => {
    return {
      x: String(x),
    }
  },
  {
    designReaction: (reactTo) => {
      reactTo([Toggle], (self, [toggle]) => {
        console.log(toggle)
        return Close.make()
      })
    },
    commands: {
      toggle: (context) => {
        // Add system calls to machine runner here
        context.someSystemCall()
        // Not complete yet
        return [
          Toggle.new({
            c: 1,
          }),
        ]
      },
    },
  },
)

const Close = protocol.designState('Close', () => null, {
  designReaction: (reactTo) => {
    reactTo([Toggle], (self, [toggle]) => {
      console.log(toggle)
      return Close.make()
    })
  },
  commands: {
    toggle: (_context) => [
      Toggle.new({
        c: 1,
      }),
    ],

    anotherCommand: (context, x: number) => {
      // TODO: consider API for system call?
      context.someSystemCall()
      return [
        Toggle.new({
          c: 1,
        }),
      ]
    },
  },
})

const opaqueState = Open.make(1)
// processes
const stateOnOpen = opaqueState.as(Open)
if (stateOnOpen) {
  stateOnOpen.commands.toggle()
}

const stateOnClose = opaqueState.as(Close)
if (stateOnClose) {
  stateOnClose.commands.toggle()
  stateOnClose.commands.anotherCommand(1)
}

type EventOfProtocol<T> = T extends ProtocolDesigner<infer X> ? X : never
type ProtocolEvents = EventOfProtocol<typeof protocol>
