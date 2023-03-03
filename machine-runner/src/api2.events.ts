import * as utils from './api2.utils.js'

export type Event<Key extends string, Payload extends any> = {
  type: Key
  payload: Payload
}

export namespace Event {
  export const KEY_GETTER_SYMBOL: unique symbol = Symbol()

  export type NonZeroTuple = utils.NonZeroTuple<Event<any, any>>

  export const design = <Key extends string>(key: Key): EventFactoryIntermediate<Key> => ({
    withPayload: () => ({
      [KEY_GETTER_SYMBOL]: key,
      new: (payload) => ({
        type: key,
        payload,
      }),
    }),
  })

  type EventFactoryIntermediate<Key extends string> = {
    withPayload: <Payload extends any = void>() => Factory<Key, Payload>
  }

  export type Factory<Key extends string, Payload extends any> = {
    [KEY_GETTER_SYMBOL]: Key
    new: (payload: Payload) => Event<Key, Payload>
  }

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
      ? [ToPayload<Event<Key, Payload>>, ...LooseMapToPayload<Rest>]
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

  export type ToPayload<T extends Event<any, any>> = T extends Event<any, infer Payload>
    ? Payload
    : never
}
