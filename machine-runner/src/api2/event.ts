import * as utils from '../api2utils/type-utils.js'

// TODO: rethink name "Event" is an overused name and maybe a global name in TS/JS
export type Event<Key extends string, Payload extends {}> = {
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
    withPayload: <Payload extends {}>() => Factory<Key, Payload>
  }

  export type Any = Event<string, {}>
  export type NonZeroTuple = utils.NonZeroTuple<Any>
  export type Factory<Key extends string, Payload extends {}> = {
    type: Key
    new: (payload: Payload) => Event<Key, Payload>
  }
  export type PayloadOf<T extends Event.Any> = T extends Event<any, infer Payload> ? Payload : never

  export namespace Factory {
    export type NonZeroTuple = utils.NonZeroTuple<Factory<any, any>>

    // =====
    type LooseMapToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [Event<Key, Payload>, ...LooseMapToEvent<Rest>]
      : []

    export type MapToEvent<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseMapToEvent<T>

    // =====
    type LooseMapToPayload<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? [PayloadOf<Event<Key, Payload>>, ...LooseMapToPayload<Rest>]
      : []

    export type MapToPayload<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseMapToPayload<T>

    // =====
    type LooseReduce<T extends any[]> = T extends [Factory<infer Key, infer Payload>, ...infer Rest]
      ? Factory<Key, Payload> | LooseReduce<Rest>
      : never

    export type Reduce<T extends [Factory<any, any>, ...Factory<any, any>[]]> = LooseReduce<T>

    // =====
    type LooseReduceToEvent<T extends any[]> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? Event<Key, Payload> | LooseReduceToEvent<Rest>
      : never

    export type ReduceToEvent<T extends [Factory<any, any>, ...Factory<any, any>[]]> =
      LooseReduceToEvent<T>
  }
}
