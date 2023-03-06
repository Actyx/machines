import { DeepReadonly, NonZeroTuple } from '../api2utils/type-utils.js'
import {
  CommandDefiner,
  PayloadConstructor,
  StateFactory,
  StateMechanism,
  StateMechanismMap,
  Event,
} from './state-machine.js'

export type Protocol<Mechanism extends StateMechanismMap<{}>> = {
  states: DeepReadonly<Mechanism>
}

// TODO: alternative protocol designer with builder pattern
export type ProtocolDesigner<AllowedEvents extends Event.Factory.NonZeroTuple> = {
  designState: <
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends {
      [key: string]: CommandDefiner<any, NonZeroTuple<Event.Factory.ReduceToEvent<AllowedEvents>>>
    },
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
  export type EventsOf<T extends ProtocolDesigner<any>> = T extends ProtocolDesigner<
    infer AllowedEvents
  >
    ? Event.Factory.MapToPayload<AllowedEvents>
    : never

  export namespace StateUtils {
    export type Accepts<T extends {}> = (t: T) => T
    export const accepts =
      <T extends {}>(): Accepts<T> =>
      (t: T) =>
        t
  }

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
