import { Event } from './event.js'

export type Reaction<
  EventFactoriesTuple extends Event.Factory.NonZeroTuple,
  Self extends any,
  RetVal extends any,
> = {
  eventChainTrigger: EventFactoriesTuple
  handler: ReactionHandler<EventFactoriesTuple, Self, RetVal>
}

export namespace Reaction {
  export const design = <
    EventFactoriesTuple extends Event.Factory.NonZeroTuple,
    Self extends any,
    RetVal extends any,
  >(
    eventChainTrigger: EventFactoriesTuple,
    handler: ReactionHandler<EventFactoriesTuple, Self, RetVal>,
  ): Reaction<EventFactoriesTuple, Self, RetVal> => {
    return {
      eventChainTrigger,
      handler,
    }
  }
}

export type ReactionHandler<
  EventFactoriesTuple extends Event.Factory.NonZeroTuple,
  Self extends any,
  RetVal extends any,
> = (self: Self, events: Event.Factory.MapToEvent<EventFactoriesTuple>) => RetVal

export type ReactionMapPrototype<Dictionary extends { [key: string]: Reaction<any, any, any> }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
