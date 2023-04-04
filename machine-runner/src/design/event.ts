/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActyxEvent } from '@actyx/sdk'
import * as utils from '../utils/type-utils.js'

// Note on "Loose" aliases
//
// Somehow underneath the calculation written below T extends [ Factory<infer
// Key, infer Payload>, ...infer Rest,
//     ]
// Rest is treated as unknown[] by the type checker. MapToEvent<T extends
// Event.Factory.Any[]> uses Event.Factory.Any[]. The extension signature limits
// users and us from accidentally assigning non factories to MapToEvent, but
// Rest which is unknown[] cannot be assigned to Event.Factory.Any[].
//
// Loose in turn receives any[], which is compatible with unknown[]. That's why
// "loose" is required.

/**
 * MachineEvent is a type definition for data used by an instance of
 * MachineRunner to communicate with other instances and with itself. Instances
 * of MachineEvent are persisted in Actyx as the payload of ActyxEvent. States
 * can be designed to emit MachineEvents and react to MachineEvents, which
 * yields a new state
 * @see MachineEvent.design for more information regarding designing
 * MachineEvent
 * @see MachineEvent.Factory.make for more information regarding instantiating
 * MachineEvent
 */
export type MachineEvent<Key extends string, Payload extends utils.SerializableObject> = {
  type: Key
} & Payload

/**
 * Collection of utilities surrounding MachineEvent creations.
 * @see MachineEvent.design for more information about designing MachineEvent
 */
export namespace MachineEvent {
  /**
   * Start a design of a MachineEventFactory used for MachineRunner.
   * @example
   * const HangarDoorTransitioning = MachineEvent
   *   .design("HangarDoorTransitioning")
   *   .withPayload<{ fractionOpen: number }>()
   * const HangarDoorClosed = MachineEvent
   *   .design("HangarDoorClosed")
   *   .withoutPayload()
   * const HangarDoorOpen = MachineEvent
   *   .design("HangarDoorOpen")
   *   .withoutPayload()
   *
   * // Creates a protocol that can make use of these three event types
   * const protocol = SwarmProtocol.make("HangarBayExchange", ["HangarBayExchange"], [
   *  HangarDoorTransitioning,
   *  HangarDoorClosed,
   *  HangarDoorOpen,
   * ])
   */
  export const design = <Key extends string>(key: Key): EventFactoryIntermediate<Key> => ({
    withPayload: () => ({
      type: key,
      make: (payload) => ({
        ...payload,
        type: key,
      }),
    }),
    withoutPayload: () => ({
      type: key,
      make: () => ({ type: key }),
    }),
  })

  type EventFactoryIntermediate<Key extends string> = {
    /**
     * Declares the payload type for this MachineEvent.
     */
    withPayload: <Payload extends utils.SerializableObject>() => Factory<Key, Payload>
    /**
     * Declares the payload type for this MachineEvent as {}.
     */
    withoutPayload: () => Factory<Key, Record<never, never>>
  }

  export type Any = MachineEvent<string, any>

  export type Of<T extends Factory.Any> = T extends Factory<infer Key, infer Payload>
    ? MachineEvent<Key, Payload>
    : never

  export type NonZeroTuple = utils.NonZeroTuple<Any>

  /**
   * MachineEvent.Factory is a type definition for a constructor type that serves
   * as a blueprint for the resulting instances.
   * @see MachineEvent.design for more information regarding designing
   * MachineEvent
   * @see MachineEvent.Factory.make for more information regarding instantiating
   * MachineEvent
   */
  export type Factory<Key extends string, Payload extends utils.SerializableObject> = {
    type: Key
    /**
     * Create an event with the factory's type assigned to it.
     * @example
     * const HangarDoorTransitioning = MachineEvent
     *    .design("HangarDoorTransitioning")
     *    .withPayload<{ fractionOpen: number }>()
     *
     * const machineEventInstance = HangarDoorTransitioning.make({ fractionOpen: 0.5 })
     */
    make: (payload: Payload) => MachineEvent<Key, Payload>
  }

  /**
   * A collection of type utilities around the Payload of a MachineEvent.Factory.
   */
  export namespace Payload {
    export type Of<T extends MachineEvent.Any | Factory.Any> = T extends MachineEvent<
      any,
      infer Payload
    >
      ? Payload
      : T extends MachineEvent.Factory<string, infer Payload>
      ? Payload
      : never
  }

  /**
   * A collection of type utilities around MachineEvent.Factory.
   */
  export namespace Factory {
    export type Any = Factory<string, any>

    export type NonZeroTuple = utils.NonZeroTuple<Factory.Any>

    export type Of<T extends MachineEvent.Any> = T extends MachineEvent<any, infer Payload>
      ? Payload
      : never

    // =====
    type LooseMapToActyxEvent<T, ACC extends ActyxEvent<MachineEvent.Any>[] = []> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseMapToActyxEvent<Rest, [...ACC, ActyxEvent<MachineEvent<Key, Payload>>]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into ActyxEvent[].
     * @example
     * MachineEvent.Factory.MapToActyxEvent<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [ActyxEvent<MachineEvent.Of<A>>, ActyxEvent<MachineEvent.Of<B>>]
     */
    export type MapToActyxEvent<T extends MachineEvent.Factory.Any[]> = LooseMapToActyxEvent<T>

    // =====
    type LooseMapToMachineEvent<T, ACC extends MachineEvent.Any[] = []> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseMapToMachineEvent<Rest, [...ACC, MachineEvent<Key, Payload>]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into MachineEvent[].
     * @example
     * MachineEvent.Factory.MapToMachineEvent<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [MachineEvent.Of<A>, MachineEvent.Of<B>]
     */
    export type MapToMachineEvent<T extends MachineEvent.Factory.Any[]> = LooseMapToMachineEvent<T>

    // =====
    type LooseMapToPayload<T, ACC extends utils.SerializableObject[] = []> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseMapToPayload<Rest, [...ACC, Payload]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into MachineEvent[].
     * @example
     * MachineEvent.Factory.MapToPayload<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [MachineEvent.Payload.Of<A>, MachineEvent.Payload.Of<B>]
     */
    export type MapToPayload<T extends Factory.Any[]> = LooseMapToPayload<T>

    // =====
    type LooseReduce<T, UNION extends MachineEvent.Factory.Any = never> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseReduce<Rest, UNION | Factory<Key, Payload>>
      : UNION

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into union of its members.
     * @example
     * MachineEvent.Factory.Reduce<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in A | B
     */
    export type Reduce<T extends Factory.Any[]> = LooseReduce<T>

    // =====
    type LooseReduceToEvent<T, UNION extends MachineEvent.Any = never> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseReduceToEvent<Rest, UNION | MachineEvent<Key, Payload>>
      : UNION

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into union of its members'
     * instance.
     * @example
     * MachineEvent.Factory.Reduce<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in MachineEvent.Of<A> | MachineEvent.Of<B>
     */
    export type ReduceToEvent<T extends Factory.Any[]> = LooseReduceToEvent<T>
  }
}
