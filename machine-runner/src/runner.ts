import { Actyx, EventKey, EventsOrTimetravel, MsgType, OnCompleteOrErr, Where } from '@actyx/sdk'
import { State } from './types.js'

export const runMachine = <E extends { type: string }>(
  sdk: Actyx,
  query: Where<E>,
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
    initial,
    cb,
  )
}

export function internalStartRunner<E extends { type: string }>(
  subscribe: (cb: (i: EventsOrTimetravel<E>) => void, err: OnCompleteOrErr) => () => void,
  initial: State<E>,
  cb: (state: State<E>, commandsEnabled: boolean) => void,
) {
  let state = deepCopy(initial)
  const queue: E[] = []
  const start = () =>
    subscribe(
      (d) => {
        if (d.type === MsgType.timetravel) {
          console.log('time travel')
          state = deepCopy(initial)
          queue.length = 0
          cancel = start()
        } else if (d.type === MsgType.events) {
          for (const event of d.events) {
            const e = event.payload
            console.log('delivering event', e.type, 'to', state.constructor.name)
            if (queue.length > 0) {
              const first = queue[0].type
              const react = state.reactions()[first].moreEvents
              const next = react[queue.length - 1]
              if (e.type !== next) {
                state.handleOrphan(e)
                continue
              }
              queue.push(e)
              if (queue.length <= react.length) continue
              const fun = Object.getPrototypeOf(state)[`on${first}`] as (...a: E[]) => State<E>
              state = fun.apply(state, queue)
              queue.length = 0
            } else {
              const react = state.reactions()[e.type]?.moreEvents
              if (!react) {
                state.handleOrphan(e)
                continue
              }
              if (react.length > 0) {
                queue.push(e)
              } else {
                const fun = Object.getPrototypeOf(state)[`on${e.type}`] as (...a: E[]) => State<E>
                state = fun.apply(state, [e])
              }
            }
          }
          if (d.caughtUp) {
            // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
            console.log('caught up')
            cb(state, queue.length === 0)
          }
        }
      },
      (err) => {
        console.error('restarting in 1sec due to error', err)
        state = deepCopy(initial)
        queue.length = 0
        setTimeout(() => (cancel = start()), 1000)
      },
    )
  let cancel = start()
  return () => cancel()
}

function deepCopy<T>(source: T): T {
  return Array.isArray(source)
    ? source.map(deepCopy)
    : source instanceof Date
    ? new Date(source.getTime())
    : typeof source === 'object' && source
    ? Object.entries(Object.getOwnPropertyDescriptors(source)).reduce((o, [prop, descr]) => {
        if (typeof descr.get === 'function') {
          throw new Error('cannot deepCopy objects with accessors')
        }
        descr.value = deepCopy(descr.value)
        Object.defineProperty(o, prop, descr)
        return o
      }, Object.create(Object.getPrototypeOf(source)))
    : source
}
