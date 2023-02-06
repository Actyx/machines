import { Actyx, EventKey, MsgType, Where } from '@actyx/sdk'
import { State } from './types.js'

export const runMachine = <E extends { type: string }>(
  sdk: Actyx,
  query: Where<E>,
  initial: State<E>,
  cb: (state: State<E>, commandsEnabled: boolean) => void,
) => {
  let state = deepCopy(initial)
  let queue: E[] = []
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let cancel = () => {}
  const start = () =>
    sdk.subscribeMonotonic(
      { query, sessionId: 'dummy', attemptStartFrom: { from: {}, latestEventKey: EventKey.zero } },
      (d) => {
        if (d.type === MsgType.timetravel) {
          console.log('time travel')
          state = deepCopy(initial)
          queue = []
          cancel = start()
        } else if (d.type === MsgType.events) {
          for (const event of d.events) {
            const e = event.payload
            console.log('delivering event', e.type, 'to', state.constructor.name)
            if (queue.length > 0) {
              const first = queue[0].type
              const react = state.reactions()[first].moreEvents
              const next = react[queue.length - 1]
              if (e.type !== next) continue
              queue.push(e)
              if (queue.length <= react.length) continue
              const fun = Object.getPrototypeOf(state)[`on${first}`] as (...a: E[]) => State<E>
              state = fun.apply(state, queue)
              queue = []
            } else {
              const react = state.reactions()[e.type]?.moreEvents
              if (!react) continue
              if (react.length > 0) {
                queue.push(e)
              } else {
                const fun = Object.getPrototypeOf(state)[`on${e.type}`] as (...a: E[]) => State<E>
                state = fun.apply(state, [e])
              }
            }
          }
          if (d.caughtUp) {
            console.log('caught up')
            cb(state, queue.length === 0)
          }
        }
      },
      (err) => {
        console.error('restarting due to error', err)
        state = deepCopy(initial)
        queue = []
        setTimeout(() => (cancel = start()), 1000)
      },
    )
  cancel = start()
  return () => cancel()
}

function deepCopy<T>(source: T): T {
  return Array.isArray(source)
    ? source.map((item) => deepCopy(item))
    : source instanceof Date
    ? new Date(source.getTime())
    : source && typeof source === 'object'
    ? Object.entries(Object.getOwnPropertyDescriptors(source)).reduce((o, [prop, descr]) => {
        if (typeof descr.get === 'function') {
          throw new Error('cannot deepCopy objects with accessors')
        }
        descr.value = deepCopy(descr.value)
        Object.defineProperty(o, prop, descr)
        return o
      }, Object.create(Object.getPrototypeOf(source)))
    : (source as T)
}
