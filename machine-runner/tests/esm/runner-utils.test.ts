import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { makeEmitter } from '../../lib/esm/runner/runner-utils.js'
import { createBufferLog } from './helper.js'

const bufferLog = createBufferLog()
let originalConsoleError: typeof console['error'] = console.error

beforeAll(() => {
  console.error = bufferLog.log
})
afterAll(() => {
  console.error = originalConsoleError
})

describe('throw-ignoring event emitter', () => {
  it('should continue calling the other listeners when one throws', () => {
    const emitter = makeEmitter()

    const content = 'content'

    let one: unknown = null
    let two: unknown = null
    let three: unknown = null
    let four: unknown = null
    emitter.on('log', (x) => {
      one = x
    })
    emitter.on('log', (x) => {
      two = x
      throw new Error('some error')
    })
    emitter.on('log', (x) => {
      three = x
      throw new Error('some error')
    })
    emitter.on('log', (x) => {
      four = x
    })

    emitter.emit('log', content)

    expect(one).toBe(content)
    expect(two).toBe(content)
    expect(three).toBe(content)
    expect(four).toBe(content)
    expect(bufferLog.get()).toBeTruthy()
  })

  it('should work with .once', () => {
    const emitter = makeEmitter()
    let lastLog = ''

    emitter.once('log', (x) => {
      lastLog = x
    })

    emitter.emit('log', 'one')
    emitter.emit('log', 'two')

    expect(lastLog).toBe('one')
  })
})
