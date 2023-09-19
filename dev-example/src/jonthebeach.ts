/* eslint-disable @typescript-eslint/no-namespace */
import { createMachineRunner, SwarmProtocol, MachineEvent as Event } from '@actyx/machine-runner'
import { Actyx, AqlEventMessage, AqlResponse } from '@actyx/sdk'
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from '@actyx/machine-check'

const requested = Event.design('requested').withPayload<{ id: string; from: string; to: string }>()
const bid = Event.design('bid').withPayload<{ robot: string; delay: number }>()
const selected = Event.design('selected').withPayload<{ winner: string }>()

const transportOrderEvents = [requested, bid, selected] as const
const transportOrder = SwarmProtocol.make('transportOrder', transportOrderEvents)

const TransportOrderForRobot = transportOrder.makeMachine('robot')

type Score = { robot: string; delay: number }

export const Initial = TransportOrderForRobot.designState('Initial')
  .withPayload<{ robot: string }>()
  .finish()
export const Auction = TransportOrderForRobot.designState('Auction')
  .withPayload<{ id: string; from: string; to: string; robot: string; scores: Score[] }>()
  .command('bid', [bid], (ctx, delay: number) => [{ robot: ctx.self.robot, delay }])
  .command('select', [selected], (_ctx, winner: string) => [{ winner }])
  .finish()
export const DoIt = TransportOrderForRobot.designState('DoIt')
  .withPayload<{ robot: string; winner: string }>()
  .finish()

Initial.react([requested], Auction, (ctx, r) => ({
  ...ctx.self,
  ...r.payload,
  scores: [],
}))

Auction.react([bid], Auction, (ctx, b) => {
  ctx.self.scores.push(b.payload)
  return ctx.self
})

Auction.react([selected], DoIt, (ctx, s) => ({
  robot: ctx.self.robot,
  winner: s.payload.winner,
}))

const TransportOrderForWarehouse = transportOrder.makeMachine('warehouse')
export const InitialWarehouse = TransportOrderForWarehouse.designState('Initial')
  .withPayload<{ id: string }>()
  .command('request', [requested], (ctx, from: string, to: string) => [{ id: ctx.self.id, from, to }])
  .finish()
export const DoneWarehouse = TransportOrderForWarehouse.designEmpty('Done').finish()
InitialWarehouse.react([requested], DoneWarehouse, (_ctx, _r) => [{}])

// prettier-ignore
const transportOrderProtocol: SwarmProtocolType = {
  initial: 'initial',
  transitions: [
    { source: 'initial', label: { cmd: 'request', logType: ['requested'], role: 'warehouse' }, target: 'auction' },
    { source: 'auction', label: { cmd: 'bid', logType: ['bid'], role: 'robot' }, target: 'auction' },
    { source: 'auction', label: { cmd: 'select', logType: ['selected'], role: 'robot' }, target: 'doIt' },
  ]
}

// for theory see "Behavioural Types for Local-First Systems", ECOOP2023

const robotJSON = TransportOrderForRobot.createJSONForAnalysis(Initial)
const warehouseJSON = TransportOrderForWarehouse.createJSONForAnalysis(InitialWarehouse)
const subscriptions = {
  robot: robotJSON.subscriptions,
  warehouse: warehouseJSON.subscriptions,
}

console.log(checkSwarmProtocol(transportOrderProtocol, subscriptions))
console.log(checkProjection(transportOrderProtocol, subscriptions, 'robot', robotJSON))
console.log(checkProjection(transportOrderProtocol, subscriptions, 'warehouse', warehouseJSON))
// expect(checkSwarmProtocol(transportOrderProtocol, subscriptions)).toEqual({ type: 'OK' })
// expect(checkProjection(transportOrderProtocol, subscriptions, 'robot', robotJSON)).toEqual({
//   type: 'OK',
// })

const actyx = await Actyx.of({ appId: 'com.example.acm', displayName: 'example', version: '0.0.1' })
const tags = transportOrder.tagWithEntityId('4711')
const robot1 = createMachineRunner(actyx, tags, Initial, { robot: 'agv1' })
const warehouse = createMachineRunner(actyx, tags, InitialWarehouse, { id: '4711' })

for await (const state of warehouse) {
  if (state.is(InitialWarehouse)) {
    await state.cast().commands()?.request('from', 'to')
  } else {
    // this role is done
    break
  }
}

let IamWinner = false

for await (const state of robot1) {
  if (state.is(Auction)) {
    const open = state.cast()
    if (!open.payload.scores.find((s) => s.robot === open.payload.robot)) {
      await open.commands()?.bid(1)
      setTimeout(() => {
        const open = robot1.get()?.as(Auction)
        open && open.commands()?.select(bestRobot(open.payload.scores))
      }, 5000)
    }
  } else if (state.is(DoIt)) {
    const assigned = state.cast()
    IamWinner = assigned.payload.winner === assigned.payload.robot
    if (!IamWinner) break
    // now we have the order and can start the mission
  }
}

function bestRobot(scores: any): string {
  return 'me'
}

export async function robotControl(actyx: Actyx, robot: string): Promise<void> {
  const ordersResponse = await actyx.queryAql({
    query: `
    FROM 'transportOrder'
    FILTER _.type = 'requested'
    FILTER !IsDefined( ( FROM \`transportOrder:{_.id}\` FILTER _.type = 'selected' )[0] )
  `,
  })
  const orders = ordersResponse.filter(isEvent).map((o) => o.payload as Event.Of<typeof requested>)
  const toPick = pickSuitableOrder(orders)

  if (toPick) {
    const tags = transportOrder.tagWithEntityId(toPick.id)
    const machine = createMachineRunner(actyx, tags, Initial, { robot })
    for await (const state of machine) {
      /* perform the mission */
    }
  }

  setTimeout(() => robotControl(actyx, robot), 1000)
}

function isEvent(resp: AqlResponse): resp is AqlEventMessage {
  return resp.type === 'event'
}

function pickSuitableOrder(
  orders: Event.Of<typeof requested>[],
): Event.Of<typeof requested> | undefined {
  return orders[0]
}
