import { Actyx, AqlEventMessage } from '@actyx/sdk'
import { DockSim } from './docksim.js'
import { ROrderName, ROrderTag, protocol } from './dock-protocol.js'
import { MachineRunner, StateOpaque, createMachineRunner } from '@actyx/machine-runner'
import { Receiver } from './dock-receiver.js'

const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur))

export const ShipReceivingAgentConnector = async (
  isAlive: () => boolean,
  agent: DockSim.ShipReceivingAgent,
  actyx: Actyx,
) => {
  const registerRequest = (shipId: string) =>
    actyx.publish(
      ROrderTag.apply({
        shipId,
        direction: 'inbound',
      }),
    )

  const getPastRegisteredRequests = async () =>
    (
      await actyx.queryAql({
        query: `
                PRAGMA features := subQuery interpolation
                FROM '${ROrderName}' & 'created' & TIME ≥ 1D ago
                SELECT _.shipId
            `,
      })
    )
      .filter((msg): msg is AqlEventMessage => msg.type === 'event')
      .map((msg) => msg.payload as string)

  const getRequestingShipIds = () => agent.getDockingRequests().map((req) => req.id)

  type MachinePair = [DockSim.ShipId, MachineRunner.Of<typeof Receiver.machineProtocol>]
  type SnapshotPair = [
    DockSim.ShipId,
    MachineRunner.Of<typeof Receiver.machineProtocol>,
    StateOpaque.Of<typeof Receiver.machineProtocol>,
  ]

  const idsToMachinePairs = (ids: DockSim.ShipId[]): Promise<MachinePair[]> =>
    Promise.all(
      ids.map(async (id): Promise<MachinePair> => {
        const where = protocol.tagWithEntityId(id)
        const machine = createMachineRunner(actyx, where, Receiver.Unhandled, void 0)
        return [id, machine]
      }),
    )

  const wipeMissing = (machinePairs: MachinePair[], missingRequestersSet: Set<DockSim.ShipId>) =>
    machinePairs
      .filter(([id, _]) => missingRequestersSet.has(id))
      .map(async ([_, machine]) => {
        const snapshot = (await machine.peek()).value
        // snapshot?.as(Unhandled, (state) => state.commands?.abort())
      })

  const searchForWorkable = async (machinePairs: MachinePair[]) => {
    const tasks: SnapshotPair[] = (
      await Promise.all(
        machinePairs.map(async ([id, machine]) => {
          const snapshot = (await machine.peek()).value
          if (!snapshot) return null
          return [id, machine, snapshot] as const
        }),
      )
    ).filter((x): x is SnapshotPair => x !== null)

    const processibleTasks: SnapshotPair[] = tasks.filter(
      ([, , snapshot]) => !snapshot.is(Receiver.Aborted) && !snapshot.is(Receiver.Done),
    )

    const firstInProgress = processibleTasks.filter(([, , s]) => !s.is(Receiver.Unhandled)).at(0)
    if (firstInProgress) return firstInProgress || undefined

    const firstUnhandled = processibleTasks.filter(([, , s]) => s.is(Receiver.Unhandled)).at(0)
    if (firstUnhandled) return firstUnhandled || undefined

    return null
  }

  // Register all requests so that the hangar system knows which ship is ready

  const admissioner = (() => {
    let assignedOrderShipId: DockSim.ShipId | null = null

    ;(async () => {
      while (isAlive()) {
        const currentOrderShipId = assignedOrderShipId

        if (!currentOrderShipId) {
          await sleep(100)
          continue
        }

        // for await (const snapshot of createMachineRunner(
        //   actyx,
        //   protocol.tagWithEntityId(currentOrderShipId),
        //   Unhandled,
        //   undefined,
        // )) {
        // }
      }
    })()

    return {
      isBusy: () => assignedOrderShipId === null,
      assignTask: (task: DockSim.ShipId) => {
        if (assignedOrderShipId === null) {
          assignedOrderShipId = task
        }
      },
    }
  })()

  while (isAlive()) {
    const allRequests = getRequestingShipIds()
    const allRequestsSet = new Set(allRequests)
    const registeredRequests = await getPastRegisteredRequests()
    const registeredRequestsSet = new Set(registeredRequests)
    const unregisteredRequests = allRequests.filter((id) => !registeredRequestsSet.has(id))
    const missingRequestersSet = new Set(registeredRequests.filter((id) => !allRequestsSet.has(id)))

    const registerPromise = await Promise.all(unregisteredRequests.map(registerRequest))

    const machinePairs = await idsToMachinePairs(registeredRequests)

    // Abort missing promise and await for abortion
    await wipeMissing(machinePairs, missingRequestersSet)

    // Processible: not unhandled and not done
    if (!admissioner.isBusy()) {
      const currentTask = await searchForWorkable(machinePairs)
      if (currentTask) {
        admissioner.assignTask(currentTask[0])
      }
    }

    await Promise.all([registerPromise])

    // NOTE: this is not a good exercise
    machinePairs.forEach(([id, machine]) => machine.destroy())
    await sleep(100)
  }
}
