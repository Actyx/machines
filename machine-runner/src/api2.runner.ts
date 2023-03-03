import { Actyx, Tags } from '@actyx/sdk'

export const runMachine = <E extends { type: string }>(
  sdk: Actyx,
  query: Tags<E>,
  initial: State<E>,
  cb: (state: State<E>, commandsEnabled: boolean) => void,
): (() => void) => {
  // prettier-ignore
  const sub = (sdk.subscribeMonotonic)<E>
  return internalStartRunner(
    sub.bind(sdk, {
      query,
      sessionId: 'dummy',
      attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
    }),
    (e) =>
      sdk
        .publish(query.apply(...e.events))
        .catch((err) => console.error('error publishing', err, ...e.events)),
    initial,
    cb,
  )
}
