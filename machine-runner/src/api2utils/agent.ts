import { Obs } from './obs.js'
export * from './obs.js'

type TDefaultAPI = {}
type TDefaultChannels = { change: Obs<void>; destroy: Obs<void> }

type DestructionAPI = {
  addDestroyHook: (hook: () => unknown) => void
  destroy: () => unknown
  isDestroyed: () => boolean
}

export type Agent<API extends object, Channels extends TDefaultChannels> = {
  id: Symbol
  channels: Channels
} & API &
  Pick<DestructionAPI, 'destroy' | 'isDestroyed'>

/**
 * Build a class-like object with `destroy` capability
 */
export namespace Agent {
  export type DefaultAPI = TDefaultAPI
  export type DefaultChannels = TDefaultChannels

  type AgentBuilder<API extends TDefaultAPI, Channels extends TDefaultChannels> = {
    build: () => Agent<API, Channels>
    setIdentifier: (str: string) => AgentBuilder<API, Channels>
    setChannels: <NewChannels extends Channels>(
      fn: (oldChannels: Channels) => NewChannels,
    ) => AgentBuilder<API, NewChannels>
    setAPI: <NewAPI extends TDefaultAPI>(
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
    const destructionAPI = ((): DestructionAPI => {
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
    })()

    const channels: TDefaultChannels = { change: Obs.make(), destroy: Obs.make() }

    return makeBuilderImpl<DefaultAPI, DefaultChannels>({
      api: {},
      channels,
      'identifier-string': '',
      ...destructionAPI,
    })
  }
}
