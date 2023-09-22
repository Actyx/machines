# Implementing a Swarm Workflow

Machine Runner's main purpose is to enable a heterogenous swarm system---a system of dynamically participating agents of different role---to work on a swarm workflow.
A swarm workflow in this context is a collection of tasks done by different agents that must be executed with a certain order (aka. sequentially); consequentially, a swarm workflow has a finite lifetime.

Machine Runner enables this by creating a swarm protocol, which can be pictured as an imaginary distributed ledger.
The ledger acts as a coordination point between agents.
An agent that finished a task can write a record on the ledger to let the others know that the system has reached a point where it needs another agent to act.
Agents coordinate with the ledger by writing a record to indicate that the system reached a point which needs some agent of a certain role to act.

Swarm protocol is imaginary and distributed because it does not possess a single central physical structure.
Instead it is sustained by its physical representation: events replicated by all agents---or to be more precise Actyx Events replicated by all Actyx Nodes.

## The Thirsty Tomato Plant

Today is a hot day.
On a patch of a farming field, a tomato plant is dry and thirsty.
Now, this farm is fully automated.
There's a sensor, and it senses the tomato's distress.
It signals a robot across the field for water.
Hearing that, the robot rushes to help.
There's a nearby water pump, but it was busy!
A long queue of other robots!
The robot has no choice but to join the queue.

That pump has to serve everyone.
It needs its workspace clean.
It can't have the robots colliding with each other, "not when I'm in charge!".

Let's make this work.
To make sure no robots collide on the pump's workspace the following must happen:
each robot must dock securely;
then, the pump brings in the water;
after being served, the robots leave a safe distance and signal the pump.
Only after that sequence is finished, the next robot can come in.

