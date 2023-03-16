import EventEmitter from 'events'
import { EventMap } from 'typed-emitter'
type TypedEventEmitter<Events extends EventMap> = import('typed-emitter').default<Events>

export type Agent<API extends object, EventMap extends Agent.DefaultEventMap> = {
  id: Symbol
  events: TypedEventEmitter<EventMap>
} & API &
  Pick<DestructionAPI, 'destroy' | 'isDestroyed'>

/**
 * Build a class-like object with `destroy` capability
 */
export namespace Agent {
  export type DefaultAPI = {}
  export type DefaultEventMap = {
    change: (_: void) => unknown
    destroyed: (_: void) => unknown
  }
  export type NegatedDefaultEventMap = object & {
    [key in keyof DefaultEventMap]?: never
  }

  const makeBuilderImpl = <API extends Agent.DefaultAPI, EventMap extends Agent.DefaultEventMap>(
    prototype: AgentPrototype<API, EventMap>,
  ): AgentBuilder<API, EventMap> => {
    type Self = AgentBuilder<API, EventMap>

    const build: Self['build'] = () => ({
      ...prototype.api,
      id: Symbol(prototype['identifier-string']),
      events: prototype.events,
      destroy: prototype.destroy,
      isDestroyed: prototype.isDestroyed,
    })

    const setChannels: Self['setChannels'] = () => self

    const setAPI: Self['setAPI'] = (fn) =>
      makeBuilderImpl({
        ...prototype,
        api: fn({
          oldApi: prototype.api,
          events: prototype.events,
          addDestroyHook: prototype.addDestroyHook,
          destroy: prototype.destroy,
          isDestroyed: prototype.isDestroyed,
        }),
      })

    const setIdentifier: Self['setIdentifier'] = (id: string) =>
      makeBuilderImpl({
        ...prototype,
        'identifier-string': id,
      })

    const self = {
      build,
      setIdentifier,
      setChannels,
      setAPI,
    }
    return self
  }

  export const startBuild = () => {
    const eventEmitter: TypedEventEmitter<DefaultEventMap> =
      new EventEmitter() as TypedEventEmitter<DefaultEventMap>
    const destructionAPI = DestructionAPI.make(eventEmitter)

    return makeBuilderImpl<DefaultAPI, DefaultEventMap>({
      api: {},
      events: eventEmitter,
      'identifier-string': '',
      ...destructionAPI,
    })
  }
}

type AgentBuilder<API extends Agent.DefaultAPI, EventMap extends Agent.DefaultEventMap> = {
  build: () => Agent<API, EventMap>
  setIdentifier: (str: string) => AgentBuilder<API, EventMap>
  setChannels: <NewEventMap extends Agent.NegatedDefaultEventMap>() => AgentBuilder<
    API,
    EventMap & Omit<NewEventMap, keyof Agent.NegatedDefaultEventMap>
  >
  setAPI: <NewAPI extends Agent.DefaultAPI>(
    fn: (
      params: {
        oldApi: API
        events: Readonly<TypedEventEmitter<EventMap>>
      } & DestructionAPI,
    ) => NewAPI & { channels?: never; destroy?: never; isDestroyed?: never },
  ) => AgentBuilder<NewAPI, EventMap>
}

type AgentPrototype<API extends object, EventMap extends Agent.DefaultEventMap> = {
  api: API
  events: TypedEventEmitter<EventMap>
} & {
  'identifier-string': string
} & DestructionAPI

type DestructionAPI = {
  addDestroyHook: (hook: () => unknown) => void
  destroy: () => unknown
  isDestroyed: () => boolean
}

export namespace DestructionAPI {
  export const make = (events: TypedEventEmitter<Agent.DefaultEventMap>): DestructionAPI => {
    let destroyed = false
    const destroyhooks = new Set<Function>()
    return {
      addDestroyHook: (hook) => destroyhooks.add(hook),
      destroy: () => {
        if (!destroyed) {
          events.emit('destroyed')
          destroyed = true
          for (const hook of destroyhooks) {
            try {
              hook()
            } catch (err) {
              console.error(err)
            }
          }
        }
      },
      isDestroyed: () => destroyed,
    }
  }
}
