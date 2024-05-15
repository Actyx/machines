# Asymmetric Replicated Machines

This set of libraries provides a way of writing **fully decentralised** applications using **replicated state machines**, but without any form of blocking coordination.
Furthermore, the machines you deploy work together in the scope of a swarm protocol while the machine instances may play **different roles**.
These roles may differ in their business logic as well as in the events they are allowed to consume; in other words the work can be distributed across different machines and split into separate responsibilities.

## Machine Runner

Library documentation: [machine-runner](https://github.com/Actyx/machines/tree/master/machine-runner)

This library offers a TypeScript DSL for defining machines in the above sense.
Each such machine belongs to an overarching _swarm protocol_, i.e. it plays a role within that protocol and works together with other machines also following this protocol.
A machine more precisely is a [finite-state automaton](https://en.wikipedia.org/wiki/Finite-state_machine) with the following features:

- it starts out in an initial state
- each state may have some payload data that your business logic can use and update
- states also offer a set of commands that can be invoked to emit a sequence of events
- when a machine receives some events (from the network or from its own commands), the current state is asked to compute the following state (which may only update the payload or transition to an entirely new state)

The `machine-runner` library is named so because it also has the duty of executing a machine.
This implementation is based on the [Actyx](https://developer.actyx.com/) peer-to-peer event stream database.

## Machine Check

The TypeScript definition of a machine using `machine-runner` captures the whole behaviour that this machine can exhibit: all states, commands, and event transitions are described in your code.
This allows the `machine-check` tool to be used to verify that your implementation is as you designed it.
The design is typically done in a graphical form like UML and then transformed into the JSON format needed by `machine-check`.
You’ll use this library in your machine’s unit tests

- to check that your designed swarm protocol is sound
- to check that your machines follow their prescribed role in the swarm protocol

For more information please refer to the [README](./machine-check/README.md).

## Machine Visualisation

The third library provides React components for generically visualising your running machines and letting you interact with them.
It also provides a view that shows you the full event and state history of a set of machines for debugging: since Actyx offers persistent event streams, you can see after the fact how a certain state has been reached, which usually gives you good hints as to where the bug is.

## Development

If you want to further develop these libraries, there’s some sample usage in the `dev-example` folder.
Please be sure to `nvm use` the right node.js version!

## Acknowledgements

The implementation of these libraries and the underlying theory has been supported by the Horizon Europe EU project «TaRDIS» (grant number 101093006).
