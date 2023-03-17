import { ActyxEvent } from '@actyx/sdk'
import { StateRaw, StateFactory, StateMechanism } from '../design/state.js'
import { Event } from '../design/event.js'
import { PushEventResult } from './runner-internals.js'
import EventEmitter from 'events'
import { EventMap } from 'typed-emitter'

export type TypedEventEmitter<Events extends EventMap> = import('typed-emitter').default<Events>

export type MachineRunnerEventMap = {
  'audit.reset': (_: void) => unknown
  'audit.state': (_: { state: StateRaw.Any; events: ActyxEvent<Event.Any>[] }) => unknown
  'audit.dropped': (_: { state: StateRaw.Any; events: ActyxEvent<Event.Any>[] }) => unknown
  'audit.error': (_: {
    state: StateRaw.Any
    events: ActyxEvent<Event.Any>[]
    error: unknown
  }) => unknown
  'debug.eventHandlingPrevState': (_: unknown) => unknown
  'debug.eventHandling': (_: {
    event: ActyxEvent<Event.Any>
    handlingReport: PushEventResult
    mechanism: StateMechanism.Any
    factory: StateFactory.Any
    nextState: unknown
  }) => unknown
  'debug.caughtUp': (_: void) => unknown
  change: (_: void) => unknown
  destroyed: (_: void) => unknown
  log: (_: string) => unknown
}

export const createEventEmittersForMachineRunner = () =>
  new EventEmitter() as TypedEventEmitter<MachineRunnerEventMap>
