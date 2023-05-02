export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends Record<string, unknown> ? DeepReadonly<T[P]> : T[P]
}

export type ReadonlyNonZeroTuple<T> = Readonly<[T, ...T[]]>
export type NonZeroTuple<T> = [T, ...T[]]

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type RetvalOrElse<T, Else> = T extends (...args: any[]) => infer Retval ? Retval : Else

export type ExtendsThenTransform<A, B, T = true, F = false> = [A] extends [B] ? T : F

// utilities from https://github.com/type-challenges/type-challenges
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false
export type NotEqual<X, Y> = true extends Equal<X, Y> ? false : true

export type Expect<T extends true> = T

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotAnyOrUnknown<T> = any extends T ? never : T

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableObject
  | SerializableArray
  // Record type cannot be circular https://github.com/microsoft/TypeScript/issues/41164
  // Read more in the comment below
  | Record<string, unknown>

type SerializableArray = SerializableValue[]

/* Note: Lax SerializableObject used for type constraint

Serializable object only guards the first level property. This means, when used
as type constraint, the user can still assign non-serializable values such as
Date, function, BigInt, symbol as key and values of the second-level object.

For example
```
const constrainedParam = <T extends SerialiableObject>(t: T) => {}

constrainedParam<{ someDate: Date }>(undefined as any);

// The line above results in compile error

constrainedParam<{ someObject: { [Symbol()]: Date } }>(undefined as any)

// The line below does not result in compile error
```

The problem is caused by TypeScript not supporting circular type for Record
type. This means we cannot write this:

`type SerializableValue = string | number | SomeOtherPrimitives | Record<string,
SerializableValue>`

Meanwhile, without Record type, the user-facing type definition that is written
against SerializableObject as the type constraint, such as that of the
withPayload, will encounter compile-error "Property 'record' is incompatible
with index signature." when { [key: string]: string } is assigned to the field.
Therefore `Record<string, unknown>` is included into the SerializableValue
union. The consequence of including it is that the type constrain becomes
relaxed and omits checks of serializable whenever Record is involve.
*/

export type SerializableObject = {
  [key: string]: SerializableValue
} & { [_: number | symbol]: never }
