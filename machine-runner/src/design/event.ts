/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActyxEvent } from '@actyx/sdk'
import * as utils from '../utils/type-utils.js'
import type * as z from 'zod'
import { importZod } from '../zod.js'

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
export type MachineEvent<Key extends string, Payload extends object> = {
  type: Key
} & Payload

type Zod = {
  z: typeof import('zod').z
  fromZodError: typeof import('zod-validation-error').fromZodError
}
const getZod = (): Zod => {
  const z = importZod()
  return {
    z: z.zod.z,
    fromZodError: z.zodError.fromZodError,
  }
}

/**
 * Collection of utilities surrounding MachineEvent creations.
 * @see MachineEvent.design for more information about designing MachineEvent
 */
export namespace MachineEvent {
  const mkParse = <Key extends string, Payload extends object>(
    key: Key,
    zodDefinition?: z.ZodType<Payload>,
  ) => {
    const defaultParser: (event: unknown) => ParseResult<MachineEvent<Key, Payload>> = (event) => {
      if (typeof event !== 'object' || event === null) {
        return { success: false, error: `Event ${event} is not an object` }
      }

      const type = (event as any).type
      if (type !== key) {
        return {
          success: false,
          error: `Event type ${type} does not match expected type ${key}`,
        }
      }

      return { success: true, event: event as MachineEvent<Key, Payload> }
    }

    if (!zodDefinition) {
      return defaultParser
    } else {
      const [zod, fromZodError] = (() => {
        const { z, fromZodError } = getZod()
        const zod = z.intersection(zodDefinition, z.object({ type: z.literal<Key>(key) }))
        return [zod, fromZodError] as const
      })()

      return (event: unknown): ParseResult<MachineEvent<Key, Payload>> => {
        const defaultParserResult = defaultParser(event)
        if (!defaultParserResult.success) return defaultParserResult

        const result = zod.safeParse(event)
        if (!result.success) {
          return { success: false, error: fromZodError(result.error).toString() }
        }

        // something is wrong with z.literal(), the resulting type doesn’t unify with Key
        return { success: true, event: Object.assign(result.data, { type: key }) }
      }
    }
  }

  /**
   * Start a design of a MachineEventFactory used for MachineRunner.
   *
   * Event payload will be serialized. Payload definition cannot have fields
   * that cannot be serialized and deserialized back via JSON.stringify and
   * JSON.parse.
   *
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
   * const protocol = SwarmProtocol.make("HangarBayExchange", [
   *  HangarDoorTransitioning,
   *  HangarDoorClosed,
   *  HangarDoorOpen,
   * ])
   */
  export const design = <Key extends string>(key: Key): EventFactoryIntermediate<Key> => ({
    withZod: (zodDefinition) => ({
      [FactoryInternalsAccessor]: { zodDefinition },
      type: key,
      make: (payload) => ({
        ...zodDefinition.parse(payload),
        type: key,
      }),
      parse: mkParse(key, zodDefinition),
    }),

    withPayload: () => ({
      [FactoryInternalsAccessor]: { zodDefinition: undefined },
      type: key,
      make: (payload) => ({
        ...payload,
        type: key,
      }),
      parse: mkParse(key),
    }),

    withoutPayload: () => ({
      [FactoryInternalsAccessor]: {
        zodDefinition: undefined,
      },
      type: key,
      make: () => ({ type: key }),
      parse: mkParse(key),
    }),
  })

  type EventFactoryIntermediate<Key extends string> = {
    /**
     * Declares the payload type for this MachineEvent using zod definition.
     *
     * Event payload will be serialized. Payload definition cannot have fields
     * that cannot be serialized and deserialized back via JSON.stringify and
     * JSON.parse.
     */
    withZod: <Payload extends utils.SerializableObject>(
      z: z.ZodType<Payload>,
    ) => Factory<Key, Payload>
    /**
     * Declares the payload type for this MachineEvent.
     *
     * Event payload will be serialized. Payload definition cannot have fields
     * that cannot be serialized and deserialized back via JSON.stringify and
     * JSON.parse.
     */
    withPayload: <Payload extends utils.SerializableObject>() => Factory<Key, Payload>
    /**
     * Declares the payload type for this MachineEvent as {}.
     */
    withoutPayload: () => Factory<Key, Record<never, never>>
  }

  export type Any = MachineEvent<string, object>

  export type Of<T extends Factory.Any> = ReturnType<T['make']>

  export type NonZeroTuple = utils.ReadonlyNonZeroTuple<Any>

  export const FactoryInternalsAccessor: unique symbol = Symbol('FactoryInternalsAccessor')

  export type FactoryInternals<Payload> = {
    zodDefinition?: z.ZodType<Payload>
  }

  export type ParseResult<Payload> =
    | {
        success: true
        event: Payload
      }
    | {
        success: false
        error: string
      }

  /**
   * MachineEvent.Factory is a type definition for a constructor type that serves
   * as a blueprint for the resulting instances.
   * @see MachineEvent.design for more information regarding designing
   * MachineEvent
   * @see MachineEvent.Factory.make for more information regarding instantiating
   * MachineEvent
   */
  export type Factory<Key extends string, Payload extends object> = {
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
    /**
     * This method doesn't do much unless `withZod` was used to define the state!
     *
     * If a zod definition was used to define the state, this method will check
     * whether the given event matches this definition. If no zod definition was
     * used, this method will only check whether the given event has the correct
     * type field.
     */
    parse: (event: unknown) => ParseResult<MachineEvent<Key, Payload>>
    /**
     * Contains Zod definition. Also serves to differentiate Event from
     * Event.Factory when evaluated with Payload.Of
     */
    [FactoryInternalsAccessor]: FactoryInternals<Payload>
  }

