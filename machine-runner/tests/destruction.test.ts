import { describe, expect, it } from '@jest/globals'
import { Cleanup, Destruction } from '../lib/utils/destruction.js'

describe('Cleanup', () => {
  it('should call all registered functions', () => {
    const boolflags = new Array(1 + Math.floor(Math.random() * 100)).fill(false)

    const cleanup = Cleanup.make()
    boolflags.forEach((_, index) => {
      cleanup.add(() => {
        boolflags[index] = true
      })
    })

    cleanup.clean()
    const sliceOfFalses = boolflags.filter((supposedTrue) => !supposedTrue)

    expect(sliceOfFalses.length).toBe(0)
  })
})

describe('Destruction', () => {
  it('should call all registered function on destroy once', () => {
    const numflags = new Array(1 + Math.floor(Math.random() * 100)).fill(0)

    const destruction = Destruction.make()
    numflags.forEach((_, index) => {
      destruction.addDestroyHook(() => {
        numflags[index] += 1
      })
    })
    destruction.destroy()

    expect(numflags.filter((num) => num === 1)).toHaveLength(numflags.length)

    destruction.destroy()

    // Second destroy should not call the destroy hook again
    expect(numflags.filter((num) => num === 1)).toHaveLength(numflags.length)
  })

  it('should flag the destroyed status correctly', () => {
    const destruction = Destruction.make()
    expect(destruction.isDestroyed()).toBe(false)
    destruction.destroy()
    expect(destruction.isDestroyed()).toBe(true)
    destruction.destroy()
    expect(destruction.isDestroyed()).toBe(true)
  })
})
