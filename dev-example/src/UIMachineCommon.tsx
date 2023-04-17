import { StateOpaque } from '@actyx/machine-runner'
import { protocol } from './machines/protocol.js'

export const PrintState = (props: { state: StateOpaque.Of<typeof protocol> }) => (
  <pre>{JSON.stringify(props.state, null, 2)}</pre>
)
