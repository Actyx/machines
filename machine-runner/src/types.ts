import { Actyx } from '@actyx/sdk'

export type Reactions = Record<string, { moreEvents: string[]; target: string }>
export type Schema = {
  title: string
  type: 'array'
  additionalItems: false
  items: ({ title: string } & { [k: string]: unknown })[]
}
export type Commands = Record<string, { schema: Schema; events: string[] }>
export type States = {
  states: Record<string, { events: Reactions; commands: Commands }>
  entrypoints: { state: string; role: string }[]
}
export type ToEmit = Record<string, States>

export class State<E extends { type: string }> {
  /** Utility method to create properly typed event tuples */
  events<T extends E[]>(...e: T): Events<T> {
    return new Events(e)
  }

  // overridden by the @proto decorator
  /** obtain a mapping from handled events to required follow-up types to invoke a transition */
  reactions(): Reactions {
    return {}
  }

  // overridden by the @proto decorator
  /** obtain a mapping from offered commands to their argument types (as JSON schema) */
  commands(): Commands {
    return {}
  }

  /**
   * Override to handle otherwise unhandled events received in the context of this state.
   *
   * Note that this function is called during each replay, so it is unwise to perform side-effects.
   * The proper way to execute compensating actions is to expose them in the state so that
   * external code can invoke them.
   */
  handleOrphan(event: E) {
    // default: do nothing
  }
}

export class Events<T> {
  constructor(public events: T) {}
}
