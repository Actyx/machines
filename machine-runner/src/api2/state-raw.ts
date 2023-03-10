export type State<Name extends string, Payload extends any> = {
  type: Name
  payload: Payload
}

export namespace State {
  export type Any = State<string, any>
}
