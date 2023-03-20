/**
 * Utility to help centralize destruction-related mechanism such as
 * marking an object as destroyed, invoking previously registered
 * cleanup functions, and guarding cleanup to be invoked once.
 */
export type Destruction = ReturnType<typeof Destruction['make']>

export namespace Destruction {
  export const make = () => {
    let destroyed = false
    const cleanup = Cleanup.make()
    return {
      addDestroyHook: cleanup.add,
      isDestroyed: () => destroyed,
      destroy: () => {
        if (!destroyed) {
          destroyed = true
          return cleanup.clean()
        }
        return undefined
      },
    }
  }
}

/**
 * Utility to collect a set of functions that will be called when
 * "clean" method is called.
 */
export type Cleanup = ReturnType<typeof Cleanup['make']>

export namespace Cleanup {
  export const make = () => {
    const fns = new Set<() => void>()
    return {
      add: (fn: () => void) => {
        fns.add(fn)
      },
      clean: (): void => {
        for (const fn of fns) {
          try {
            return fn()
          } catch (error) {
            console.error('error while cleaning up a machine:', error)
          }
        }
      },
    }
  }
}
