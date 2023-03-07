import * as utils from '../api2utils/type-utils.js'

// TODO: rethink name "Event" is an overused name and maybe a global name in TS/JS
export type Event<Key extends string, Payload extends object> = {
  type: Key
} & Payload

export namespace Event {
  export const design = <Key extends string>(key: Key): EventFactoryIntermediate<Key> => ({
    withPayload: () => ({
      type: key,
      new: (payload) => ({
        ...payload,
        type: key,
      }),
    }),
  })

  type EventFactoryIntermediate<Key extends string> = {
    withPayload: <Payload extends object>() => Factory<Key, Payload>
  }

  export type Any = Event<any, { [key: string | number | symbol]: any }>

  export type Of<T extends Factory.Any> = T extends Factory<any, infer Payload> ? Payload : never

  export type NonZeroTuple = utils.NonZeroTuple<Any>
  export type Factory<Key extends string, Payload extends object> = {
    type: Key
    new: (payload: Payload) => Event<Key, Payload>
  }

  export namespace Payload {
    export type Of<T extends Event.Any | Factory.Any> = T extends Event<any, infer Payload>
      ? Payload
      : T extends Event.Factory<any, infer Payload>
      ? Payload
      : never
  }

  export namespace Factory {
    export type Any = Factory<any, any>

    export type NonZeroTuple = utils.NonZeroTuple<Factory.Any>

    export type Of<T extends Event.Any> = T extends Event<any, infer Payload> ? Payload : never

    // =====
    type LooseMapToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [Event<Key, Payload>, ...LooseMapToEvent<Rest>]
      : []

    export type MapToEvent<T extends Event.Factory.Any[]> = LooseMapToEvent<T>

    // =====
    type LooseMapToPayload<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [Payload.Of<Event<Key, Payload>>, ...LooseMapToPayload<Rest>]
      : []

    export type MapToPayload<T extends Factory.Any[]> = LooseMapToPayload<T>

    // =====
    type LooseReduce<T extends any[]> = T extends [Factory<infer Key, infer Payload>, ...infer Rest]
      ? Factory<Key, Payload> | LooseReduce<Rest>
      : never

    export type Reduce<T extends Factory.Any[]> = LooseReduce<T>

    // =====
    type LooseReduceToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? Event<Key, Payload> | LooseReduceToEvent<Rest>
      : never

    export type ReduceToEvent<T extends Factory.Any[]> = LooseReduceToEvent<T>
  }
}
