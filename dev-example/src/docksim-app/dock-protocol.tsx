import { MachineEvent, SwarmProtocol } from '@actyx/machine-runner'
import { Tag } from '@actyx/sdk'

export const ROrderName = 'DockTransactionOrder' as const
export type ROrderPayload = { shipId: string; direction: 'inbound' | 'outbound' }
export const ROrderTag = Tag<ROrderPayload>(ROrderName)

export const DockRequestInitiated = MachineEvent.design('Initiated').withoutPayload()
export const DockRequestAborted = MachineEvent.design('Aborted').withoutPayload()
export const DockRequestDone = MachineEvent.design('Done').withoutPayload()

export const protocol = SwarmProtocol.make('dockSwarm', [
  DockRequestInitiated,
  DockRequestAborted,
  DockRequestDone,
] as const)
