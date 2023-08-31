import { ActyxEvent } from '@actyx/sdk'
import { StateRaw, StateFactory, StateMechanism } from '../design/state.js'
import { MachineEvent } from '../design/event.js'
import { PushEventResult } from './runner-internals.js'
import { EventMap } from 'typed-emitter'
import { StateOpaque } from './runner.js'
import {
  MachineRunnerError,
  MachineRunnerErrorCommandFiredAfterDestroyed,
  MachineRunnerErrorCommandFiredAfterExpired,
  MachineRunnerErrorCommandFiredAfterLocked,
} from '../errors.js'

/**
 * Imported this way because it cannot be imported via normal import ... from
 * syntax https://github.com/andywer/typed-emitter/issues/39
 */
export type TypedEventEmitter<Events extends EventMap> = import('typed-emitter').default<Events>

type EmittableErrors =
  | MachineRunnerError
  | MachineRunnerErrorCommandFiredAfterLocked
  | MachineRunnerErrorCommandFiredAfterDestroyed
  | MachineRunnerErrorCommandFiredAfterExpired

export type GlobalEmitter = TypedEventEmitter<GlobalMachineEmitterEventMap>

export type MachineEmitter<
  SwarmProtocolName extends string,
  MachineName extends string,
  StateUnion extends unknown,
> = TypedEventEmitter<MachineEmitterEventMap<SwarmProtocolName, MachineName, StateUnion>>

export type CommonEmitterEventMap = {
  'debug.bootTime': (_: { identity: string; durationMs: number; eventCount: number }) => unknown
  error: (_: EmittableErrors) => unknown
}

export type GlobalMachineEmitterEventMap = CommonEmitterEventMap

export type MachineEmitterEventMap<
  SwarmProtocolName extends string,
  MachineName extends string,
  StateUnion extends unknown,
> = {
  'audit.reset': (_: void) => unknown
  'audit.state': (_: {
    state: StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>
    events: ActyxEvent<MachineEvent.Any>[]
  }) => unknown
  'audit.dropped': (_: { state: StateRaw.Any; event: ActyxEvent<MachineEvent.Any> }) => unknown
  'audit.error': (_: {
    state: StateRaw.Any
    events: ActyxEvent<MachineEvent.Any>[]
    error: unknown
  }) => unknown
  'debug.eventHandlingPrevState': (_: unknown) => unknown
  'debug.eventHandling': (_: {
    event: ActyxEvent<MachineEvent.Any>
    handlingReport: PushEventResult
    mechanism: StateMechanism.Any
    factory: StateFactory.Any
    nextState: unknown
  }) => unknown
  change: (_: StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>) => unknown
  next: (_: StateOpaque<SwarmProtocolName, MachineName, string, StateUnion>) => unknown
  destroyed: (_: void) => unknown
  log: (_: string) => unknown
} & CommonEmitterEventMap
