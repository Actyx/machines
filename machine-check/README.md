# Machine Check

This library allows you to check whether the machines you implement with [machine-runner](https://www.npmjs.com/package/@actyx/machine-runner) comply with a correct overall swarm behaviour.
Before we dive into how to use it, we need to quickly establish some notation.

## Swarm Protocols

Just like the workflow diagrams you put on a whiteboard to discuss how your product should work, we describe swarm behaviour in terms of a [_state machine_](https://en.wikipedia.org/wiki/Finite-state_machine).
This is a fancy word for saying that we start with an initial state and whenever something happens we follow an arrow on the diagram to get to the next state.
Sometimes there are several choices for what can happen next, meaning that the protocol can proceed via one of several charted paths; these can loop back to an earlier state or rejoin to move forward together later.

TODO: _add graph_

While the graphical representation is much nicer, we need a textual representation for writing things down (e.g. in error messages).
Besides naming the initial state, this is just a list of transitions, where each one consists of the following:

- the state we start from, e.g. `(Closed)`
- the name of the command that needs to be invoked to start the transition, e.g. `open`
- the name of the machine role that is allowed to issue this command, e.g. `Control`
- a list of event types that record this transition, e.g. `Opening`
- the state we thus arrive at, e.g. `(Opening)`

The short form for writing this down is `(Closed) --[open@Control<Opening>]--> (Opening)`

## Example protocol

The machines from the [Hangar Door example](../machine-runner/README.md#example-usage) might follow this protocol:

- `(Closed) --[open@Control<Opening>]--> (Opening)`
- `(Opening) --[update@Door<Opening>]--> (Opening)`
- `(Opening) --[open@Door<Opened>]--> (Open)`
- `(Open) --[close@Control<Closing>]--> (Closing)`
- `(Closing) --[update@Door<Closing>]--> (Closing)`
- `(Closing) --[close@Door<Closed>]--> (Closed)`

The Control can initiate opening and closing while the Door provides progress updates and states when each movement has been completed.

## How to use this library

This library is typically used within your unit tests to check the structure of the machines you’ve written.
For this we need to provide two pieces: the desired swarm protocol and the event subscriptions of your machine roles.
Continuing the example above, it could look like this:

```ts
import { Door, Control, HangarBay } from './example-proto.js'
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from '@actyx/machine-check'

const swarmProtocol: SwarmProtocolType = {
  initial: 'Closed',
  transitions: [
    {
      source: 'Closed',
      target: 'Opening',
      label: { cmd: 'open', role: 'Control', logType: ['opening'] },
    },
    {
      source: 'Opening',
      target: 'Opening',
      label: { cmd: 'update', role: 'Door', logType: ['opening'] },
    },
    {
      source: 'Opening',
      target: 'Open',
      label: { cmd: 'open', role: 'Door', logType: ['opened'] },
    },
    {
      source: 'Open',
      target: 'Closing',
      label: { cmd: 'close', role: 'Control', logType: ['closing'] },
    },
    {
      source: 'Closing',
      target: 'Closing',
      label: { cmd: 'update', role: 'Door', logType: ['closing'] },
    },
    {
      source: 'Closing',
      target: 'Closed',
      label: { cmd: 'close', role: 'Door', logType: ['closed'] },
    },
  ],
}

const subscriptions = {
  Control: ['closing', 'closed', 'opening', 'opened'],
  Door: ['closing', 'closed', 'opening', 'opened'],
}

console.log(checkSwarmProtocol(swarmProtocol, subscriptions))
console.log(
  checkProjection(
    swarmProtocol,
    subscriptions,
    'Control',
    Control.Control.createJSONForAnalysis(Control.Closed),
  ),
)
console.log(
  checkProjection(
    swarmProtocol,
    subscriptions,
    'Door',
    Door.Door.createJSONForAnalysis(Door.Closed),
  ),
)
```

Instead of `console.log()` you’d normally assert that the result is `{"type":"OK"}`.
In the example as given you’ll instead be notified that the overall protocol has a flaw:

```text
{
  type: 'ERROR',
  errors: [
    'guard event type opening appears in transitions from multiple states',
    'guard event type closing appears in transitions from multiple states'
  ]
}
```

This means that our clever reuse of the `opening` and `closing` event types for dual purposes may not be so clever after all — the `update` commands should yield more specific `openingProgress` and `closingProgress` event types instead.
Other than that, our machines are implemented correctly.
You can try to remove a command or reaction from the code to observe how this this pointed out by `checkProjection()`.
