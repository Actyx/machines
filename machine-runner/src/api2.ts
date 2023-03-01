import {
  StateMechanismMap,
  StateConstructorToPayloadConstructor,
  StateConstructor,
  StateMechanism,
  Event,
  PayloadConstructor,
} from './api2.internals.js'
import type { DeepReadonly } from './api2.utils.js'

export type Protocol<Mechanism extends StateMechanismMap<{}>> = {
  states: DeepReadonly<Mechanism>
}

export type ProtocolDesigner<
  AllowedEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
> = {
  designState: <StateName extends string, Args extends any[], Payload extends any>(
    stateName: StateName,
    constructor: StateConstructorToPayloadConstructor<StateConstructor<StateName, Args, Payload>>,
  ) => StateMechanism<AllowedEvents, StateName, Args, Payload, {}>

  /**
   * For unit test purpose
   * TODO: actually write the unit tests with it
   */
  // [ProtocolDesigner.DEBUG_SYMBOL_GET_INTERNAL]: () => DeepReadonly<ProtocolInternals<Mechanism>>
}

export namespace ProtocolDesigner {
  export const DEBUG_SYMBOL_GET_INTERNAL: unique symbol = Symbol('GET_INTERNAL')
  export type DEBUG_SYMBOL_GET_INTERNAL = typeof DEBUG_SYMBOL_GET_INTERNAL

  export const init = () => makeDesignerEventCatalog()

  export type DesignerEventCatalog<
    AllowedEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
  > = {
    withEvents: <NewEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]]>(
      eventFactories: NewEvents,
    ) => DesignerEventCatalog<NewEvents>
    finalize: () => ProtocolDesigner<AllowedEvents>
  }

  const makeDesignerEventCatalog = <
    AllowedEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
  >(): DesignerEventCatalog<AllowedEvents> => {
    const withEvents: DesignerEventCatalog<AllowedEvents>['withEvents'] = (_) =>
      makeDesignerEventCatalog()
    const finalize = () => makeProtocolDesigner<AllowedEvents>()

    return {
      withEvents,
      finalize,
    }
  }

  const makeProtocolDesigner = <
    AllowedEvents extends [Event.Factory<any, any>, ...Event.Factory<any, any>[]],
  >(): ProtocolDesigner<AllowedEvents> => {
    const designState: ProtocolDesigner<AllowedEvents>['designState'] = <
      StateName extends string,
      Args extends any[],
      Payload extends any,
    >(
      stateName: StateName,
      constructor: PayloadConstructor<Args, Payload>,
    ) =>
      StateMechanism.make<AllowedEvents, StateName, Args, Payload, {}>(stateName, constructor, {})

    return {
      designState,
    }
  }
}

// This is the new API
// No implementation yet
// Only type definition
// But it is planned to be able to do all current machine-runner version is capable of

// Defining Events

const Bid = Event.design('Bid').withPayload<{ price: number; time: Date }>()
const BidderID = Event.design('BidderID').withPayload<{ id: string }>()
const Requested = Event.design('Requested').withPayload<{
  pickup: string
  destination: string
}>()

// This is how to define Events

// Defining protocol (this will be used as the "brain" of a machine-runner instance)

// These are "allowed Events", events that are not allowed will not be able to be used as a reaction

const protocol = ProtocolDesigner.init().withEvents([Requested, Bid, BidderID]).finalize()

// Defining the state (not mature yet, will change a lot)
// IMPORTANT: add capability to instantiate

const AuctionP = protocol
  .designState('InitialP', () => null)
  .addReaction(
    // These are event sequence to be captured
    [BidderID, Requested, Bid],
    ([requested, bid, bidderId]) => {
      // use the params in the handler function
    },
  )
  // Param will match with the call signature below
  .addCommand('Request', (price: number, time: Date) => {
    const bidInstance = Bid.new({
      price: price,
      time: new Date(),
    })

    // TODO: return syntax might not be accurate
    return [bidInstance]
  })
  .addCommand('OtherCommand', () => {
    return [
      Requested.new({
        destination: '',
        pickup: 'asdf',
      }),
    ]
  })

// Downside: uses builderpattern, so someone might  forget to chain the function calls and some commands are not detected

// Below is an example of how commands that have been registered are captured in the type system

// Can be called, param matches with the definition above
AuctionP.commands.Request(1, new Date())
AuctionP.commands.OtherCommand()

// Next: add capability for a State to be instantiated, the above code doesn't show the state being
// Instantiated.
// Next: add integration with React, ideas for native hooks, etc.

type EventOfProtocol<T> = T extends ProtocolDesigner<infer X> ? X : never
type ProtocolEvents = EventOfProtocol<typeof protocol>
type ProtocolEventsAsUnion = Event.Factory.ReduceToEvent<[typeof BidderID, typeof Requested]>
