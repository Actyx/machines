import { Event } from './event.js'

export type Reaction<
  EventFactoriesTuple extends Event.Factory.Any[],
  EventTuple extends Event.Any[],
  Context extends any,
  RetVal extends any,
> = {
  eventChainTrigger: EventFactoriesTuple
  handler: ReactionHandler<EventTuple, Context, RetVal>
}

export namespace Reaction {
  export const design = <
    EventFactoriesTuple extends Event.Factory.Any[],
    EventTuple extends Event.Any[],
    Context extends any,
    RetVal extends any,
  >(
    eventChainTrigger: EventFactoriesTuple,
    handler: ReactionHandler<EventTuple, Context, RetVal>,
  ): Reaction<EventFactoriesTuple, EventTuple, Context, RetVal> => {
    return {
      eventChainTrigger,
      handler,
    }
  }
}

export type ReactionHandler<
  EventTuple extends Event.Any[],
  Context extends any,
  RetVal extends any,
> = (context: Context, events: EventTuple) => RetVal

export type ReactionMapPrototype<
  Dictionary extends { [key: string]: Reaction<any, any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}
