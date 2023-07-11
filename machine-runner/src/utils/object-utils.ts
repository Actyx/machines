// TODO:
//  specialize T to disallow runtime-dependent primitives
//  such as Function, Symbols, Date
export const jsonDeepCopy = <T>(item: T): T => JSON.parse(JSON.stringify(item))

export function deepCopy<T>(source: T): T {
  if (source instanceof Map)
    return new Map(Array.from(source.entries()).map(([key, val]) => [key, deepCopy(val)])) as T

  if (source instanceof Set) return new Set(Array.from(source).map(deepCopy)) as T

  if (source instanceof Date) return new Date(source) as T

  if (Array.isArray(source)) return source.map(deepCopy) as T

  if (typeof source === 'object' && source) {
    return Object.entries(Object.getOwnPropertyDescriptors(source)).reduce((o, [prop, descr]) => {
      if (typeof descr.get === 'function') {
        throw new Error('cannot deepCopy objects with accessors')
      }
      descr.value = deepCopy(descr.value)
      Object.defineProperty(o, prop, descr)
      return o
    }, Object.create(Object.getPrototypeOf(source)))
  }

  return source
}
