export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends Record<string, unknown> ? DeepReadonly<T[P]> : T[P]
}

export type NonZeroTuple<T> = [T, ...T[]]

export type ExtendsThenTransform<A, B, T = true, F = false> = A extends B ? T : F

export type NotAnyOrUnknown<T> = ExtendsThenTransform<any, T, never, T>

type SerializablePrimitive = number | string | boolean | null | undefined

export type SerializableObject = {
  [_: string]: SerializablePrimitive | SerializablePrimitive[] | SerializableObject
  [_: number]: never
  [_: symbol]: never
}
