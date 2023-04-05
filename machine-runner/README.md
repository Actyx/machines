# Machine Runner

This library offers a TypeScript DSL for writing state machines and executing them in a fully decentralised fashion using the [Actyx](https://developer.actyx.com/) peer-to-peer event stream database.
For an overview of the project this library is part of please refer to [the GitHub repository](https://github.com/Actyx/machines).

The detailed documentation of this library is provided in its JsDoc comments.

## Example usage

First we define our set of events:

```typescript
const mkTuple = <T extends unknown[]>(...args: T) => args

namespace Events {
  export const Opened = MachineEvent.design('opened').withoutPayload()
  export const Closed = MachineEvent.design('closed').withoutPayload()
  export const Opening = MachineEvent.design('opening').withPayload<{ fractionOpen: number }>()
  export const Closing = MachineEvent.design('closing').withPayload<{ fractionOpen: number }>()

  export const all = mkTuple(Opened, Closed, Opening, Closing)
}
```

Then we can declare a swarm protocol using these events:

```typescript
const HangarBay = SwarmProtocol.make('HangarBay', ['hangar-bay'], Events.all)
```

Now we build two machines that participate in this protocol: the `Control` will tell the door when to move, while the `Door` will register updates as to what it is doing.

Here we put the `Door` into a TypeScript namespace, you might want to put each machine into a separate file in your own code.

```typescript
namespace Door {
  const Door = HangarBay.makeMachine('door')

  const Open = Door.designEmpty('Open').finish()
  const Closing = Door.designState('Closing')
    .withPayload<{ fractionOpen: number }>()
    .command('update', [Events.Closing], (_ctx, fractionOpen: number) => [{ fractionOpen }])
    .command('closed', [Events.Closed], (_ctx) => [{}])
    .finish()
  const Closed = Door.designEmpty('Closed').finish()
  const Opening = Door.designState('Opening')
    .withPayload<{ fractionOpen: number }>()
    .command('update', [Events.Opening], (_ctx, fractionOpen: number) => [{ fractionOpen }])
    .command('open', [Events.Opened], (_ctx) => [{}])
    .finish()

  Open.react([Events.Closing], Closing, (_ctx, closing) => ({
    fractionOpen: closing.payload.fractionOpen,
  }))
  Closing.react([Events.Closing], Closing, (ctx, closing) => {
    ctx.self.fractionOpen = closing.payload.fractionOpen
    return ctx.self
  })
  Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
  Closed.react([Events.Opening], Opening, (_ctx, opening) => ({
    fractionOpen: opening.payload.fractionOpen,
  }))
  Opening.react([Events.Opening], Opening, (ctx, opening) => {
    ctx.self.fractionOpen = opening.payload.fractionOpen
    return ctx.self
  })
  Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
}
```

And finally the `Control`’s machine:

```typescript
namespace Control {
  const Control = HangarBay.makeMachine('control')

  const Open = Control.designEmpty('Open')
    .command('close', [Events.Closing], (_ctx) => [{ fractionOpen: 1 }])
    .finish()
  const Closing = Control.designState('Closing').withPayload<{ fractionOpen: number }>().finish()
  const Closed = Control.designEmpty('Closed')
    .command('open', [Events.Opening], (_ctx) => [{ fractionOpen: 0 }])
    .finish()
  const Opening = Control.designState('Opening').withPayload<{ fractionOpen: number }>().finish()

  Open.react([Events.Closing], Closing, (_ctx, closing) => ({
    fractionOpen: closing.payload.fractionOpen,
  }))
  Closing.react([Events.Closing], Closing, (ctx, closing) => {
    ctx.self.fractionOpen = closing.payload.fractionOpen
    return ctx.self
  })
  Closing.react([Events.Closed], Closed, (_ctx, _closed) => [{}])
  Closed.react([Events.Opening], Opening, (_ctx, opening) => ({
    fractionOpen: opening.payload.fractionOpen,
  }))
  Opening.react([Events.Opening], Opening, (ctx, opening) => {
    ctx.self.fractionOpen = opening.payload.fractionOpen
    return ctx.self
  })
  Opening.react([Events.Opened], Open, (_ctx, _open) => [{}])
}
```

Notice how the machines are deterministic at the type-level: instead of putting a conditional transition into the Closing state (e.g. by checking whether `fractionOpen === 0`) we need two separate named events `Closing` and `Closed` to allow our machine to transition to different target states.

For examples on how to run such machines, please refer to the [`dev-example` folder](https://github.com/Actyx/machines/tree/master/dev-example/src/App.tsx#L15-L18) on GitHub.
