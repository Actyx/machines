import { Protocol } from './api2/protocol.js'
import { Event } from './api2/state-machine.js'
export * from './api2utils/agent.js'
export * from './api2/runner.js'
export * from './api2/protocol.js'

// Example Implementation

const Toggle = Event.design('Toggle').withPayload<{ previousTimesToggled: number }>()
const Toggle2 = Event.design('Toggle2').withPayload<{ previousTimesToggled: number }>()

// type Builder<Proto, Events, Command extends MappedType, S> = {
//   command:
//       <Name extends string,
//        Events extends Events[],
//        Args extends any[]
//       >(
//            name: Name,
//            events: Events,
//            f: (self: State, ...args: Args) => TypesOf<Events>
//        ) => Builder<Proto, Command & { [Name keyof in Name]: ExecutableCommand.Of<Command> }>
//   react: <
//       Events extends Proto.Event[],
//       Next extends State<Proto, any, any>
//   >(events: Events, next: Next, fn: (...events: TypesOf<Events>) => ReturnType<Next['make']>) => Builder<Proto, Command, S>
//   finish: () => State<Proto, Command, S>
// }

// type State<Proto, Command, S> = {
//   make: (...args: Constructor) => X
// }

// namespace Protocol {
//   export const make: <Name extends string, Events extends any[]>(name: Name, events: Events) => Protocol<Name, Events>
// }
// type Protocol<Name, Events> = {
//   designState: <Name extends string, State, Args extends any[]>(name: Name, fn: (...args: Args) => State) => Builder<Self, {}, State>
//   designEmpty: <Name extends string>(name: Name) => Builder<Self, {}, void>
// }

// const proto = Protocol.design('taxiRide', [events...])

// const InitialP = proto.designEmpty('Initial')
//     .command('Request', [Requested], (state, from: string, to: string) => [{ from, to }, {}, {}])
//     .react([Requested, Bid, BidderId], AuctionP, (req, bid, id) => AuctionP.make())

// type Context<State> = {
//     self: State

//     // ... functions to expose from the machine runner
// }

const protocol = Protocol.make('switch', [Toggle])

const Open = protocol
  .designState('Open')
  .withPayload<{ timesToggled: number }>()
  .command('close', [Toggle], (context) => [{ previousTimesToggled: context.self.timesToggled }])
  .finish()

const Close = protocol
  .designState('Closed')
  .withPayload<{ timesToggled: number }>()
  .command('open', [Toggle], (context) => [{ previousTimesToggled: context.self.timesToggled }])
  .finish()

const Empty = protocol.designEmpty('Empty').finish()

Empty.make()

// Reaction design phase
// ===========================

Open.react([Toggle], Close, (context, [toggle]) => {
  return { timesToggled: 1 }
})

Open.react([Toggle], Open, (context, [toggle]) => {
  return context.self
})

// MUST COMPILE ERROR
// Open.react([Toggle], Close, (context, [toggle]) => {
//   return Open.make()
// })

// MUST COMPILE ERROR
// Close.react([Toggle2], Open, (context, [toggle]) => {
//   return null as any
// })

// const transparentState = Open.make({ timesToggled: 1 })
// transparentState.commands.close()

// const opaqueState = Close.makeOpaque()

// const stateOnClose = opaqueState.as(Close)
// if (stateOnClose) {
//   stateOnClose.commands.open()

//   // MUST COMPILE ERROR
//   // stateOnClose.commands.anotherCommand(1)
// }
