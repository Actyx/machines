import { ActyxEvent, Metadata, Tags } from '@actyx/sdk'
import { describe, expect, it } from '@jest/globals'
import {
  createMachineRunner,
  MachineEvent,
  SwarmProtocol,
  StateFactory,
  State,
} from '../../lib/esm/index.js'
import { MachineRunner } from '../../lib/esm/runner/runner.js'
import { NOP } from '../../lib/esm/utils/misc.js'
import {
  Equal,
  Expect,
  NotAnyOrUnknown,
  NotEqual,
  SerializableObject,
  SerializableValue,
} from '../../lib/esm/utils/type-utils.js'
import * as ProtocolOneTwo from './protocol-one-two.js'
import * as ProtocolScorecard from './protocol-scorecard.js'
import { Runner } from './helper.js'

/**
 * In this particular test group, bad-good assertions are not required.
 * This blocks only tests types by making type assignments.
 * Bad type definitions are expected to fail the compilation
 */
describe('typings', () => {
  // Type Tests
  // ==========

  /**
   * This line guards the number of required parameters in MachineRunner
   * It must be 2 until the next breaking change
   */
  type MachineRunnerIsCommonlyUsableTypes = MachineRunner<'SomeSwarmName', 'SomeMachineName'>

  // Reusables
  // ==========
  const { Initial, Second } = ProtocolOneTwo

  const E1 = MachineEvent.design('E1').withoutPayload()
  const E2 = MachineEvent.design('E2').withoutPayload()
  const E3 = MachineEvent.design('E3').withPayload<{ property: string }>()

  const protocol = SwarmProtocol.make('example', [E1, E2])

  it('event type transformation should be working well', () => {
    true as Expect<Equal<MachineEvent.Of<typeof E1>, { type: 'E1' } & Record<never, never>>>
    true as Expect<Equal<MachineEvent.Of<typeof E3>, { type: 'E3' } & { property: string }>>
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToActyxEvent<readonly [typeof E1, typeof E2, typeof E3]>,
        [
          ActyxEvent<MachineEvent.Of<typeof E1>>,
          ActyxEvent<MachineEvent.Of<typeof E2>>,
          ActyxEvent<MachineEvent.Of<typeof E3>>,
        ]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToMachineEvent<readonly [typeof E1, typeof E2, typeof E3]>,
        [MachineEvent.Of<typeof E1>, MachineEvent.Of<typeof E2>, MachineEvent.Of<typeof E3>]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.MapToPayload<readonly [typeof E1, typeof E2, typeof E3]>,
        [
          MachineEvent.Payload.Of<typeof E1>,
          MachineEvent.Payload.Of<typeof E2>,
          MachineEvent.Payload.Of<typeof E3>,
        ]
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Factory.Reduce<readonly [typeof E1, typeof E2, typeof E3]>,
        typeof E1 | typeof E2 | typeof E3
      >
    >
    true as Expect<
      Equal<
        MachineEvent.Of<MachineEvent.Factory.Reduce<readonly [typeof E1, typeof E2, typeof E3]>>,
        MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2> | MachineEvent.Of<typeof E3>
      >
    >
  })

  it("tags parameter from protocol should match createMachineRunner's", () => {
    // Accepted parameter type
    type TagsParamType = Parameters<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof createMachineRunner<any, any, typeof E1 | typeof E2, any>
    >[1]

    // Argument type
    type TagsArgType = ReturnType<typeof protocol['tagWithEntityId']>

    type ExpectedTagsType = Tags<MachineEvent.Of<typeof E1> | MachineEvent.Of<typeof E2>>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    NOP<[TagsParamType]>(undefined as any as TagsArgType)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    NOP<[NotAnyOrUnknown<TagsParamType>]>(undefined as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    NOP<[NotAnyOrUnknown<TagsArgType>]>(undefined as any)
    true as Expect<Equal<ExpectedTagsType, TagsParamType>>
  })

  it("state.as should not return 'any'", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    if (!snapshot) return

    const state = snapshot.as(Initial)
    if (!state) return

    const commands = state.commands()
    if (!commands) return
    // This will fail to compile if `as` function returns nothing other than
    // "Initial", including if it returns any
    const supposedStateName: NotAnyOrUnknown<State.NameOf<typeof state>> = 'Initial'
    NOP(supposedStateName)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xTypeTest: NotAnyOrUnknown<typeof commands.X> = undefined as any
    const paramsOfXTypeTest: NotAnyOrUnknown<Parameters<typeof commands.X>> = [
      true,
      1,
      '',
      { specificField: 'literal-a' },
      Symbol(),
    ]
    NOP(xTypeTest, paramsOfXTypeTest)

    const transformedTypeTest = snapshot.as(Initial, (initial) => initial.payload.transitioned)
    const supposedBooleanOrUndefined: NotAnyOrUnknown<typeof transformedTypeTest> = true as
      | true
      | false
      | undefined

    NOP(transformedTypeTest, supposedBooleanOrUndefined)
    r.machine.destroy()
  })

  it("state.is should not return 'any' and should narrow cast", () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    const snapshotTypeTest: NotAnyOrUnknown<typeof snapshot> = snapshot
    NOP(snapshotTypeTest)

    if (!snapshot) return

    if (snapshot.is(Initial)) {
      const state = snapshot.cast()
      const typetest: NotAnyOrUnknown<typeof state> = state
      const commands = state.commands()
      if (commands) {
        const typetestCommands: NotAnyOrUnknown<typeof commands.X> = () =>
          Promise.resolve([]) as Promise<Metadata[]>
        NOP(typetest, typetestCommands)
      }
    }

    snapshot.as(Initial)
    snapshot.as(Second)

    r.machine.destroy()
  })

  it('state.is should not support multiple factoriest', () => {
    const r = new Runner(Initial, { transitioned: false })
    const snapshot = r.machine.get()
    if (snapshot?.is(Initial, Second)) {
      const state = snapshot.cast()
      true as Expect<Equal<typeof state, State.Of<typeof Initial> | State.Of<typeof Second>>>
    }
    r.machine.destroy()
  })

  it("machine.refineStateType refines the type of the StateOpaque's payload", () => {
    const r = new Runner(ProtocolScorecard.Initial, undefined)
    const machine = r.machine
    const refinedMachine = machine.refineStateType(ProtocolScorecard.AllStates)

    // Partial param should throw
    expect(() => machine.refineStateType([ProtocolScorecard.Initial])).toThrow()

    const stateOpaque = machine.get()
    if (!stateOpaque) return

    const refinedStateOpaque = refinedMachine.get()
    if (!refinedStateOpaque) return

    true as Expect<Equal<typeof stateOpaque['payload'], unknown>>
    true as Expect<
      Equal<
        typeof refinedStateOpaque['payload'],
        | StateFactory.PayloadOf<typeof ProtocolScorecard.Initial>
        | StateFactory.PayloadOf<typeof ProtocolScorecard.Result>
        | StateFactory.PayloadOf<typeof ProtocolScorecard.ScoreKeeping>
      >
    >
  })

  describe('different-machines', () => {
    const E1 = MachineEvent.design('E1').withoutPayload()
    const E2 = MachineEvent.design('E2').withoutPayload()
    const protocol = SwarmProtocol.make('swarm', [E1, E2])

    const M1 = protocol.makeMachine('machine1')
    const M2 = protocol.makeMachine('machine2')

    const M1S = M1.designEmpty('m1s').finish()
    const M2S = M2.designEmpty('m2s').finish()

    it("should err when the wrong StateFactory is passed on react's NextFactory parameter", () => {
      type ExpectedFactory = Parameters<typeof M1S.react>[1]
      type IncorrectFactory = typeof M2S
      true as Expect<Equal<ExpectedFactory['mechanism']['protocol']['name'], 'machine1'>>
      true as Expect<Equal<ExpectedFactory['mechanism']['protocol']['swarmName'], 'swarm'>>
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })

    it('should err when the wrong parameter is passed on `is`', () => {
      const runner = new Runner(M1S, undefined)
      const state = runner.machine.get()
      if (!state) return
      type ExpectedFactory = Parameters<typeof state.is>[0]
      type IncorrectFactory = typeof M2S
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })

    it('should err when the wrong parameter is passed on `as`', () => {
      const runner = new Runner(M1S, undefined)
      const state = runner.machine.get()
      if (!state) return
      type ExpectedFactory = Parameters<typeof state.as>[0]
      type IncorrectFactory = typeof M2S
      true as Expect<
        NotEqual<
          ExpectedFactory['mechanism']['protocol']['name'],
          IncorrectFactory['mechanism']['protocol']['name']
        >
      >
    })
  })

  describe('serializable-object', () => {
    it('should work correctly', () => {
      const s = (_s: SerializableValue) => {
        // empty
      }
      // @ts-expect-error undefined
      s(undefined)
      s(null)
      s(true)
      s(42)
      s('hello')
      // @ts-expect-error undefined
      s([undefined])
      s([null])
      s([true])
      s([42])
      s(['hello'])
      // @ts-expect-error undefined
      s({ c: undefined })
      s({ c: null })
      s({ c: true })
      s({ c: 42 })
      s({ c: 'hello' })

      // @ts-expect-error undefined
      s({} as { [_: string]: undefined })
      s({} as { [_: string]: null })
      s({} as { [_: string]: boolean })
      s({} as { [_: string]: number })
      s({} as { [_: string]: string })
      // @ts-expect-error function
      s({} as { [_: string]: () => void })
      s({} as Record<string, string>)

      const o = <T extends SerializableObject>() => {
        // empty
      }
      const somesymbol: unique symbol = Symbol()
      type somesymbol = typeof somesymbol

      o<{
        a: boolean
        b: null
        c: true
        d: 42
        e: 'hello'
        f: string
        g: {
          a: boolean
          b: null
          c: true
          d: 42
          e: 'hello'
          f: string
        }
      }>()
      o<{ a: Record<string, string>; b: Record<string, string>[] }>()
      o<{ a: { b: Record<string, { c: number }[]> } }>()
      o<{ a: { b: Record<string, { c: number }[]>[] }[] }>()
      // @ts-expect-error Date as property value
      o<{ a: Date; b: { c: Date } }>()
      // @ts-expect-error function as property value
      o<{ a: () => unknown; b: { c: () => unknown } }>()
      // @ts-expect-error bigint as property value
      o<{ a: bigint; b: { c: bigint } }>()
      // @ts-expect-error symbol as property value
      o<{ a: symbol; b: { c: symbol } }>()
      // @ts-expect-error symbol as property key
      o<{ [somesymbol]: boolean }>()
    })
  })
})
