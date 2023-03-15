import { StateSnapshotOpaque } from '@actyx/machine-runner'

export const PrintState = (props: { snapshot: StateSnapshotOpaque }) => (
  <pre>{JSON.stringify(props.snapshot, null, 2)}</pre>
)
