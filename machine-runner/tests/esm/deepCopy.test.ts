import { describe, expect, it } from '@jest/globals'
import { deepCopy } from '../../lib/esm/utils/object-utils.js'

describe('deepCopy', () => {
  it('should copies primitives', () => {
    expect(true).toBe(true)
    expect(false).toBe(false)
    expect(null).toBe(null)
    expect(undefined).toBe(undefined)
    expect(deepCopy(1)).toBe(1)
    expect(deepCopy(BigInt('1'))).toBe(BigInt('1'))
    expect(deepCopy('helloworld')).toBe('helloworld')
    const SOME_SYMBOL = Symbol()
    expect(SOME_SYMBOL).toBe(SOME_SYMBOL)
  })

  it('copies arrays and keyed collections', () => {
    expect(deepCopy([1, 2, 3])).toEqual([1, 2, 3])
    expect(deepCopy([1, { a: 'b' }, [1, 2, 3]])).toEqual([1, { a: 'b' }, [1, 2, 3]])
    expect(deepCopy([null, true, 5, 'world'])).toEqual([null, true, 5, 'world'])
    ;(() => {
      const someObject = { b: 'asdfasdf' }
      const setContent = [1, 2, 3, someObject, 'asdf']
      const setA = new Set(setContent)
      const setB = deepCopy(setA)
      expect(setA).not.toBe(setB)
      expect(setB.has(1)).toBe(true)
      expect(setB.has(2)).toBe(true)
      expect(setB.has(3)).toBe(true)
      expect(setB.has(someObject)).toBe(false) // not ===
      expect(setB.has('asdf')).toBe(true)
    })()
    ;(() => {
      const someObject = { b: 'asdfasdf' }
      const mapA = new Map<any, any>([
        [1, '1'],
        ['1', 'someString'],
        ['2', someObject],
        ['3', [1, 2, 3, 4]],
      ])
      const mapB = deepCopy(mapA)
      expect(mapA).not.toBe(mapB)
      expect(mapA.size).toBe(mapB.size)
      expect(mapA.get(1)).toBe(mapB.get(1))
      expect(mapA.get('1')).toBe(mapB.get('1'))
      expect(mapA.get('2')).not.toBe(mapB.get('2'))
      expect(mapA.get('2')).toEqual(mapB.get('2'))
      expect(mapA.get('3')).not.toBe(mapB.get('3'))
      expect(mapA.get('3')).toEqual(mapB.get('3'))
    })()
  })

  it('should copy objects', () => {
    expect({ a: '5' }).not.toEqual({ a: 5 }) // just double-checking jest here
    expect(deepCopy({ 0: true, a: '5' })).toEqual({ '0': true, a: '5' }) // JS only has string keys
  })

  it('should copy functions', () => {
    let v = 42
    const f = () => v
    const c = deepCopy(f)
    expect(c()).toBe(42)
    v = 5
    expect(c()).toBe(5)
    const x = deepCopy({ f })
    expect(x.f()).toBe(5)
    v = 6
    expect(x.f()).toBe(6)
  })
})
