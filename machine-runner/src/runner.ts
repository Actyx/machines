import {
  Actyx,
  ActyxEvent,
  EventKey,
  EventsOrTimetravel,
  MsgType,
  OnCompleteOrErr,
  Tags,
  Where,
} from '@actyx/sdk'
import { Events, State } from './types.js'
import { debug } from 'debug'

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

export const auditMachine = <E extends { type: string }>(
  sdk: Actyx,
  query: Where<E>,
  initial: State<E>,
  audit: Auditor<State<E>, E>,
): (() => void) => {
  // prettier-ignore
  const sub = (sdk.subscribeMonotonic)<E>
  return internalStartRunner(
    sub.bind(sdk, {
      query,
      sessionId: 'dummy',
      attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
    }),
    () => {
      // no need to publish since nobody will invoke commands
    },
    initial,
    null,
    audit,
  )
}

export type Auditor<S, E> = {
  reset(): void
  state(state: S, events: ActyxEvent<E>[]): void
  dropped(state: S, event: ActyxEvent<E>): void
  error(state: S, event: ActyxEvent<E>[], error: unknown): void
}

const mkLog = debug('runner')
const log = {
  debug: mkLog.extend('+'),
  info: mkLog.extend('++'),
  warn: mkLog.extend('+++'),
  error: mkLog.extend('++++'),
}

/**
 * This property is set on a state when an exec… method is called,
 * it prevents calling another exec… method afterwards (will throw).
 */
const invalidated = Symbol()

export function internalStartRunner<E extends { type: string }>(
  subscribe: (cb: (i: EventsOrTimetravel<E>) => void, err: OnCompleteOrErr) => () => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persist: (events: Events<any[]>) => void,
  initial: State<E>,
  cb: ((state: State<E>, commandsEnabled: boolean) => void) | null,
  audit?: Auditor<State<E>, E>,
) {
  let state = deepCopy(initial)
  const queue: ActyxEvent<E>[] = []
  const start = () =>
    subscribe(
      (d) => {
        if (d.type === MsgType.timetravel) {
          log.debug('time travel')
          state = deepCopy(initial)
          queue.length = 0
          swallow(audit?.reset)
          cancel = start()
        } else if (d.type === MsgType.events) {
          for (const event of d.events) {
            const evType = event.payload.type
            log.debug('delivering event', evType, 'to', state.constructor.name)
            if (queue.length > 0) {
              const first = queue[0].payload.type
              const react = state.reactions()[first].moreEvents
              const next = react[queue.length - 1]
              if (evType !== next) {
                handleOrphan(state, event, audit)
                continue
              }
              queue.push(event)
              if (queue.length <= react.length) continue
              state = runState(state, first, [...queue], audit)
              queue.length = 0
            } else {
              const react = state.reactions()[evType]?.moreEvents
              if (!react) {
                handleOrphan(state, event, audit)
                continue
              }
              if (react.length > 0) {
                queue.push(event)
              } else {
                state = runState(state, evType, [event], audit)
              }
            }
          }
          if (d.caughtUp && cb !== null) {
            // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
            log.debug('caught up')
            swallow(cb, wrapExec(state, persist), queue.length === 0)
          }
        }
      },
      (err) => {
        log.error('restarting in 1sec due to error', err)
        state = deepCopy(initial)
        queue.length = 0
        swallow(audit?.reset)

        // Retry mechanism
        // Might benefit from randomized and incremental backoff?
        setTimeout(() => (cancel = start()), 1000)
      },
    )
  let cancel = start()
  return () => cancel()
}

function wrapExec<T extends { type: string }, U extends T[]>(
  state: State<T>,
  persist: (events: Events<U>) => void,
): State<T> {
  const obj = deepCopy(state)
  function traverse(o: object) {
    if (o === State.prototype) return
    for (const methodName of Object.getOwnPropertyNames(o)) {
      if (Object.getOwnPropertyDescriptor(obj, methodName)) continue
      const desc = Object.getOwnPropertyDescriptor(o, methodName)
      if (!desc) continue
      if (!methodName.startsWith('exec') || typeof desc.value !== 'function') continue
      const name = desc.value.name
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      desc.value = function (this: any, ...args: unknown[]) {
        if (this[invalidated]) throw new Error('cannot call exec method a second time')
        this[invalidated] = true
        const events = Object.getPrototypeOf(this)[methodName].apply(this, args) as Events<U>
        persist(events)
        return events
      }
      Object.defineProperty(desc.value, 'name', { value: name })
      Object.defineProperty(obj, methodName, desc)
    }
    traverse(Object.getPrototypeOf(o))
  }
  traverse(obj)
  return obj
}

function struct(o: object) {
  if (o === Object.prototype) return
  process.stdout.write(`--- ${o.constructor.name}\n`)
  for (const [n, m] of Object.entries(Object.getOwnPropertyDescriptors(o))) {
    process.stdout.write(` ${n} ${JSON.stringify(m)}\n`)
  }
  struct(Object.getPrototypeOf(o))
}

function runState<E extends { type: string }>(
  state: State<E>,
  method: string,
  queue: ActyxEvent<E>[],
  audit: Auditor<State<E>, E> | undefined,
): State<E> {
  const fun = Object.getPrototypeOf(state)[`on${method}`] as (...a: E[]) => State<E>
  try {
    const s = fun.apply(
      state,
      queue.map((x) => x.payload),
    )
    swallow(audit?.state, deepCopy(s), queue)
    return s
  } catch (err) {
    swallow(audit?.error, deepCopy(state), queue, err)
    return state
  }
}

function handleOrphan<E extends { type: string }>(
  state: State<E>,
  orphan: ActyxEvent<E>,
  audit: Auditor<State<E>, E> | undefined,
) {
  try {
    state.handleOrphan(orphan)
    swallow(audit?.dropped, deepCopy(state), orphan)
  } catch (err) {
    swallow(audit?.error, deepCopy(state), [orphan], err)
  }
}

function swallow<T extends unknown[]>(f: ((...args: T) => void) | undefined, ...args: T) {
  if (f === undefined) return
  try {
    f(...args)
  } catch (e) {
    // ignore
  }
}

export function deepCopy<T>(source: T): T {
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
