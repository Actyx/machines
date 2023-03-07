export const PrintState = (props: { state: unknown }) => (
  <pre>{JSON.stringify(props.state, null, 2)}</pre>
)
