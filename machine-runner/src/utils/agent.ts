import { Obs } from './obs.js'
export * from './obs.js'

export type Agent<API extends object, Channels extends DefaultChannels> = {
  id: Symbol
  channels: Channels
} & API &
  Pick<DestructionAPI, 'destroy' | 'isDestroyed'>

/**
 * Build a class-like object with `destroy` capability
 */
export namespace Agent {
  const makeBuilderImpl = <API extends DefaultAPI, Channels extends DefaultChannels>(
    prototype: AgentPrototype<API, Channels>,
  ): AgentBuilder<API, Channels> => {
    type Self = AgentBuilder<API, Channels>

    const build: Self['build'] = () => ({
      ...prototype.api,
      id: Symbol(prototype['identifier-string']),
      channels: prototype.channels,
      destroy: prototype.destroy,
      isDestroyed: prototype.isDestroyed,
    })

    const setChannels: Self['setChannels'] = (fn) =>
      makeBuilderImpl({
        ...prototype,
        channels: fn(prototype.channels),
      })

    const setAPI: Self['setAPI'] = (fn) =>
      makeBuilderImpl({
        ...prototype,
        api: fn({
          oldApi: prototype.api,
          channels: prototype.channels,
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

    return {
      build,
      setIdentifier,
      setChannels,
      setAPI,
    }
  }

  export const startBuild = () => {
    const defaultChannels: DefaultChannels = { change: Obs.make(), destroy: Obs.make() }
    const destructionAPI = DestructionAPI.make(defaultChannels)

    return makeBuilderImpl<DefaultAPI, DefaultChannels>({
      api: {},
      channels: defaultChannels,
      'identifier-string': '',
      ...destructionAPI,
    })
  }
}

type AgentBuilder<API extends DefaultAPI, Channels extends DefaultChannels> = {
  build: () => Agent<API, Channels>
  setIdentifier: (str: string) => AgentBuilder<API, Channels>
  setChannels: <NewChannels extends Channels>(
    fn: (oldChannels: Channels) => NewChannels,
  ) => AgentBuilder<API, NewChannels>
  setAPI: <NewAPI extends DefaultAPI>(
    fn: (
      params: {
        oldApi: API
        channels: Readonly<Channels>
      } & DestructionAPI,
    ) => NewAPI & { channels?: never; destroy?: never; isDestroyed?: never },
  ) => AgentBuilder<NewAPI, Channels>
}

type AgentPrototype<API extends object, Channels extends DefaultChannels> = {
  api: API
  channels: Channels
} & {
  'identifier-string': string
} & DestructionAPI

type DefaultAPI = {}
type DefaultChannels = { change: Obs<void>; destroy: Obs<void> }

type DestructionAPI = {
  addDestroyHook: (hook: () => unknown) => void
  destroy: () => unknown
  isDestroyed: () => boolean
}

export namespace DestructionAPI {
  export const make = (channels: DefaultChannels): DestructionAPI => {
    let destroyed = false
    const destroyhooks = new Set<Function>()
    return {
      addDestroyHook: (hook) => destroyhooks.add(hook),
      destroy: () => {
        if (!destroyed) {
          channels.destroy.emit()
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
