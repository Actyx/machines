import { MachineEvent } from '../index.js'
import { CommandDefinerMap, Contained, StateFactory } from '../design/state.js'
import { RunnerInternals } from '../runner/runner-internals.js'
import { ImplStateOpaque } from '../runner/runner.js'

type Options = {
  disableCommands?: boolean
  capturedEvents?: unknown[]
}

export const createMockStateOpaque = <
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload,
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
>(
  factory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >,
  payload: StatePayload,
  options?: Options,
) => {
  const internals = RunnerInternals.make(factory, payload, async () => [])
  return ImplStateOpaque.make(
    {
      ...internals,
      caughtUp: !options?.disableCommands,
      caughtUpFirstTime: true,
      commandEmitFn: async (props) => {
        const containedEvents = props.generateEvents()
        const events = containedEvents.map(([ev, _extraData]) => ev)
        options?.capturedEvents?.push(...events)
        return []
      },
    },
    internals.current,
  )
}

export const createMockState = <
  SwarmProtocolName extends string,
  MachineName extends string,
  MachineEventFactories extends MachineEvent.Factory.Any,
  StateName extends string,
  StatePayload,
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  Commands extends CommandDefinerMap<any, any, Contained.ContainedEvent<MachineEvent.Any>[]>,
>(
  factory: StateFactory<
    SwarmProtocolName,
    MachineName,
    MachineEventFactories,
    StateName,
    StatePayload,
    Commands
  >,
  payload: StatePayload,
  options?: Options,
) => {
  const state = createMockStateOpaque(factory, payload, options).as(factory)
  if (!state) throw new Error('never')
  return state
}