Such cooperation is often hard, especially in a farming field where a central coordinator is absent.
The pumps and the robots (the agents) must agree on a sequence of tasks.
[They must know who must do what and when](https://en.wikipedia.org/wiki/Race_condition).
To coordinate, they need a protocol.
Fortunately, [`machine-runner`](https://www.npmjs.com/package/@actyx/machine-runner)-on-Actyx exists exactly to solve this problem.

![problem illustration](./problem-illustration.png)

## Prerequisites

Several things are needed before we start:

- Installation of [Actyx](/docs/how-to/local-development/install-actyx)
- Installation of [Actyx Node Manager](/docs/how-to/local-development/install-cli-node-manager)
- Installation of [Node JS](https://nodejs.org/en)
- [Brief introduction to Actyx](/docs/conceptual/overview)

## Setting up the project {#setting-up}

1. Prepare a folder; open a terminal on the folder.

```bash
$ npm init
```

This will prompt you several questions, in which you can fill in the details of your project.

2. Install these dependencies:

```bash
$ npm i typescript @actyx/machine-runner @actyx/sdk uuid @types/uuid
```

`uuid` and `@types/uuid` will be relevant at a later point in this article.

3. Modify `package.json` and `tsconfig.json` with these values:

```json title="package.json"
{
  "scripts": {
    "compile": "tsc",
    "start": "npm run compile && node dist/index.js"
  }
  // ...the rest of package.json
}
```

```json title="tsconfig.json"
{
  "compilerOptions": {
    "outDir": "dist"
    // ...the rest of compilerOptions
  },
  "include": ["src/**/*.*"]
}
```

4. Create a file in `src/index.ts`

```ts title="src/index.ts"
console.log("hello world");
```

5. Finally, we should be able to run the project with:

```bash
$ npm run start
```

## The Robot and The Pump {#robot-and-pump}

In a day of a robot's life:
It stands by, listening to signals from sensors.
A sensor occasionaly sends a signal that a tomato plant needs water.
When the robot receives that signal, it finds a nearby pump, draws water, and then runs to water the plant.

To illustrate that in pseudo-code _(no need to type this in)_:

```typescript
// A watering robot's life in a day

async function main() {
  while (true) {
    const taskFromSensor = await receiveSignalFromSensor();
    await waterPlant(taskFromSensor);
  }
}

async function waterPlant(taskFromSensor) {
  const pump = await findNearbyPump();
  await moveTo(pump);
  const dockingId = await requestDockingTo(pump);
  await dockAndDrawWater(dockingId); // <-- the protocol we are working on
  await waterPlant(taskFromSensor);
}
```

At a given time, a pump can have several robots queuing for water.
To prevent collisions, the pump serves one request at a time.

To illustrate (_again, no need to type this in_):

```typescript
// A water pump's life in a day

async function main() {
  while (true) {
    const dockingId = await receiveDockingRequestId();
    await supplyWater(dockingId); // <-- the protocol we are working on
  }
}
```

Within the robot's and the pump's `dockAndDrawWater` and `supplyWater` is a complex workflow.
The workflow involves several activities that involve back-and-forth communication in between.

`dockingId` in the code above uniquely identifies the instance of the workflow.
Each workflow occasion uses different `dockingId`.
In analogy, `dockingId` serves the same role as the order number on a receipt when ordering a drive-thru.

## Building The Protocol

### Designing the workflow and the interaction {#interaction-design}

First, we want to design how agents coordinate,
in other words, what happens inside `dockAndDrawWater` and `supplyWater`.

On a high level, both agents go through several states: **docking**, **drawing water**, and **undocking**.
For convenience, **initial** and **done** envelop those states.
At one state, a robot may be working while the pump waits;
in the next state it is the pump's turn to work while the robot waits;
therefore the agents need to talk to each other between the states.

With that in mind, we will arrive at this sequence of happenings.

```text
1. robot waits & pump ensures the dock is clear (Initial)
2. pump signals: "dock available"
3. robot docks & pump waits
4. robot signals: "docking successful"
5. robot waits & pump supplies water
6. pump signals: water supplied
7. robot undocks & pump waits
8. robot signals: undock successful
9. (Done)
```

The steps above are interlaced `states` and `events`.
That format is convenient because it can be easily formalized into a state diagram.

<!--
Initial \-\-> Docking: "DockAvailable" by pump
Docking \-\-> DrawingWater: "RobotIsDocked" by robot
DrawingWater \-\-> Undocking: "WaterSupplied" by pump
Undocking \-\-> Done: "RobotIsUndocked" by robot
-->

![state diagram](./state-diagram.svg)

> **Note**
>
> Those are sequence of interactions between agents.
> [Why is it not represented in a sequence diagram instead?](./swarm-workflow-state-interaction-duality)

Now that we've figured out the interaction sequence, we can write a protocol with `machine-runner`.

### Working with `machine-runner`

When working with `machine-runner` there are several steps to follow:

1. list the events;
2. make a `swarm protocol`;
3. list the roles;
4. for each role, make a `machine protocol`, and then design the states and the transitions;
5. use the machine

### Listing Events, Making Swarm Protocol

Create a file to collect all events `src/machines/protocol.ts` and then import everything we need from `@actyx/machine-runner`.

```typescript title="src/machines/protocol.ts"
import { MachineEvent, SwarmProtocol } from "@actyx/machine-runner";
```

We have identified the events [while we designed the interaction](#interaction-design).
Write and collect them into a namespace:

```typescript title="src/machines/protocol.ts"
export namespace ProtocolEvents {
  export const DockAvailable =
    MachineEvent.design("DockAvailable").withoutPayload();

  export const RobotIsDocked =
    MachineEvent.design("RobotIsDocked").withoutPayload();

  export const WaterSupplied =
    MachineEvent.design("WaterSupplied").withoutPayload();

  export const RobotIsUndocked =
    MachineEvent.design("RobotIsUndocked").withoutPayload();

  // Collect all events in one array
  // Use `as const` to make it a readonly tuple
  export const All = [
    DockAvailable,
    RobotIsDocked,
    WaterSupplied,
    RobotIsUndocked,
  ] as const;
}
```

Create the swarm protocol, name it `water-drawing-exchange`.

```typescript title="src/machines/protocol.ts"
export const protocol = SwarmProtocol.make(
  "water-drawing-exchange",
  ProtocolEvents.All
);
```

For now, events and the swarm protocol are done.
Let's move to the machine protocol.

### Machine Protocol for The Pump

Create a new file `src/machines/water-pump.ts`, import the protocol, and create a machine protocol.

```typescript title="src/machines/water-pump.ts"
import { ProtocolEvents, protocol } from "./protocol";

export const machine = protocol.makeMachine("WaterPump");
```

An agent has a role in the swarm.
One machine protocol represents exactly one role.
A machine protocol determines how an agent communicates with the swarm and
perceives the swarm workflow's events as various local states, commands, and reactions.

For each state of the workflow from the [interaction design](#interaction-design) create a state.

```typescript title="src/machines/water-pump.ts"
export const ClearingDock = machine
  .designEmpty("ClearingDock")
  .command("dockAvailable", [ProtocolEvents.DockAvailable], () => [{}])
  .finish();

export const WaitingForRobotToDock = machine
  .designEmpty("WaitingForRobotToDock")
  .finish();

export const PumpingWater = machine
  .designEmpty("PumpingWater")
  .command("waterSupplied", [ProtocolEvents.WaterSupplied], () => [{}])
  .finish();

export const WaitingForRobotToUndock = machine
  .designEmpty("WaitingForRobotToUndock")
  .finish();

export const Done = machine.designEmpty("Done").finish();
```

States for the pump are named differently from the workflow counterparts in this tutorial.
The purpose is to reflect how the role perceives the state.
For example, from the perspective of the pump `Docking` is `WaitingForRobotToDock`.
Of course, the naming convention in real use cases will be up to the application programmer.

Commands are defined for the states `ClearingDock` and `PumpingWater`.
This is how we declare that the pump has an active role in this state (i.e. can emit events), per the interaction design.

Last, we need to define the transitions.

```typescript title="src/machines/water-pump.ts"
ClearingDock.react(
  [ProtocolEvents.DockAvailable],
  WaitingForRobotToDock,
  () => undefined
);

WaitingForRobotToDock.react(
  [ProtocolEvents.RobotIsDocked],
  PumpingWater,
  () => undefined
);

PumpingWater.react(
  [ProtocolEvents.WaterSupplied],
  WaitingForRobotToUndock,
  () => undefined
);

WaitingForRobotToUndock.react(
  [ProtocolEvents.RobotIsUndocked],
  Done,
  () => undefined
);
```

### Machine Protocol for The Robot

Create another file for the robot `src/machine/watering-robot.ts` and follow the same process as how we define the pump's machine protocol.

```typescript title="src/machine/watering-robot.ts"
import { ProtocolEvents, protocol } from "./protocol";

export const machine = protocol.makeMachine("WateringRobot");

export const WaitingForAvailableDock = machine
  .designEmpty("WaitingForAvailableDock")
  .finish();

export const Docking = machine
  .designEmpty("Docking")
  .command("docked", [ProtocolEvents.RobotIsDocked], () => [{}])
  .finish();

export const WaitingForWater = machine.designEmpty("WaitingForWater").finish();

export const Undocking = machine
  .designEmpty("Undocking")
  .command("Done", [ProtocolEvents.RobotIsUndocked], () => [{}])
  .finish();

export const Done = machine.designEmpty("Done").finish();

WaitingForAvailableDock.react(
  [ProtocolEvents.DockAvailable],
  Docking,
  () => undefined
);

Docking.react([ProtocolEvents.RobotIsDocked], WaitingForWater, () => undefined);

WaitingForWater.react(
  [ProtocolEvents.WaterSupplied],
  Undocking,
  () => undefined
);

Undocking.react([ProtocolEvents.RobotIsUndocked], Done, () => undefined);
```

Pay attention to which states the robot has commands.
The robot's active states alternate with the pump's active states.
Notice the robot's and the pump's active states.
See how it mirrors the [interaction design](#interaction-design)

### Wrap The Protocols into one

For convenience, let us put all events, swarm protocol, machine protocol, and states in one file: `src/machines/index.ts`:

```typescript title="src/machines/index.ts"
export * as WaterPump from "./water-pump";
export * as WateringRobot from "./watering-robot";
export * as protocol from "./protocol";
```

## Using The Machine Protocol

Recall `dockAndDrawWater` and `supplyWater` in the pseudo-code from [The Robot And The Pump](#robot-and-pump) section.
Now we will implement those functions.
For that, we need two files:

- `src/consumers/water-pump.ts`
- `src/consumers/watering-robot.ts`

### The Pump's Routine

```typescript
export const supplyWater = async (dockingId: string) => {
  // to be implemented
};
```

In those files, import everything we need.

```typescript title="src/consumers/water-pump.ts"
import { createMachineRunner } from "@actyx/machine-runner";
import { Actyx } from "@actyx/sdk"; // we need this to receive an instantiated sdk in our function
import { WaterPump, protocol } from "../machines";

export const supplyWater = async (actyx: Actyx, dockingId: string) => {
  // to be implemented
};
```

Next, create a machine runner.

```typescript title="src/consumers/water-pump.ts"
export const supplyWater = async (actyx: Actyx, dockingId: string) => {
  // ...
  const tag = protocol.protocol.tagWithEntityId(dockingId);
  const machine = createMachineRunner(
    actyx,
    tag,
    WaterPump.ClearingDock,
    undefined
  );
  // ...
};
```

The call `tagWithEntityId(dockingId)` returns a set of tags: `water-drawing-exchange` and `water-drawing-exchange:[dockingId]`;
all events emitted by the `machine` will be tagged those tags;
all events subscribed by the `machine` are also ones tagged with those tags.

In other words, two agents who use a `machine` with the same tag will be able to interact with each other.
This is important, and this will be relevant later.

Now that the pump has an active machine runner, it can interact with the swarm (i.e. everyone participating in the workflow).
To use a machine-runner, we'll use a [for-await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
First the pump should handle the initial state `ClearingDock`.
In that state, the pump does its task and then calls the appropriate command to move the state forward for everyone in the swarm.

```typescript title="src/consumers/water-pump.ts"
export const supplyWater = async (actyx: Actyx, dockingId: string) => {
  const tag = protocol.protocol.tagWithEntityId(dockingId);
  const machine = createMachineRunner(
    actyx,
    tag,
    WaterPump.ClearingDock,
    undefined
  );

  for await (const state of machine) {
    const whenInitial = state.as(WaterPump.ClearingDock);
    if (whenInitial) {
      // In reality, there will be more code here
      // Notice this command call;
      //  it maps directly to the state design phase
      // .command("dockAvailable", ....)
      await whenInitial.commands?.dockAvailable();
    }
  }
};
```

Now that we've covered all the basics, complete all states handling and add logging code.

<details>
<summary><strong>Final code `src/consumers/water-pump.ts`</strong></summary>

```typescript title="src/consumers/water-pump.ts"
export const supplyWater = async (actyx: Actyx, dockingId: string) => {
  console.log("pump starts task:", dockingId);

  const tag = protocol.protocol.tagWithEntityId(dockingId);
  const machine = createMachineRunner(
    actyx,
    tag,
    WaterPump.ClearingDock,
    undefined
  );

  for await (const state of machine) {
    console.log("pump is:", state.type);

    const whenInitial = state.as(WaterPump.ClearingDock);
    if (whenInitial) {
      await whenInitial.commands?.dockAvailable();
    }

    const whenPumping = state.as(WaterPump.PumpingWater);
    if (whenPumping) {
      await whenPumping.commands?.waterSupplied();
    }

    const whenCleared = state.as(WaterPump.Done);
    if (whenCleared) {
      break;
    }
  }

  console.log("pump finishes task:", dockingId);
};
```

</details>

The `for-await` loop will iterate every time the machine detects a change (and only after the previous iteration finished executing).
In one branch, `Done`, the execution breaks out of the `for-await` loop.
This also turns the `machine` off, cutting its connection from Actyx.

This concludes The Pump's part of the bargain.

> **Tip:**
>
> Ideally, local tasks take place before a `command`.
> All connected machine runners will wait for these local tasks before transitioning to the next state.
> Useful in scenarios such as:
>
> - watering robot needs to move to dock before the water pump opens the valve
> - water pump needs to actually provide water before the robot undocks
>
> ```typescript
> // Example
> const whenPumping = state.as(WaterPump.PumpingWater);
> if (whenPumping) {
>   // open the valve, let water out, close after `amountOfWater`
>   await openValveFor(amountOfWater);
>   // after the local task is done, let the robot know
>   await whenPumping.commands?.waterSupplied();
> }
> ```

### The Robot's Routine

Follow the same pattern as the robot's routine.
However, instead of importing `WaterPump`'s machine protocol, import `WateringRobot` instead.

```typescript title="src/consumers/watering-robot.ts"
import { createMachineRunner } from "@actyx/machine-runner";
import { Actyx } from "@actyx/sdk";
import { WateringRobot, protocol } from "../machines"; // WateringRobot is used instead of WaterPump

export const dockAndDrawWater = async (actyx: Actyx, dockingId: string) => {
  const tag = protocol.protocol.tagWithEntityId(dockingId);
  const machine = createMachineRunner(
    actyx,
    tag,
    WateringRobot.WaitingForAvailableDock,
    undefined
  );
};
```

Cover all states and add logging code.

<details>
<summary><strong>Final code `src/consumers/watering-robot.ts`</strong></summary>

```typescript title="src/consumers/watering-robot.ts"
import { createMachineRunner } from "@actyx/machine-runner";
import { WateringRobot, protocol } from "../machines";
import { Actyx } from "@actyx/sdk";

export const dockAndDrawWater = async (actyx: Actyx, dockingId: string) => {
  console.log("robot starts task:", dockingId);

  const tag = protocol.protocol.tagWithEntityId(dockingId);
  const machine = createMachineRunner(
    actyx,
    tag,
    WateringRobot.WaitingForAvailableDock,
    undefined
  );

  for await (const state of machine) {
    console.log("robot is:", state.type);

    const whenDocking = state.as(WateringRobot.Docking);
    if (whenDocking) {
      await whenDocking.commands?.docked();
    }

    const whenWaterPumped = state.as(WateringRobot.Undocking);
    if (whenWaterPumped) {
      await whenWaterPumped.commands?.Done();
    }

    const whenDone = state.as(WateringRobot.Done);
    if (whenDone) {
      break;
    }
  }

  console.log("robot finishes task:", dockingId);
};
```

</details>

This concludes The Robot's part of the bargain.

## Simulating The Cooperative Interaction

We are going to prove that the above code works by running both roles concurrently.

### The simulation code

First, start with a new file `src/index.ts`, and import everything we need

```typescript title="src/index.ts"
import { Actyx } from "@actyx/sdk";
import * as uuid from "uuid";
import { supplyWater } from "./consumers/water-pump";
import { dockAndDrawWater } from "./consumers/watering-robot";

async function main() {
  // code goes here
}

main();
```

Recall that two machine runners with the same tag will be able to interact with each other.
We need the same `dockingId` which will produce the same tag (in this code `dockingId`).
We'll also use pretend manifest to produce two pretend `Actyx` objects.

```typescript title="src/index.ts"
async function main() {
  const APP_MANIFEST = {
    appId: "com.example.tomato-robot",
    displayName: "Tomato Robot",
    version: "1.0.0",
  };

  const sdk1 = await Actyx.of(APP_MANIFEST);
  const sdk2 = await Actyx.of(APP_MANIFEST);
  const dockingId = uuid.v4();
}
```

Next, do the simulation.
Invoke the functions from the robot and the pump with the same `dockingId`, connecting the two.

```typescript title="src/index.ts"
async function main() {
  // ...
  const simulatedPumpPart = supplyWater(sdk1, dockingId);
  const simulatedRobotPart = dockAndDrawWater(sdk2, dockingId);

  await Promise.all([simulatedPumpPart, simulatedRobotPart]);
}
```

At the end call `dispose` of the `sdks`,
killing all Actyx connections and ending the simulation.

<details>
<summary><strong>Full simulation code</strong></summary>

```typescript title="src/index.ts"
import { Actyx } from "@actyx/sdk";
import * as uuid from "uuid";
import { supplyWater } from "./consumers/water-pump";
import { dockAndDrawWater } from "./consumers/watering-robot";

async function main() {
  const APP_MANIFEST = {
    appId: "com.example.tomato-robot",
    displayName: "Tomato Robot",
    version: "1.0.0",
  };

  const sdk1 = await Actyx.of(APP_MANIFEST);
  const sdk2 = await Actyx.of(APP_MANIFEST);
  const dockingId = uuid.v4();

  // promises
  const simulatedPumpPart = supplyWater(sdk1, dockingId);
  const simulatedRobotPart = dockAndDrawWater(sdk2, dockingId);

  // wait until both processes ends
  await Promise.all([simulatedPumpPart, simulatedRobotPart]);

  sdk1.dispose();
  sdk2.dispose();
}

main();
```

</details>

### Running the simulation

Before running the simulation:

- Make sure [Actyx is running](/docs/how-to/local-development/install-actyx)
- Make sure [project setup](#setting-up) is done.

When everything is ready, run:

```bash
$ npm run start
```

The following log should appear.
This results from the `console.log` calls we have written.

```txt
pump starts task: a7df8979-cf2b-44a9-996e-1bd93a6fe1ab
robot starts task: a7df8979-cf2b-44a9-996e-1bd93a6fe1ab
pump is: ClearingDock
robot is: WaitingForAvailableDock
pump is: WaitingForRobotToDock
robot is: Docking
pump is: PumpingWater
robot is: WaitingForWater
pump is: WaitingForRobotToUndock
robot is: Undocking
pump is: Done
pump finishes task: a7df8979-cf2b-44a9-996e-1bd93a6fe1ab
robot is: Done
robot finishes task: a7df8979-cf2b-44a9-996e-1bd93a6fe1ab
```

You can see that different agent sees the same state every time (e.g. `ClearingDock/WaitingForAvailableDock`, `WaitingForRobotToDock/Docking`).
This is the behavior guaranteed by using `machine-runner` and `Actyx`.

## Download The Code

The code can be found in [// TODO: add link to sample code]