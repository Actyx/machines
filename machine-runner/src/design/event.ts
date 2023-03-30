import { ActyxEvent } from '@actyx/sdk'
import * as utils from '../utils/type-utils.js'

// Note on "Loose" aliases
//
// Somehow underneath the calculation written below
// T extends [
//       Factory<infer Key, infer Payload>,
//       ...infer Rest,
//     ]
// Rest is treated as unknown[] by the type checker. MapToEvent<T extends Event.Factory.Any[]> uses Event.Factory.Any[]. The extension signature limits users and us from accidentally assigning non factories to MapToEvent, but Rest which is unknown[] cannot be assigned to Event.Factory.Any[].
//
// Loose in turn receives any[], which is compatible with unknown[]. That's why "loose" is required.

// TODO: rethink name "Event" is an overused name and maybe a global name in TS/JS
export type MachineEvent<Key extends string, Payload extends utils.SerializableObject> = {
  type: Key
} & Payload

export namespace MachineEvent {
  /**
   * Start a design of a MachineEventFactory used for MachineRunner.
   * @example
   * const HangarDoorTransitioning = MachineEvent.design("HangarDoorTransitioning").withPayload<{ fractionOpen: number }>()
   * const HangarDoorClosed = MachineEvent.design("HangarDoorClosed").withoutPayload()
   * const HangarDoorOpen = MachineEvent.design("HangarDoorOpen").withoutPayload()
   *
   * // Creates the protocol involving the events specified in the array passed on to the second parameter
   * const protocol = Protocol.make("hangardoor", [
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
     * Attaches payload constraints to a MachineEvent
     */
    withPayload: <Payload extends utils.SerializableObject>() => Factory<Key, Payload>
    /**
     * Indicate that the MachineEvent in question does not have any payloads
     */
    withoutPayload: () => Factory<Key, Record<never, never>>
  }

  export type Any = MachineEvent<string, any>

  export type Of<T extends Factory.Any> = T extends Factory<any, infer Payload> ? Payload : never

  export type NonZeroTuple = utils.NonZeroTuple<Any>

  export type Factory<Key extends string, Payload extends utils.SerializableObject> = {
    type: Key
    /**
     * Create an event with the factory's type assigned to it
     * @example
     * const machineEventInstance = HangarDoorTransitioning.make({ open: 0.5 })
     */
    make: (payload: Payload) => MachineEvent<Key, Payload>
  }

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

    export type MapToActyxEvent<T extends MachineEvent.Factory.Any[]> = LooseMapToActyxEvent<T>

    // =====
    type LooseMapToMachineEvent<T, ACC extends MachineEvent.Any[] = []> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseMapToMachineEvent<Rest, [...ACC, MachineEvent<Key, Payload>]>
      : ACC

    export type MapToMachineEvent<T extends MachineEvent.Factory.Any[]> = LooseMapToMachineEvent<T>

    // =====
    type LooseMapToPayload<T, ACC extends utils.SerializableObject[] = []> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseMapToPayload<Rest, [...ACC, Payload]>
      : ACC

    export type MapToPayload<T extends Factory.Any[]> = LooseMapToPayload<T>

    // =====
    type LooseReduce<T, UNION extends MachineEvent.Factory.Any = never> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseReduce<Rest, UNION | Factory<Key, Payload>>
      : UNION

    export type Reduce<T extends Factory.Any[]> = LooseReduce<T>

    // =====
    type LooseReduceToEvent<T, UNION extends MachineEvent.Any = never> = T extends [
      Factory<infer Key, infer Payload>,
      ...infer Rest,
    ]
      ? LooseReduceToEvent<Rest, UNION | MachineEvent<Key, Payload>>
      : UNION

    export type ReduceToEvent<T extends Factory.Any[]> = LooseReduceToEvent<T>
  }
}
