import { Actyx, Tags } from '@actyx/sdk'
import validator from '@rjsf/validator-ajv8'
import { withTheme } from '@rjsf/core'
import { useEffect, useReducer, useState } from 'react'
import { Commands, Events, runMachine, State } from '@actyx/machine-runner'

const Form = withTheme({})

type Props<E extends { type: string }> = {
  id: string
  where: Tags<E>
  initial: State<E>
  actyx: Actyx
  className?: string
}

/**
 * This React component is a generic widget for display a machine, showing its current
 * state as well as the currently enabled commands (using forms derived from the
 * inferred JSON schema of the respective command arguments - the inference is performed
 * by the `machine-check` tool).
 */
export function ShowMachine<E extends { type: string }>({
  id,
  where,
  initial,
  actyx,
  className,
}: Props<E>) {
  const [state, setState] = useState<State<E>>()
  // CHANGED: from using number to using Symbol
  // to avoid rare but not improbable cases when number exceed
  // MAX_SAFE_INTEGER
  const [, update] = useReducer(() => Symbol(), Symbol())
  const [commands, setCommands] = useState<Commands>({})

  useEffect(
    () =>
      runMachine(actyx, where, initial, (state, cmds) => {
        setState(state)
        console.log('commands', state.commands())
        setCommands(cmds ? state.commands() : {})
        update()
      }),
    [],
  )

  const command = (cmd: string, arg: unknown[]) => {
    // QUICKFIX for runner's method patching that is done on the object
    // previously, `command` calls for the prototype's function rather than the object's function
    const fun = (state as any)[`exec${cmd}`] as (...arg: unknown[]) => Events<E[]>
    fun.apply(state, arg)
  }

  return (
    <div className={className}>
      <h2>Machine {id}</h2>
      <h3>State</h3>
      <pre>
        {state?.constructor.name} {JSON.stringify(state, undefined, 2)}
      </pre>
      <h3>Commands</h3>
      {...Object.entries(commands).map(([cmd, { schema }]) =>
        schema.items.length > 0 ? (
          <Form
            schema={schema}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            validator={validator as any}
            onSubmit={(data) => command(cmd, data.formData)}
          />
        ) : (
          <button onClick={() => command(cmd, [])}>{cmd}</button>
        ),
      )}
    </div>
  )
}