  /**
   * A collection of type utilities around the Payload of a MachineEvent.Factory.
   */
  export namespace Payload {
    export type Of<T extends MachineEvent.Any | Factory.Any> = T extends Factory<any, infer Payload>
      ? Payload
      : T extends MachineEvent<any, infer Payload>
      ? Payload
      : never
  }

  /**
   * A collection of type utilities around MachineEvent.Factory.
   */
  export namespace Factory {
    export type Any = Factory<string, any>

    export type ReadonlyNonZeroTuple = utils.ReadonlyNonZeroTuple<Factory.Any>

    /**
     * Retrive the factory type of an event
     * @example
     * MachineEvent.Factory.Of<type SomeEvent>
     * // where SomeEvent is a MachineEvent<Key, Payload>
     * // results in MachineEvent.Factory<Key, Payload>
     */
    export type Of<T extends MachineEvent.Any> = T extends MachineEvent<infer Key, infer Payload>
      ? Factory<Key, Payload>
      : never

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into ActyxEvent[].
     * @example
     * MachineEvent.Factory.MapToActyxEvent<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [ActyxEvent<MachineEvent.Of<A>>, ActyxEvent<MachineEvent.Of<B>>]
     */
    export type MapToActyxEvent<
      T extends Readonly<MachineEvent.Factory.Any[]>,
      ACC extends ActyxEvent<MachineEvent.Any>[] = [],
    > = T extends Readonly<
      [
        Factory<infer Key, infer Payload>,
        ...infer Rest extends Readonly<MachineEvent.Factory.Any[]>,
      ]
    >
      ? MapToActyxEvent<Rest, [...ACC, ActyxEvent<MachineEvent<Key, Payload>>]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into MachineEvent[].
     * @example
     * MachineEvent.Factory.MapToMachineEvent<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [MachineEvent.Of<A>, MachineEvent.Of<B>]
     */
    export type MapToMachineEvent<
      T extends Readonly<MachineEvent.Factory.Any[]>,
      ACC extends MachineEvent.Any[] = [],
    > = T extends Readonly<
      [
        Factory<infer Key, infer Payload>,
        ...infer Rest extends Readonly<MachineEvent.Factory.Any[]>,
      ]
    >
      ? MapToMachineEvent<Rest, [...ACC, MachineEvent<Key, Payload>]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into Payload[].
     * @example
     * MachineEvent.Factory.MapToPayload<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [MachineEvent.Payload.Of<A>, MachineEvent.Payload.Of<B>]
     */
    export type MapToPayload<
      T extends Readonly<Factory.Any[]>,
      ACC extends object[] = [],
    > = T extends Readonly<
      [Factory<any, infer Payload>, ...infer Rest extends Readonly<Factory.Any[]>]
    >
      ? MapToPayload<Rest, [...ACC, Payload]>
      : ACC

    /**
     * Turns a subtype of MachineEvent.Factory.Any[] into ContainedPayload<Payload>[].
     * @example
     * MachineEvent.Factory.MapToContainedPayload<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in [ContainedPayload<MachineEvent.Payload.Of<A>>, ContainedPayload<MachineEvent.Payload.Of<B>>]
     */
    export type MapToPayloadOrContainedPayload<
      T extends Readonly<Factory.Any[]>,
      ACC extends object[] = [],
    > = T extends Readonly<
      [Factory<any, infer Payload>, ...infer Rest extends Readonly<Factory.Any[]>]
    >
      ? MapToPayloadOrContainedPayload<
          Rest,
          [...ACC, Contained.ContainedPayload<Payload> | Payload]
        >
      : ACC

    /**
     * Reduces a subtype of MachineEvent.Factory.Any[] into union of its members.
     * @example
     * MachineEvent.Factory.Reduce<[A,B]>
     * // where A and B are MachineEvent.Factory
     * // results in A | B
     */
    export type Reduce<
      T extends Readonly<Factory.Any[]>,
      UNION extends MachineEvent.Factory.Any = never,
    > = T extends Readonly<
      [Factory<infer Key, infer Payload>, ...infer Rest extends Readonly<Factory.Any[]>]
    >
      ? Reduce<Rest, UNION | Factory<Key, Payload>>
      : UNION
  }
}

/**
 * Container of event and payload bound to extra data.
 */
export namespace Contained {
  const Marker = Symbol()
  type Marker = typeof Marker

  /**
   * Extra data that can be bound to event/payload.
   */
  export type ExtraData = { additionalTags: string[] }

  /**
   * Event bound to ExtraData.
   */
  export type ContainedEvent<E extends MachineEvent.Any> = [E, ExtraData | null]

  /**
   * Payload bound to ExtraData. ContainedPayload is differentiated from
   * ordinary payload by a unique marker.
   */
  export type ContainedPayload<P extends object> = [Marker, P, ExtraData]

  /**
   * Utilities around ContainedPayload
   */
  export namespace ContainedPayload {
    /**
     * Wraps payload into a ContainedPayload
     */
    export const wrap = <P extends object>(p: P, extraData: ExtraData): ContainedPayload<P> => [
      Marker,
      p,
      extraData,
    ]

    /**
     * Identify input whether it is a ContainedPayload or not. Returns payload
     * and possibly an ExtraData if input is a ContainedPayload
     */
    export const extract = <P extends object>(
      input: ContainedPayload<P> | P,
    ): [P, ExtraData | null] => {
      if (0 in input && input[0] === Marker) {
        return [input[1], input[2]]
      }

      return [input as P, null]
    }
  }
}
