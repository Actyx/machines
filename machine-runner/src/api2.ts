import {
  StateMechanismMap,
  StateMechanism,
  Event,
  PayloadConstructor,
  StateFactory,
  CommandDefiner,
} from './api2.internals.js'
import type { DeepReadonly } from './api2.utils.js'

export type Protocol<Mechanism extends StateMechanismMap<{}>> = {
  states: DeepReadonly<Mechanism>
}

export type ProtocolDesigner<AllowedEvents extends Event.Factory.NonZeroTuple> = {
  designState: <
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends { [key: string]: CommandDefiner<any, any> },
  >(
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
    props: {
      commands: Commands
      designReaction: (
        addReaction: StateMechanism<
          AllowedEvents,
          StateName,
          StateArgs,
          StatePayload,
          {}
        >['reactTo'],
      ) => unknown
    },
  ) => StateFactory<AllowedEvents, StateName, StateArgs, StatePayload, Commands>
}

export namespace ProtocolDesigner {
  export const init = <RegisteredEventFactories extends Event.Factory.NonZeroTuple>(
    _: RegisteredEventFactories,
  ) => makeProtocolDesigner<RegisteredEventFactories>()

  const makeProtocolDesigner = <
    AllowedEvents extends Event.Factory.NonZeroTuple,
  >(): ProtocolDesigner<AllowedEvents> => {
    const designState: ProtocolDesigner<AllowedEvents>['designState'] = (
      stateName,
      constructor,
      props,
    ) => {
      const stateMech = StateMechanism.make(stateName, constructor, {})
      props.designReaction(stateMech.reactTo)
      return stateMech.patchCommands(props.commands).build()
    }
    return {
      designState,
    }
  }
}

const Toggle = Event.design('Toggle').withPayload<{ c: 1 }>()

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
    toggle: (context) => {
      // Add system calls to machine runner here
      context.someSystemCall()
      // Not complete yet
    },
    anotherCommand: (context, x: number) => {},
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
