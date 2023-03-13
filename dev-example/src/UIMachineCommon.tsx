import { StateSnapshotOpaque } from '@actyx/machine-runner/lib/api2.js'

export const PrintState = (props: { snapshot: StateSnapshotOpaque }) => (
  <pre>{JSON.stringify(props.snapshot, null, 2)}</pre>
)
