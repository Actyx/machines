import { Obs } from './obs.js'
export * from './obs.js'

type TDefaultAPI = {}
type TDefaultChannels = { change: Obs<void> }

export type Agent<API extends TDefaultAPI, Channels extends TDefaultChannels> = {
  id: Symbol
  channels: Channels
  api: API
  destroy: () => unknown
}

export namespace Agent {
  export type DefaultAPI = TDefaultAPI
  export type DefaultChannels = TDefaultChannels

  type AgentPrototype<API extends DefaultAPI, Channels extends DefaultChannels> = Pick<
    Agent<API, Channels>,
    'channels' | 'api'
  > & {
    'identifier-string': string
    destroyHooks: Set<() => unknown>
  }

  const makeBuilderImpl = <API extends DefaultAPI, Channels extends DefaultChannels>(
    prototype: AgentPrototype<API, Channels>,
  ) => {
    const build = (): Agent<API, Channels> => ({
      id: Symbol(prototype['identifier-string']),
      api: prototype.api,
      channels: prototype.channels,
      destroy: () => {
        for (const hook of prototype.destroyHooks) {
          hook()
        }
      },
    })

    const setChannels = <NewChannels extends Channels>(fn: (channels: Channels) => NewChannels) =>
      makeBuilderImpl<API, NewChannels>({
        ...prototype,
        channels: fn(prototype.channels),
      })

    const setAPI = <NewAPI extends API>(
      fn: (_: {
        oldApi: API
        channels: Readonly<Channels>
        addDestroyHook: (hook: () => unknown) => void
      }) => NewAPI,
    ) =>
      makeBuilderImpl<NewAPI, Channels>({
        ...prototype,
        api: fn({
          oldApi: prototype.api,
          channels: prototype.channels,
          addDestroyHook: (hook) => prototype.destroyHooks.add(hook),
        }),
      })

    const setIdentifier = (id: string) =>
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
