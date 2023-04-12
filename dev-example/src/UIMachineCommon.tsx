import { StateOpaque } from '@actyx/machine-runner'
import { protocol } from './machines/protocol.js'

export const PrintState = (props: { state: StateOpaque.Of<typeof protocol> }) => (
  <pre>{toPrettyJSONString(props.state)}</pre>
)

// Extracted for testing demo purpose
export const toPrettyJSONString = (state: StateOpaque.Of<typeof protocol>) =>
  JSON.stringify(state, null, 2)
