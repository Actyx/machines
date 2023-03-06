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
export type ProtocolDesigner<EventFactoriesTuple extends Event.Factory.NonZeroTuple> = {
  designState: <
    StateName extends string,
    StateArgs extends any[],
    StatePayload extends any,
    Commands extends {
      [key: string]: CommandDefiner<
        StatePayload,
        any,
        Event.Factory.ReduceToEvent<EventFactoriesTuple>[]
      >
    },
  >(
    stateName: StateName,
    constructor: PayloadConstructor<StateArgs, StatePayload>,
    props: {
      commands: Commands
      designReaction: (
        addReaction: StateMechanism<
          EventFactoriesTuple,
          StateName,
          StateArgs,
          StatePayload,
          {}
        >['reactTo'],
      ) => unknown
    },
  ) => StateFactory<EventFactoriesTuple, StateName, StateArgs, StatePayload, Commands>
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

  export const init = <EventFactoriesTuple extends Event.Factory.NonZeroTuple>(
    _: EventFactoriesTuple,
  ) => makeProtocolDesigner<EventFactoriesTuple>()

  const makeProtocolDesigner = <
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
  >(): ProtocolDesigner<EventFactoriesTuple> => {
    const designState: ProtocolDesigner<EventFactoriesTuple>['designState'] = (
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
