export type State<Name extends string, Payload extends any> = {
  type: Name
  payload: Payload
}

export namespace State {
  export type Any = State<string, any>
}

export type StateConstructor<Name extends string, Args extends any[], Payload extends any> = (
  ...args: Args
) => State<Name, Payload>

export type PayloadConstructor<Args extends any[], Payload extends any> = (...args: Args) => Payload

export type PayloadConstructorToArgs<T> = T extends PayloadConstructor<infer Args, infer _>
  ? Args
  : never

export type PayloadConstructorToPayload<T> = T extends PayloadConstructor<infer _, infer Payload>
  ? Payload
  : never
