# Machine Runner

This library offers a TypeScript DSL for writing state machines and executing them in a fully decentralised fashion using the [Actyx](https://developer.actyx.com/) peer-to-peer event stream database.
For an overview of the project this library is part of please refer to [the GitHub repository](https://github.com/Actyx/machines).

The detailed documentation of this library is provided in its JsDoc comments.

## Example usage

We demonstrate the usage of our decentralized state machines on an example from manufacturing automation, i.e. the factory shop floor: a warehouse requests the fleet of logistics robots to pick something up and bring it somewhere else.
Our task is to write the logic for the warehouse and for each of the robots so that the job will eventually be done.
Since there are many robots we use an auction to settle who will do it.

### Declaring the machines

First we define our set of events:

```typescript
// sent by the warehouse to get things started
const requested = Event.design('requested')
  .withPayload<{ id: string; from: string; to: string }>()
// sent by each available candidate robot to register interest
const bid = Event.design('bid')
  .withPayload<{ robot: string; delay: number }>()
// sent by the robots
const selected = Event.design('selected')
  .withPayload<{ winner: string }>()

// declare a precisely typed tuple of all events we can now choose from
const transportOrderEvents = [requested, bid, selected] as const
```

Then we can declare a swarm protocol using these events:

```typescript
const transportOrder = SwarmProtocol.make('transportOrder', transportOrderEvents)
```

Now we build two machines that participate in this protocol: the `warehouse` will request the material transport, while the fleet of `robot` will figure out who does it.
The `warehouse` is much simpler in this initial part of the workflow since it has no further role after making the request — in a real implementation the protocol would go on to include the actual delivery.

```typescript
// initialize the state machine builder for the `warehouse` role
const TransportOrderForWarehouse =
  transportOrder.makeMachine('warehouse')

// add initial state with command to request the transport
export const InitialWarehouse = TransportOrderForWarehouse
  .designState('Initial')
  .withPayload<{ id: string }>()
  .command('request', [requested], (ctx, from: string, to: string) =>
                                   [{ id: ctx.self.id, from, to }])
  .finish()

export const DoneWarehouse = TransportOrderForWarehouse.designEmpty('Done').finish()

// describe the transition into the `Done` state after request has been made
InitialWarehouse.react([requested], DoneWarehouse, (_ctx, _r) => [{}])
```

The `robot` state machine is constructed in the same way, albeit with more commands and state transitions:

```typescript
const TransportOrderForRobot = transportOrder.makeMachine('robot')

type Score = { robot: string; delay: number }
type AuctionPayload =
  { id: string; from: string; to: string; robot: string; scores: Score[] }

export const Initial = TransportOrderForRobot.designState('Initial')
  .withPayload<{ robot: string }>()
  .finish()
export const Auction = TransportOrderForRobot.designState('Auction')
  .withPayload<AuctionPayload>()
  .command('bid', [bid], (ctx, delay: number) =>
                         [{ robot: ctx.self.robot, delay }])
  .command('select', [selected], (_ctx, winner: string) => [{ winner }])
  .finish()
export const DoIt = TransportOrderForRobot.designState('DoIt')
  .withPayload<{ robot: string; winner: string }>()
  .finish()

// ingest the request from the `warehouse`
Initial.react([requested], Auction, (ctx, r) => ({
  ...ctx.self,
  ...r.payload,
  scores: [],
}))

// accumulate bids from all `robot`
Auction.react([bid], Auction, (ctx, b) => {
  ctx.self.scores.push(b.payload)
  return ctx.self
})

// end the auction when a selection has happened
Auction.react([selected], DoIt, (ctx, s) =>
  ({ robot: ctx.self.robot, winner: s.payload.winner }))
```

### Checking the machines

<img src="https://raw.githubusercontent.com/Actyx/machines/62fbda79d27a71260159c2688f0f57ef4c9e13ca/machine-runner/example-workflow.png" alt="workflow" width="300" />

The part of the transport order workflow implemented in the previous section is visualized above as a UML state diagram.
With the `@actyx/machine-check` library we can check that this workflow makes sense (i.e. it achieves eventual consensus, which is the same kind of consensus used by the bitcoin network to settle transactions), and we can also check that our state machines written down in code implement this workflow correctly.

To this end, we first need to declare the graph in JSON notation:

```typescript
const proto: SwarmProtocolType = {
  initial: 'initial',
  transitions: [
    { source: 'initial', target: 'auction',
      label: { cmd: 'request', logType: ['requested'], role: 'warehouse' } },
    { source: 'auction', target: 'auction',
      label: { cmd: 'bid', logType: ['bid'], role: 'robot' } },
    { source: 'auction', target: 'doIt',
      label: { cmd: 'select', logType: ['selected'], role: 'robot' } },
  ]
}
```

The naming of states does not need to be the same as in our code, but the event type names and the commands need to match.
With this preparation, we can perform the behavioral type checking as follows:

```typescript
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from '@actyx/machine-check'

const robotJSON =
  TransportOrderForRobot.createJSONForAnalysis(Initial)
const warehouseJSON =
  TransportOrderForWarehouse.createJSONForAnalysis(InitialWarehouse)
const subscriptions = {
  robot: robotJSON.subscriptions,
  warehouse: warehouseJSON.subscriptions,
}

// these should all print `{ type: 'OK' }`, otherwise there’s a mistake in
// the code (you would normally verify this using your favorite unit
// testing framework)
console.log(
  checkSwarmProtocol(proto, subscriptions),
  checkProjection(proto, subscriptions, 'robot', robotJSON),
  checkProjection(proto, subscriptions, 'warehouse', warehouseJSON),
)
```

### Running the machines

`@actyx/machine-runner` relies upon [Actyx](https://developer.actyx.com) for storing/retrieving events and sending them to other nodes in the swarm.
In other words, Actyx is the middleware that allows the `warehouse` and `robot` programs on different computers to talk to each other, in a fully decentralized peer-to-peer fashion and without further coordination — for maximum resilience and availability.
Therefore, before we can run our machines we need to use the Actyx SDK to connect to the local Actyx service:

```typescript
const actyx = await Actyx.of(
  { appId: 'com.example.acm', displayName: 'example', version: '0.0.1' })
const tags = transportOrder.tagWithEntityId('4711')
const robot1 = createMachineRunner(actyx, tags, Initial, { robot: 'agv1' })
const warehouse = createMachineRunner(actyx, tags, InitialWarehouse,
                                      { id: '4711' })
```

The `tags` can be thought of as the name of a [dedicated pub–sub channel](https://developer.actyx.com/docs/conceptual/tags) for this particular workflow instance.
We demonstrate how to create both a robot and the warehouse, even though you probably won’t do that on the same computer in the real world.

Getting the process started means interacting with the state machines:

```typescript
for await (const state of warehouse) {
  if (state.is(InitialWarehouse)) {
    await state.cast().commands?.request('from', 'to')
  } else {
    // this role is done
    break
  }
}
```

The `warehouse` machine implements the [async iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols) JavaScript protocol, which makes it conveniently consumable using a `for await (...)` loop.
Exiting this loop, e.g. using `break` as shown, will destroy the `warehouse` running machine, including cancelling the underlying Actyx event subscription for live updates.

Using the `robot` role we demonstrate a few more features of the machine runner:

```typescript
let IamWinner = false

for await (const state of robot1) {
  if (state.is(Auction)) {
    const open = state.cast()
    if (!open.payload.scores.find((s) => s.robot === open.payload.robot)) {
      await open.commands?.bid(1)
      setTimeout(() => {
        const open = robot1.get()?.as(Auction)
        open && open.commands?.select(bestRobot(open.payload.scores))
      }, 5000)
    }
  } else if (state.is(DoIt)) {
    const assigned = state.cast()
    IamWinner = assigned.payload.winner === assigned.payload.robot
    if (!IamWinner) break
    // now we have the order and can start the mission
  }
}
```

The first one is that the accumulated state is inspected in the `state.is(Auction)` case to see whether this particular robot has already provided its bid for the auction.
If not, it will do so by invoking a command, which will subsequently lead to the emission of a `bid` event and consequently to a new state being emitted from the machine, so a new round through the `for await` loop — this time we’ll find our bid in the list, though.

The second part is that upon registering our bid, we also set a timer to expire after 5sec.
When that happens we synchronously check the _current_ state of the workflow (since it will have changed, and if some other robot got to this part first, the auction may already be over).
If the workflow still is in the `Auction` state, we compute the best robot bid (the logic in `bestRobot` is where _your expertise_ would go) and run the `select()` command to emit the corresponding event and end the auction.

The third feature becomes relevant once the auction has ended: we check if our robot is indeed the winner and record that in a variable `IamWinner`, i.e. in the current application in-memory state.
Then we can use this information in all following states as well.

### Change detection on for-await loop

When using a for-await loop with the machine runner, the loop iterates only if all of the following criteria are met:

- A 'caughtUp' event is emitted; It happens when the machine runner receives the latest event published in Actyx;
- An event between the current `caughtUp` and the previous one triggers a change to the machine's state; The state change is determined by comparing the name and payload between the state before and after the `caughtUp` event. The comparison uses the `deepEqual` function provided by the [fast-equal package](https://www.npmjs.com/package/fast-equals).

### The consequences of Eventual Consensus

The design goal of Actyx and the machine runner is to provide uncompromising resilience and availability, meaning that if a device is capable of computation it shall be able to make progress, independent of the network.
This implies that two devices that are not currently connected (which also includes the brief time lag introduced by ping times between them!) can make contradicting choices in a workflow.

In the example above, we deliberately didn’t use a `manager` or `referee` role to select the winner in the auction, since that decision maker would be a single-point-of-failure in the whole process.
Instead, each robot independently ensures that after at five seconds a decision will be made — even if two robots concurrently come to different conclusions and both emit a `selected` event.

Machine runner resolves this conflict by using only the `selected` event that comes first in the Actyx event sort order; in other words, Actyx arbitrarily picks a winner and the losing event is discarded.
If a robot saw itself winning, started the mission, and then discovers that its win turned out to be invalid, it will have to stop the mission and pick a new one.

## Features

### Observe Changes and Errors

An alternative use case of a machine runner is to listen to its events.

The `next` event emits states whenever a new state is calculated.
When not using the machine, calling `destroy` is required to close the connection to Actyx.

```typescript
const warehouse = createMachineRunner(actyx, tags, InitialWarehouse, { id: '4711' })

warehouse.events.on('next', (state) => {
  if (state.is(InitialWarehouse)) {
    // ...
  }
})

await untilWareHouseIsNotUsedAnymore()

warehouse.destroy()
```

`error` event can be used to capture errors from machine-runner.

```
import {
  MachineRunnerErrorCommandFiredAfterLocked,
  MachineRunnerErrorCommandFiredAfterDestroyed,
  MachineRunnerErrorCommandFiredAfterExpired,
} from "@actyx/machine-runner"

warehouse.events.on('error', (error) => {
  if (error instanceof MachineRunnerErrorCommandFiredAfterLocked) {
    //
  }
  
  if (error instanceof MachineRunnerErrorCommandFiredAfterDestroyed) {
    //
  }

  if (error instanceof MachineRunnerErrorCommandFiredAfterExpired) {
    //
  }
})
```

#### Event List

##### `next`

A `next` event is emitted when a state transition happens and the machine runner has processed all events matching the supplied tag.

The payload is `StateOpaque`, similar to the value produced in the `for-await` loop. 

##### `error`

An `error` event is emitted when an error happened inside the runner. Currently this is the list of the errors:
- A command is called when locked i.e. another command is being issued in the same machine
- A command is called when the corresponding state is expired i.e. another command has been successfully issued from that state
- A command is called on a destroyed machine

The payload has an error subtype.

##### `change`

A `change` event is emitted when a `next` event is emitted, a command is issued, a command is published, or subscription error happened due to losing a connection to Actyx. This event is particularly useful in UI code where not only state changes are tracked, but also command availability and errors.

The payload is `StateOpaque`, similar to the value produced in the `for-await` loop. 

##### `debug.bootTime`

A `debug.bootTime` event is emitted when a machine runner have caught up with an Actyx subscriptions (i.e. finished processing its events until the latest one) for the first time.

The payload includes information on the duration of the booting, the number of events processed, and the identity containing the swarm name, machine name, and tags.

```typescript
// Logs every time a machine booting takes more than 100 milliseconds or processed more than 100 events
machine.events.on(
  'debug.bootTime',
  ({ durationMs, eventCount, identity: { machineName, swarmProtocolName, tags } }) => {
    if (durationMs > 100 || eventCount > 100) {
      console.warn(
        `Boot of "${swarmProtocolName}-${machineName}" tagged "${tags.toString()}" takes longer than usual (${durationMs} milliseconds of to process ${eventCount} events)`,
      )
    }
  },
)
```

### Zod on MachineEvent

[Zod](https://zod.dev/) can be used to define and validate MachineEvents. On designing an event, use `withZod` instead of `withPayload`.

```typescript
export const requested = MachineEvent.design('requested').withPayload<{
  id: string
  from: string
  to: string
}>()
```

The above code can be converted into:

```typescript
import * as z from 'zod'

export const requested = MachineEvent.design('requested').withZod(
  z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
  }),
)
```

A zod-enabled event factory will have these additional features enabled:

- When receiving events from Actyx, a `MachineRunner` will compare the event payload to the embedded `ZodType`, in addition to the mandatory event type checking. Events that don't match the defined `MachineEvent` on the reaction will be ignored by the `MachineRunner`. For example, see the reaction definition below:
  ```typescript
  InitialWarehouse.react([requested], DoneWarehouse, (_ctx, _r) => [{}])
  ```
  In a scenario where an incorrectly created event comes from Actyx `{ "type": "requested", id: "some_id" }`, the said event will not be regarded as valid and will be ignored.
- When creating an event via the factory, which would be `requested.make` for the example above, an extra step will be taken to validate the payload. When the `make` method is called with an incorrect value, an exception will be thrown because internally `ZodType.parse` is used to validate the payload. For example:

  ```typescript
  // Will throw because `{}` is not a valid value for the previously provided zod schema
  // But it takes `as any` to bypass TypeScript compiler in order to do this
  const singleEvent = requested.make({} as any)
  ```

  An extra care must be taken when the `ZodType` is [refined](https://zod.dev/?id=refine). In contrast to a mismatch in schema, a refined `ZodType` is not caught at compile-time. Therefore, a compilation process and IDE warnings is not sufficient to catch these errors. For example:

  ```typescript
  export const requested = MachineEvent.design('requested').withZod(
    z
      .object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
      })
      .refine((payload) => {
        return payload.from == payload.to
      }),
  )

  // Will throw exception because `from` is same with `to`.
  // This mistake can't be caught by TypeScript compiler
  requested.make({
    id: 'some_id',
    from: 'some_location',
    to: 'some_location',
  })
  ```

### Global Event Emitter

Some global event emitters are provided.
These event emitters will emit events from all machine runners in the same process.

```typescript
import { globals as machineRunnerGlobals } from "@actyx/machine-runner";

globals.emitter.addListener("debug.bootTime", ({ identity, durationMs, eventCount }) => {
  if (durationMs > 100) {
    console.warn(`${identity} boot time takes more than 100ms (${durationMs}ms) processing ${eventCount} events`);
  }
});

globals.emitter.addListener("error", console.error);
```

### Extra Tags

In the case extra tags are required to be attached in events when invoking commands, extra tags can be registered on a command definition. These extra tags will always be attached when the command is invoked.

```typescript
// State definition
export const InitialWarehouse = TransportOrderForWarehouse.designState('Initial')
  .withPayload<{ id: string }>()
  .command('request', [requested], (ctx, from: string, to: string) => {
    return [
      ctx.withTags(
        [`transport-order-from:${from}`, `transport-order-to:${to}`],
        { id: ctx.self.id, from, to }
      )
    ]
  })
  .finish()

// Command call
// The resulting events will include the extra tags
// `transport-order-from:${from}`,
// `transport-order-to:${to}`
const stateAsInitialWarehouse = state
  .as(InitialWarehouse)?
  .commands?
  .request(from: `source`, to: `destination`);
```

### `refineStateType`

A `MachineRunner` instance now has a new method available: `refineStateType` which return a new aliasing machine.
State payload produced by the returned machine is typed as the **union of all possible payload types** instead of `unknown`.
The union is useful to be used in combination with [type-narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).

Usage example:

```typescript
// States defined in previous examples
const allStates = [Initial, Auction, DoIt] as const
const machine = createMachineRunner(actyx, tags, Initial, { robot: 'agv1' }).refineStateType(
  allStates,
)

const state = machine.get()
if (state) {
  const payload = state.payload

  // Equals to:
  //  | { robot: string }
  //  | { id: string; from: string; to: string; robot: string; scores: Score[] }
  //  | { robot: string; winner: string }
  type PayloadType = typeof state.payload

  // 'robot' property is accessible directly because it is available in all variants
  const robot = payload.robot

  // Used with type-narrowing
  if ('winner' in payload) {
    // here the type of payload is narrowed to { robot: string; winner: string }
  } else if ('id' in payload) {
    // here the type of payload is narrowed to { id: string; from: string; to: string; robot: string; scores: Score[] }
  } else {
    // here the type of payload is narrowed to { robot: string }
  }
}
```

The argument to `.refineStateType` must be an array containing all previously defined states.
Any other argument will throw an error.

The aliasing machine shares the original machine's internal state.
All method calls, such as `.destroy`, create the same effect as when enacted on the original machine.

## Developer support

If you have any questions, suggestions, or just want to chat with other interested folks, you’re welcome to join our discord chat. Please find a current invitation link on [the top right of the Actyx docs page](https://developer.actyx.com/).
