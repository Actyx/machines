import { MachineRunner } from '@actyx/machine-runner'
import { useEffect, useMemo, useState } from 'react'

export namespace MachineRunnerReact {
  const DEFAULT_SYMBOL = Symbol()

  export const use = (runnerFactoryFn: () => MachineRunner, deps: any[] = []) => {
    const agent = useMemo(() => runnerFactoryFn(), deps)
    const [_, setKey] = useState<Symbol>(DEFAULT_SYMBOL)

    useEffect(() => {
      const unsub = agent.channels.change.sub(() => {
        setKey(Symbol())
      })

      return () => {
        unsub()
        agent.destroy()
      }
    }, [agent])

    return agent
  }

  export const useBorrowed = (runner: MachineRunner, deps: any[] = []) => {
    const [_, setKey] = useState<Symbol>(DEFAULT_SYMBOL)

    useEffect(() => {
      const unsub = runner.channels.change.sub(() => {
        setKey(Symbol())
      })

      return () => {
        unsub()
      }
    }, [deps])

    return runner
  }
}
