import { describe, expect, it } from '@jest/globals'
import { MachineEvent, SwarmProtocol, StateFactory, StateMechanism } from '../../lib/esm/index.js'
import { MachineAnalysisResource } from '../../lib/esm/design/protocol.js'
import * as ProtocolOneTwo from './protocol-one-two.js'

describe('protocol.createJSONForAnalysis', () => {
  const E1 = MachineEvent.design('E1').withoutPayload()
  const E2 = MachineEvent.design('E2').withoutPayload()
  const protocol = SwarmProtocol.make('example', [E1, E2])
  const machine = protocol.makeMachine('example')
  const S1 = machine
    .designEmpty('S1')
    .command('a', [E1], () => [E1.make({})])
    .finish()
  const S2 = machine
    .designEmpty('S2')
    .command('b', [E2], () => [E2.make({})])
    .finish()
  S1.react([E1, E2], S1, () => S1.make())
  S1.react([E2], S2, () => S2.make())
  S2.react([E2, E1], S2, () => S2.make())
  S2.react([E1], S1, () => S1.make())

  it('should have all required data', () => {
    const analysisData = machine.createJSONForAnalysis(S1)

    expect(analysisData.initial).toBe(S1.mechanism.name)
    // 2 commands
    expect(analysisData.transitions.filter((t) => t.label.tag === 'Execute')).toHaveLength(2)
    // 6 reactions
    expect(analysisData.transitions.filter((t) => t.label.tag === 'Input')).toHaveLength(6)

    // expect each command
    expectExecute(analysisData, S1, 'a', [E1])
    expectExecute(analysisData, S2, 'b', [E2])

    const synthetic = MachineAnalysisResource.syntheticEventName

    // expect each reaction
    // S1.react([E1, E2], S1, () => S1.make())
    expect(extractInput(analysisData, S1, E1, synthetic(S1, [E1]))).toBeTruthy()
    expect(extractInput(analysisData, synthetic(S1, [E1]), E2, S1)).toBeTruthy()
    // S1.react([E2], S2, () => S2.make())
    expect(extractInput(analysisData, S1, E2, S2)).toBeTruthy()
    // S2.react([E2, E1], S2, () => S2.make())
    expect(extractInput(analysisData, S2, E2, synthetic(S2, [E2]))).toBeTruthy()
    expect(extractInput(analysisData, synthetic(S2, [E2]), E1, S2)).toBeTruthy()
    // S2.react([E1], S1, () => S1.make())
    expect(extractInput(analysisData, S2, E1, S1)).toBeTruthy()
  })
})

// Utilities
// =========

const nameOf = (m: StateMechanism.Any | StateFactory.Any | string): string =>
  typeof m === 'string' ? m : ('mechanism' in m ? m.mechanism : m).name

const expectExecute = (
  analysisData: MachineAnalysisResource,
  factory: StateMechanism.Any | StateFactory.Any,
  commandName: string,
  logType: { type: string }[],
) => {
  const transitionFound = analysisData.transitions.find(
    (t) =>
      t.source === nameOf(factory) &&
      t.target === nameOf(factory) &&
      t.label.tag === 'Execute' &&
      t.label.cmd === commandName,
  )
  expect(transitionFound).toBeTruthy()
  expect(transitionFound?.label.tag === 'Execute' && transitionFound.label.logType).toEqual(
    logType.map((item) => item.type),
  )
}

describe('MachineAnalysisResource.syntheticEventName', () => {
  const { Events, Initial, Second, XCommandParam } = ProtocolOneTwo
  const { One, Two } = Events
  it('should be as formatted in the test', () => {
    expect(MachineAnalysisResource.syntheticEventName(Initial, [One, Two])).toBe('§Initial§One§Two')
    expect(MachineAnalysisResource.syntheticEventName(Second, [One])).toBe('§Second§One')
  })
})

const extractInput = (
  analysisData: MachineAnalysisResource,
  source: string | StateMechanism.Any | StateFactory.Any,
  eventType: { type: string },
  target: string | StateMechanism.Any | StateFactory.Any,
) =>
  analysisData.transitions.find(
    (t) =>
      t.source === nameOf(source) &&
      t.target === nameOf(target) &&
      t.label.tag === 'Input' &&
      t.label.eventType === eventType.type,
  )
