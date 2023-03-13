import { Obs } from './obs.js'
export * from './obs.js'

type TDefaultAPI = {}
type TDefaultChannels = { change: Obs<void> }

export type Agent<API extends object, Channels extends TDefaultChannels> = {
  id: Symbol
  channels: Channels
  destroy: () => unknown
} & API

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
      fn: (params: {
        oldApi: API
        channels: Readonly<Channels>
        addDestroyHook: (hook: () => unknown) => void
        selfDestroy: () => unknown
      }) => NewAPI & { channels?: never; destroy?: never },
    ) => AgentBuilder<NewAPI, Channels>
  }

  type AgentPrototype<API extends object, Channels extends DefaultChannels> = {
    api: API
    channels: Channels
  } & {
    'identifier-string': string
    destroyHooks: Set<() => unknown>
  }

  const makeBuilderImpl = <API extends DefaultAPI, Channels extends DefaultChannels>(
    prototype: AgentPrototype<API, Channels>,
  ): AgentBuilder<API, Channels> => {
    type Self = AgentBuilder<API, Channels>

    const destroy = () => {
      for (const hook of prototype.destroyHooks) {
        hook()
      }
    }
    const build: Self['build'] = () => ({
      ...prototype.api,
      id: Symbol(prototype['identifier-string']),
      channels: prototype.channels,
      destroy,
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
          addDestroyHook: (hook) => prototype.destroyHooks.add(hook),
          selfDestroy: destroy,
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

  export const startBuild = () =>
    makeBuilderImpl<DefaultAPI, DefaultChannels>({
      api: {},
      channels: { change: Obs.make() },
      'identifier-string': '',
      destroyHooks: new Set(),
    })
}
