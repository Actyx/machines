import { StateOpaque } from '@actyx/machine-runner'

export const PrintState = (props: { state: StateOpaque }) => (
  <pre>{JSON.stringify(props.state, null, 2)}</pre>
)
