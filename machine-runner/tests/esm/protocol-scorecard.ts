import { MachineEvent, SwarmProtocol } from '../../lib/esm/index.js'

type PlayerId = string
type Score = number

export namespace Events {
  export const Begin = MachineEvent.design('Begin').withPayload<{
    playerIds: PlayerId[]
    par: number
  }>()
  export const Score = MachineEvent.design('Score').withPayload<{
    playerId: PlayerId
    numberOfShots: Score
  }>()
  export const End = MachineEvent.design('End').withoutPayload()

  export const all = [Begin, Score, End] as const
}

const protocol = SwarmProtocol.make('GolfScorecard', Events.all)
const machine = protocol.makeMachine('Golf')

export const Initial = machine
  .designEmpty('Initial')
  .command(
    'begin',
    [Events.Begin],
    (_, { par, playerIds }: { par: number; playerIds: PlayerId[] }) => [
      {
        par,
        playerIds,
      },
    ],
  )
  .finish()

export const ScoreKeeping = machine
  .designState('Scorekeeping')
  .withPayload<{
    par: number
    players: Set<PlayerId>
    scoreMap: Map<PlayerId, number>
  }>()
  .command('addScore', [Events.Score], (_, playerId: PlayerId, numberOfShots: number) => [
    { numberOfShots, playerId },
  ])
  .command('end', [Events.End], () => [{}])
  .finish()

Initial.react([Events.Begin], ScoreKeeping, (_, begin) => ({
  par: begin.payload.par,
  players: new Set(begin.payload.playerIds),
  scoreMap: new Map(),
}))

ScoreKeeping.reactIntoSelf([Events.Score], ({ self }, score) => {
  const { numberOfShots, playerId } = score.payload

  if (self.players.has(playerId) && self.scoreMap.get(playerId) === undefined) {
    self.scoreMap.set(playerId, numberOfShots)
  }

  return self
})

export const Result = machine
  .designState('Result')
  .withPayload<{
    par: number
    scoreMap: Map<PlayerId, number>
  }>()
  .finish()

ScoreKeeping.react([Events.End], Result, ({ self }) => {
  const { par, scoreMap } = self
  return {
    par,
    scoreMap,
  }
})

export const AllStates = [Initial, ScoreKeeping, Result] as const

// Reactions
