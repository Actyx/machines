/* eslint-disable @typescript-eslint/no-namespace */
import { createMachineRunner, SwarmProtocol, MachineEvent } from '@actyx/machine-runner'
import { Actyx, AqlEventMessage, AqlResponse } from '@actyx/sdk'
import { SwarmProtocolType, checkProjection, checkSwarmProtocol } from '@actyx/machine-check'

const pickUp = MachineEvent.design('pickUp').withPayload<{
  id: string
  chassisId: string
  fromPos: string
}>()
const deliver = MachineEvent.design('deliver').withPayload<{ toPos: string }>()
const reserved = MachineEvent.design('reserved').withPayload<{ robot: string; score: number }>()
const confirmed = MachineEvent.design('confirmed').withPayload<{ winner: string }>()
const atSource = MachineEvent.design('atSource').withoutPayload()
const placed = MachineEvent.design('placed').withoutPayload()
const atDestination = MachineEvent.design('atDestination').withoutPayload()
const taken = MachineEvent.design('taken').withoutPayload()

const transportOrderEvents = [pickUp, deliver, reserved, confirmed, atSource, placed, atDestination, taken] as const
const transportOrder = SwarmProtocol.make('transportOrder', transportOrderEvents)

const TOForRobot = transportOrder.makeMachine('robot')
namespace ForRobot {
  type Order = { id: string; chassisId: string; fromPos: string; toPos: string; robot: string }
  type OrderScores = Order & { scores: { robot: string; score: number }[] }

  export const Initial = TOForRobot.designState('Initial').withPayload<{ robot: string }>().finish()
  export const Open = TOForRobot.designState('Open')
    .withPayload<OrderScores>()
    .command('reserve', [reserved], (ctx, score: number) => [{ robot: ctx.self.robot, score }])
    .command('confirm', [confirmed], (_ctx, winner: string) => [{ winner }])
    .finish()
  export const Assigned = TOForRobot.designState('Assigned')
    .withPayload<Order & { winner: string }>()
    .command('arrive', [atSource], (_ctx) => [{}])
    .finish()
  export const Transporting = TOForRobot.designState('Transporting')
    .withPayload<Order>()
    .command('arrive', [atDestination], (_ctx) => [{}])
    .finish()
  export const Done = TOForRobot.designEmpty('Done').finish()

  Initial.react([pickUp, deliver], Open, (ctx, p, d) => ({
    ...ctx.self,
    ...p.payload,
    ...d.payload,
    scores: [],
  }))

  Open.react([reserved], Open, (ctx, r) => {
    ctx.self.scores.push(r.payload)
    return ctx.self
  })

  Open.react([confirmed], Assigned, (ctx, c) => {
    const { scores, ...rest } = ctx.self
    return { ...rest, winner: c.payload.winner }
  })

  Assigned.react([atSource, placed], Transporting, (ctx, _a, _p) => ctx.self)

  Transporting.react([atDestination, taken], Done, (ctx, _a, _t) => ({}))
}

const actyx = await Actyx.of({
  appId: 'com.example.jonthebeach',
  displayName: 'J on the Beach',
  version: '0.0.1',
})
const tags = transportOrder.tagWithEntityId('4711')
const machine = createMachineRunner(actyx, tags, ForRobot.Initial, { robot: 'agv1' })

let IamWinner = false
for await (const state of machine) {
  if (state.is(ForRobot.Open)) {
    const open = state.cast()
    if (!open.payload.scores.find((s) => s.robot === open.payload.robot)) {
      await open.commands?.reserve(1)
      setTimeout(() => {
        const open = machine.get()?.as(ForRobot.Open)
        open && open.commands?.confirm(bestRobot(open.payload.scores))
      }, 5000)
    }
  } else if (state.is(ForRobot.Assigned)) {
    const assigned = state.cast()
    IamWinner = assigned.payload.winner === assigned.payload.robot
    if (!IamWinner) break
    // TODO: add the actual robot control part here for driving to the source
    await assigned.commands?.arrive()
  } else if (state.is(ForRobot.Transporting)) {
    if (!IamWinner) break
    const transporting = state.cast()
    // TODO: add the actual robot control part here for driving to the destination
    await transporting.commands?.arrive()
  } else if (state.is(ForRobot.Done)) {
    break
    // this will clean up the Actyx subscription as well
  }
}

function bestRobot(scores: any): string {
  return 'me'
}

// prettier-ignore
const transportOrderProtocol: SwarmProtocolType = {
  initial: 'Initial',
  transitions: [
    { source: 'initial', label: { cmd: 'request', logType: ['pickUp'], role: 'source' }, target: 'awaitTarget' },
    { source: 'awaitTarget', label: { cmd: 'request', logType: ['deliver'], role: 'target' }, target: 'open' },
    { source: 'open', label: { cmd: 'reserve', logType: ['reserved'], role: 'robot' }, target: 'open' },
    { source: 'open', label: { cmd: 'confirm', logType: ['confirmed'], role: 'robot' }, target: 'assigned' },
    { source: 'assigned', label: { cmd: 'arrive', logType: ['atSource'], role: 'robot' }, target: 'awaitPlacement' },
    { source: 'awaitPlacement', label: { cmd: 'place', logType: ['placed'], role: 'source' }, target: 'transporting' },
    { source: 'transporting', label: { cmd: 'arrive', logType: ['atDestination'], role: 'robot' }, target: 'awaitRemove' },
    { source: 'awaitRemove', label: { cmd: 'take', logType: ['taken'], role: 'target' }, target: 'done' },
  ]
}

// for theory see "Behavioural Types for Local-First Systems", ECOOP2023

const robotJSON = TOForRobot.createJSONForAnalysis(ForRobot.Initial)
const sourceJSON = undefined as any
const targetJSON = undefined as any
const subscriptions = {
  robot: robotJSON.subscriptions,
  source: sourceJSON.subscriptions,
  target: targetJSON.subscriptions,
}

expect(checkSwarmProtocol(transportOrderProtocol, subscriptions)).toEqual({ type: 'OK' })
expect(checkProjection(transportOrderProtocol, subscriptions, 'robot', robotJSON)).toEqual({
  type: 'OK',
})

export async function robotControl(actyx: Actyx, robot: string): Promise<void> {
  const ordersResponse = await actyx.queryAql({
    query: `
    FROM 'transportOrder'
    FILTER _.type = 'pickUp'
    FILTER IsDefined((FROM \`transportOrder:{_.id}\` FILTER _.type = 'deliver')[0])
    LET confirmed = IsDefined((FROM \`transportOrder:{_.id}\` FILTER _.type = 'confirmed')[0])
    FILTER !confirmed
  `,
  })
  const orders = ordersResponse.filter(isEvent).map((o) => o.payload as MachineEvent.Of<typeof pickUp>)
  const toPick = pickSuitableOrder(orders)

  if (toPick) {
    const tags = transportOrder.tagWithEntityId(toPick.id)
    const machine = createMachineRunner(actyx, tags, ForRobot.Initial, { robot })
    for await (const state of machine) {
      /* perform the mission */
    }
  }

  setTimeout(() => robotControl(actyx, robot), 1000)
}

function isEvent(resp: AqlResponse): resp is AqlEventMessage {
  return resp.type === 'event'
}

function pickSuitableOrder(orders: MachineEvent.Of<typeof pickUp>[]): MachineEvent.Of<typeof pickUp> | undefined {
  return orders[0]
}
