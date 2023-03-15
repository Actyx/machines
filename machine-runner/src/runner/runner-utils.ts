import { ActyxEvent } from '@actyx/sdk'
import { Obs } from '../utils/obs.js'
import { StateRaw, StateFactory, StateMechanism } from '../design/state.js'
import { Event } from '../design/event.js'
import { PushEventResult } from './runner-internals.js'

export const createChannelsForMachineRunner = () => ({
  audit: {
    reset: Obs.make<void>(),
    state: Obs.make<{
      state: StateRaw.Any
      events: ActyxEvent<Event.Any>[]
    }>(),
    dropped: Obs.make<{
      state: StateRaw.Any
      events: ActyxEvent<Event.Any>[]
    }>(),
    error: Obs.make<{
      state: StateRaw.Any
      events: ActyxEvent<Event.Any>[]
      error: unknown
    }>(),
  },
  debug: {
    eventHandlingPrevState: Obs.make<unknown>(),
    eventHandling: Obs.make<{
      event: ActyxEvent<Event.Any>
      handlingReport: PushEventResult
      mechanism: StateMechanism.Any
      factory: StateFactory.Any
      nextState: unknown
    }>(),
    caughtUp: Obs.make<void>(),
  },
  log: Obs.make<string>(),
})
