// import { useEffect, useMemo, useState } from 'react'
// import { Agent } from './agent.js'

// export { Agent } from './agent.js'

// export namespace AgentReact {
//   const DEFAULT_SYMBOL = Symbol()

//   export const use = <API extends Agent.DefaultAPI, Channels extends Agent.DefaultChannels>(
//     factoryFn: () => Agent<API, Channels>,
//     deps: any[] = [],
//   ) => {
//     const agent = useMemo(() => factoryFn(), deps)
//     const [_, setKey] = useState<Symbol>(DEFAULT_SYMBOL)

//     useEffect(() => {
//       const unsub = agent.channels.change.sub(() => {
//         setKey(Symbol())
//       })

//       return () => {
//         unsub()
//         agent.destroy()
//       }
//     }, [agent])

//     return agent
//   }
// }
