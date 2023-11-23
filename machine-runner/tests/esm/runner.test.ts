import { Tags } from '@actyx/sdk'
import { beforeEach, describe, expect, it } from '@jest/globals'
import {
  StateOpaque,
  MachineEvent,
  SwarmProtocol,
  MachineRunnerErrorCommandFiredAfterLocked,
  MachineRunnerErrorCommandFiredAfterDestroyed,
  MachineRunnerErrorCommandFiredAfterExpired,
  MachineRunnerErrorCommandFiredWhenNotCaughtUp,
  MachineRunnerFailure,
  MachineRunner,
} from '../../lib/esm/index.js'
import { NOP } from '../../lib/esm/utils/misc.js'
import { NotAnyOrUnknown } from '../../lib/esm/utils/type-utils.js'
import * as ProtocolSwitch from './protocol-switch.js'
import * as ProtocolOneTwo from './protocol-one-two.js'
import * as ProtocolScorecard from './protocol-scorecard.js'
import * as ProtocolThreeSwitch from './protocol-three-times-for-zod.js'
import * as ProtocolFaulty from './protocol-faulty.js'
import { Runner, Unreachable, errorCatcher, sleep } from './helper.js'
import * as globals from '../../lib/esm/globals.js'

// Mock Runner

beforeEach(() => {
  globals.emitter.removeAllListeners()
})

describe('machine runner', () => {
  const { Events, Initial, Second } = ProtocolOneTwo
  const { One, Two } = Events

  it('should emit initial state', () => {
    const r = new Runner(Initial, { transitioned: false })

    r.feed([], false)
    r.assertNoStateChange()
    r.assertNoCaughtUp()
    r.assertNoCurrentUnhandled()

    r.feed([], true)
    r.assertNoStateChange()
    r.assertLastCaughtUp(Initial)
    r.assertNoCurrentUnhandled()
  })

  it('should run', () => {
    const r = new Runner(Initial, { transitioned: false })

    r.feed([{ type: 'One', x: 1 }], true)
    r.assertNoStateChange()
    r.assertLastCaughtUp(Initial, ({ snapshot }) => {
      expect(snapshot.payload.transitioned).toBe(false)
    })
    r.assertNoCurrentUnhandled()

    r.feed([{ type: 'Two', y: 2 }], true)
    r.assertLastCaughtUp(Second, ({ snapshot }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(2)
    })
    r.assertLastStateChange(Second, ({ snapshot }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(2)
    })
    r.assertNoCurrentUnhandled()

    r.resetCaughtUpHistory()
    r.resetStateChangeHistory()

    r.timeTravel()
    r.assertNoStateChange()
    r.assertNoCaughtUp()
    r.assertNoCurrentUnhandled()

    r.feed([One.make({ x: 1 }), One.make({ x: 4 }), Two.make({ y: 3 }), Two.make({ y: 2 })], true)
    r.assertLastStateChange(Second, ({ snapshot, unhandled }) => {
      expect(snapshot.payload.x).toBe(1)
      expect(snapshot.payload.y).toBe(3)
      expect(unhandled).toEqual([One.make({ x: 4 })])
    })

    expect(r.getLastUnhandled()).toEqual([Two.make({ y: 2 })])
  })

  it('should mark itself as destroyed after "destroy" is called', () => {
    const r = new Runner(Initial, { transitioned: false })
    expect(r.machine.isDestroyed()).toBe(false)
    r.machine.destroy()
    expect(r.machine.isDestroyed()).toBe(true)
  })

  it('should cancel when empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.assertSubscribed(true)
    r.machine.destroy()
    r.assertSubscribed(false)
  })

  it('should cancel when not empty', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.machine.destroy()
    r.assertSubscribed(false)
  })

  it('should cancel after time travel', () => {
    const r = new Runner(Initial, { transitioned: false })
    r.feed([{ type: 'One', x: 1 }], true)
    r.timeTravel()
    r.machine.destroy()
    r.assertSubscribed(false)
  })

  describe('zod-support', () => {
    const { On, Off, Events } = ProtocolThreeSwitch

    it('should not allow payload with a wrong schema or invalid values due to refinement', () => {
      expect(() => Events.ToggleOn.make({ value: 1 } as any)).toThrow() // wrong payload schema
      expect(() => Events.ToggleOn.make({ literal: 'toggleon', value: -1 })).toThrow() // invalid value due to refinement. See the definition of ToggleOn
    })

    it('should ignore event whose payload does not match the zod definition in the event factory', async () => {
      const r = new Runner(Off, undefined)

      await r.feed([Events.ToggleOn.make({ literal: 'toggleon' as const, value: 1 })], false) // valid
      await r.feed([Events.ToggleOn.make({ literal: 'toggleon' as const, value: 2 })], false) // valid
      await r.feed(
        [{ type: 'ToggleOn', value: 3 } as any as MachineEvent.Of<typeof Events.ToggleOn>],
        false,
      ) // invalid, ToggleOn requires a field `literal: 'toggleon'` to be regarded as having a valid schema by the zod definition
      await r.feed([Events.ToggleOn.make({ literal: 'toggleon' as const, value: 4 })], false) // valid
      await r.feed([], true)

      const whenOn = (await r.machine.peek()).value?.as(On)
      if (!whenOn) throw new Unreachable()

      // because the valid three events have values 1,2,4, the sum of the value captured by the On state should be 1 + 2 + 4
      expect(whenOn.payload.sum).toBe(1 + 2 + 4)
    })
  })

  describe('failure', () => {
    const { Events, Initial, ThrownError } = ProtocolFaulty

    const initialize = () => {
      const runner = new Runner(Initial, undefined)
      const machine = runner.machine
      machine.events.on('error', () => {
        // silence error
      })
      return {
        runner,
        machine,
      }
    }

    const expectError = (error: unknown) => {
      expect(error).toBeInstanceOf(MachineRunnerFailure)
      if (!(error instanceof MachineRunnerFailure)) throw new Unreachable()
      expect(error.cause).toBe(ThrownError)
    }

    describe('next method', () => {
      it('should reject held promise', async () => {
        const { runner, machine } = initialize()

        const promise = machine.next() // held promise = promise before throw
        await runner.feed([Events.Throw], true)

        const error = await promise.then((t) => null).catch((e) => e)
        expectError(error)
      })

      it('should reject subsequent promise', async () => {
        const { runner, machine } = initialize()

        await runner.feed([Events.Throw], true)
        const promise = machine.next() // subsequent promise = promise after throw

        const error = await promise.then((t) => null).catch((e) => e)
        expectError(error)
      })
    })

    describe('peek method', () => {
      it('should reject held promise', async () => {
        const { runner, machine } = initialize()

        const promise = machine.peek() // held promise = promise before throw
        await runner.feed([Events.Throw], true)

        const error = await promise.then((t) => null).catch((e) => e)
        expectError(error)
      })

      it('should reject subsequent promise', async () => {
        const { runner, machine } = initialize()

        await runner.feed([Events.Throw], true)
        const promise = machine.peek() // subsequent promise = promise after throw

        const error = await promise.then((t) => null).catch((e) => e)
        expectError(error)
      })
    })

    describe('for-await', () => {
      const test = async (machine: ReturnType<MachineRunner.Any['noAutoDestroy']>) => {
        let afterLoopExecuted = false
        const run = async () => {
          for await (const s of machine) {
            await s.as(Initial, (whenInitial) => whenInitial.commands()?.throw())
          }
          afterLoopExecuted = true
        }

        const error = await run()
          .then(() => null)
          .catch((e) => e)

        expect(afterLoopExecuted).toBe(false)
        expect(error).toBeInstanceOf(MachineRunnerFailure)
        if (!(error instanceof MachineRunnerFailure)) throw new Unreachable()
        expect(error.cause).toBe(ThrownError)
      }

      describe('main machine', () => {
        it('should throw in-loop failure', async () => {
          const { runner, machine } = initialize()
          await runner.feed([], true)
          await test(machine)
        })

        it('should throw failure before loop', async () => {
          const { runner, machine } = initialize()
          await runner.feed([Events.Throw], true)
          await test(machine)
        })
      })

      describe('noAutoDestroy', () => {
        it('should throw in-loop failure', async () => {
          const { runner, machine } = initialize()
          await runner.feed([], true)
          await test(machine.noAutoDestroy())
          machine.destroy()
        })

        it('should throw failure before the loop', async () => {
          const { runner, machine } = initialize()
          await runner.feed([Events.Throw], true)
          await test(machine.noAutoDestroy())
          machine.destroy()
        })
      })
    })
  })
})

describe('machine runner events', () => {
  describe('debug.bootTime', () => {
    const { On } = ProtocolSwitch
    const { ToggleOff, ToggleOn } = ProtocolSwitch.Events

    it('should yield identity, duration, and event counts correctly', async () => {
      const WAIT_TIME = 50
      const r1 = new Runner(On, { toggleCount: 0 })
      const { machine } = r1

      let bootData = null as null | {
        identity: Readonly<{
          swarmProtocolName: string
          machineName: string
          tags: Readonly<Tags>
        }>
        durationMs: number
        eventCount: number
      }
      machine.events.addListener('debug.bootTime', (x) => (bootData = x))

      await r1.feed([ToggleOn], false)
      await sleep(WAIT_TIME)
      await r1.feed([ToggleOff], true)

      expect(bootData).not.toBe(null)
      expect(bootData?.durationMs).toBeGreaterThanOrEqual(WAIT_TIME)
      expect(bootData?.eventCount).toBe(2)
      expect(bootData?.identity.swarmProtocolName).toBe(ProtocolSwitch.SWARM_NAME)
      expect(bootData?.identity.machineName).toBe(ProtocolSwitch.MACHINE_NAME)
      expect(bootData?.identity.tags).toBe(r1.tag)
    })
  })
})

describe('machine as async generator', () => {
  const { On, Off } = ProtocolSwitch
  const { ToggleOff, ToggleOn } = ProtocolSwitch.Events

  it('should not yield snapshot if destroyed', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1
    machine.destroy()
    const iterResult = await machine.next()
    expect(iterResult.done).toBe(true)
  })

  it('should yield initial state after first caughtUp', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1

    let resolved = false
    const promise = machine.next()
    promise.then(() => {
      resolved = true
    })

    // First caughtUp after TIMEOUT
    r1.feed([], false)
    expect(resolved).toBe(false)
    r1.feed([], true)

    // await promise here
    const iterResult = await promise
    expect(resolved).toBe(true)

    if (iterResult.done !== false) throw new Unreachable()

    const snapshot = iterResult.value
    const typeTest = snapshot.as(On)
    const typeTest2: NotAnyOrUnknown<typeof typeTest> = typeTest
    NOP(typeTest2)

    expect(snapshot).toBeTruthy()
    expect(snapshot.as(Off)).toBeFalsy()
    expect(snapshot.as(On, (state) => state.payload.toggleCount)).toBe(0)
    machine.destroy()
  })

  it('should only yield on "next" event', async () => {
    const watchPromise = (promise: Promise<unknown>) => {
      let finished = false
      const isFinished = () => finished
      promise.finally(() => (finished = true))
      return { isFinished }
    }

    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1

    const issueToggleCommand = (snap: StateOpaque.Of<typeof machine> | null) => {
      const state = snap?.as(On) || snap?.as(Off)
      return state?.commands()?.toggle()
    }

    const promise1 = machine.next()
    const promise1Watcher = watchPromise(promise1)

    expect(promise1Watcher.isFinished()).toBe(false)
    await r1.feed([], true)
    // True: from first caughtUp event
    expect(promise1Watcher.isFinished()).toBe(true)

    const promise2 = machine.next()
    const promise2Watcher = watchPromise(promise2)
    expect(promise2Watcher.isFinished()).toBe(false)
    await r1.feed([], true)
    // False: no change happens between the previous caughtUp and the current caughtUp
    expect(promise2Watcher.isFinished()).toBe(false)

    await issueToggleCommand(machine.get())
    await sleep(1)
    // True: `issueToggleCommand` above triggers a change, which then triggers a
    // caughtUp
    expect(promise2Watcher.isFinished()).toBe(true)

    const promise3 = machine.next()
    const promise3Watcher = watchPromise(promise3)

    await r1.timeTravel()
    expect(promise3Watcher.isFinished()).toBe(false)
    await r1.feed([], true)

    // True: before the time travel, a command is issued, yielding an event that
    // caused a state change after the time travel, the same event isn't
    // yielded, therefore the machine does not reach to the same state
    expect(promise3Watcher.isFinished()).toBe(true)
  })

  it('should not yield next when state does not change even though time travel happens', async () => {
    const watchPromise = (promise: Promise<unknown>) => {
      let finished = false
      const isFinished = () => finished
      promise.finally(() => (finished = true))
      return { isFinished }
    }

    const r1 = new Runner(On, { toggleCount: 0 })

    await r1.feed([ToggleOff.make({})], true)
    await r1.machine.next()

    const promise = r1.machine.next()
    const promiseWatcher = watchPromise(promise)

    await r1.feed([], true)
    // False: no changes from previous 'caughtUp'
    expect(promiseWatcher.isFinished()).toBe(false)

    await r1.timeTravel()
    await r1.feed([ToggleOff.make({})], true)
    // False: no changes from previous 'caughtUp'.
    // time travel, followed by, ToggleOff
    expect(promiseWatcher.isFinished()).toBe(false)

    await r1.feed([ToggleOn.make({})], false)
    // False: because there is no 'caughtUp' event
    expect(promiseWatcher.isFinished()).toBe(false)

    await r1.feed([], true)
    // True: because a change happens between previous and current 'caughtUp'
    expect(promiseWatcher.isFinished()).toBe(true)
  })

  it('should resolve all previously unsolved yielded promises on one next event', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    const { machine } = r1

    const promise1 = machine.next()
    const promise2 = machine.next()

    r1.feed([ToggleOff.make({})], true)
    const res1 = await promise1
    const res2 = await promise2

    const val1 = (!res1.done && res1.value) || null
    const val2 = (!res2.done && res2.value) || null
    expect(val1).toBeTruthy()
    expect(val2).toBeTruthy()
    expect(val1?.as(Off)).toBeTruthy()
    expect(val2?.as(Off)).toBeTruthy()

    machine.destroy()
  })

  it('should be destroyed on breaks from for-await loop', async () => {
    const r1 = new Runner(On, { toggleCount: 0 })
    r1.feed([], true)
    let i = 0
    for await (const state of r1.machine) {
      i++
      if (i > 3) {
        break
      }
      await state.as(On, (s) => s.commands()?.toggle())
      await state.as(Off, (s) => s.commands()?.toggle())
    }
    expect(r1.machine.isDestroyed()).toBe(true)
  })

  it('should iterate only on state-change and caughtUp', async () => {
    const { Off, On } = ProtocolSwitch

    const r = new Runner(On, { toggleCount: 0 })
    const machine = r.machine
    r.feed([], true)

    errorCatcher(machine.events) // silence global console.warn from error logs

    let toggleCount = 0
    let iterationCount = 0

    for await (const state of machine) {
      iterationCount += 1
      toggleCount =
        state.as(On, (x) => x.payload.toggleCount) ||
        state.as(Off, (x) => x.payload.toggleCount) ||
        toggleCount

      const whenOn = state.as(On)
      if (whenOn) {
        if (whenOn.payload.toggleCount > 0) {
          break
        }

        // spamming toggle commands
        // to prove that 'next' is not affected by spam of command calls
        const promise1 = whenOn.commands()?.toggle()
        const promise2 = whenOn.commands()?.toggle()
        const promise3 = whenOn.commands()?.toggle()

        const promises = [promise1, promise2, promise3].map((promise) =>
          promise?.catch((e) => null),
        )
        // the last two commands() should return undefined starting from v0.5.0
        expect(promise2).toBe(undefined)
        expect(promise3).toBe(undefined)
        await Promise.all(promises)

        await sleep(5) // should be enough so that the previous commands are received back and processed

        // attempt expired calls
        // to prove that 'next' is not affected by spam of command calls
        const command = whenOn.commands()
        expect(command).toBe(undefined)
        await whenOn.commands()?.toggle()
      }

      const whenOff = state.as(Off)
      if (whenOff) {
        await whenOff.commands()?.toggle()
      }
    }

    // iterationCount = toggleCount + initial iteration from r.feed([], true)
    expect(iterationCount).toBe(toggleCount + 1)
    // The circuit above should go this way: On->Off->On
    // that's 2 toggles
    expect(toggleCount).toBe(2)
  })

  describe('peek', () => {
    it('should not consume nextqueue', async () => {
      const r1 = new Runner(On, { toggleCount: 0 })
      const machine = r1.machine

      r1.feed([], true)

      const peekResult = await machine.peek()
      expect(peekResult).toBeTruthy()

      const nextResult = await machine.next()
      expect(nextResult.done).toBe(peekResult.done)
      expect(nextResult.value).toBe(peekResult.value)
    })

    it('should be resolved together with next regardless of order', async () => {
      const r1 = new Runner(On, { toggleCount: 0 })
      const machine = r1.machine

      await (async () => {
        // Peek first
        const peekPromise = machine.peek()
        const nextPromise = machine.next()

        r1.feed([], true)

        const peekResult = await peekPromise
        const nextResult = await nextPromise

        expect(nextResult.done).toBe(peekResult.done)
        expect(nextResult.value).toBe(peekResult.value)
      })()

      await (async () => {
        // Next first
        const nextPromise = machine.next()
        const peekPromise = machine.peek()

        r1.feed([ToggleOff.make({})], true)

        const peekResult = await peekPromise
        const nextResult = await nextPromise

        expect(nextResult.done).toBe(peekResult.done)
        expect(nextResult.value).toBe(peekResult.value)
      })()
    })
  })

  describe('non-destroying cloned async generator', () => {
    it('should not wait after main generator peek', async () => {
      const r1 = new Runner(On, { toggleCount: 0 })
      const machine = r1.machine

      r1.feed([], true)

      const peekResult = (await machine.peekNext()).value
      const copy = machine.noAutoDestroy()
      expect(await Promise.race([machine.next(), sleep(1)])).toEqual({
        done: false,
        value: peekResult,
      })
      for await (const state of copy) {
        expect(state).toBe(peekResult)
        break
      }
    })

    it('should generate the same snapshot as parent', async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      r.feed([{ type: ToggleOff.type }], true)

      // peek should come before next
      const cres1 = await cloned.peek()
      const mres1 = await machine.next()
      const mval1 = (!mres1.done && mres1.value) || null
      const cval1 = (!cres1.done && cres1.value) || null

      expect(mval1?.as(Off)).toBeTruthy()
      expect(cval1?.as(Off)).toBeTruthy()

      r.feed([{ type: ToggleOn.type }], true)

      // peek should come before next
      const cres2 = await cloned.peek()
      const mres2 = await machine.next()
      const mval2 = (!mres2.done && mres2.value) || null
      const cval2 = (!cres2.done && cres2.value) || null

      expect(mval2?.as(On)).toBeTruthy()
      expect(cval2?.as(On)).toBeTruthy()
    })

    it("should not affect parent's destroyed status", async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      await r.feed([{ type: ToggleOff.type }], true)
      // peek should come before next
      const cres1 = await cloned.peek()
      const mres1 = await machine.next()
      expect(mres1.done).toBeFalsy()
      expect(cres1.done).toBeFalsy()

      await r.feed([{ type: ToggleOn.type }], true)

      // attempt to kill
      cloned.return?.()
      cloned.throw?.()

      // peek should come before next
      const cres2 = await cloned.peek()
      const mres2 = await machine.next()

      expect(mres2.done).toBeFalsy()
      expect(cres2.done).toBeTruthy()
    })

    it('should be destroyed when parent is destroyed', async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine
      const cloned = machine.noAutoDestroy()

      r.feed([{ type: ToggleOff.type }], true)

      machine.destroy()

      const mres1 = await machine.next()
      const cres1 = await cloned.next()

      expect(mres1.done).toBeTruthy()
      expect(cres1.done).toBeTruthy()
    })

    it('should share stored held promise with parent', async () => {
      const r = new Runner(On, { toggleCount: 0 })
      const machine = r.machine

      // trigger caught up before cloning
      await r.feed([{ type: ToggleOff.type }], true)
      const mres1 = await machine.peek()

      // clone after caught up
      // the `peek` below must not require another `caughtUp`
      const cloned = machine.noAutoDestroy()
      const cres1 = await cloned.peek()

      expect(mres1).toEqual(cres1)
    })
  })
})

describe('StateOpaque', () => {
  const { Events, Initial, Second, XCommandParam, XEmittedEvents, YEmittedEvents } = ProtocolOneTwo
  const { One, Two } = Events

  describe('Commands', () => {
    it('should emit protocol-determined events', async () => {
      const r1 = new Runner(Initial, { transitioned: false })
      await r1.feed([], true)

      const whenInitial = r1.machine.get()?.as(Initial)
      const commands = whenInitial?.commands()
      if (!whenInitial || !commands) throw new Unreachable()

      await commands.X(...XCommandParam)
      r1.assertPersistedAsMachineEvent(...XEmittedEvents)
    })

    describe('additional tags', () => {
      const ToggleOn = MachineEvent.design('ToggleOn').withoutPayload()
      const ToggleOff = MachineEvent.design('ToggleOff').withoutPayload()

      const protocol = SwarmProtocol.make('switch', [ToggleOn, ToggleOff])

      const machine = protocol.makeMachine('switch')

      type StatePayload = { toggleCount: number }
      const On = machine
        .designState('On')
        .withPayload<StatePayload>()
        .command('off', [ToggleOff], ({ withTags }) => [
          withTags(['extra-tag-off'], ToggleOff.make({})),
        ])
        .finish()
      const Off = machine
        .designState('Off')
        .withPayload<StatePayload>()
        .command('on', [ToggleOn], () => [ToggleOn.make({})])
        .finish()

      On.react([ToggleOff], Off, (context) => ({ toggleCount: context.self.toggleCount + 1 }))
      Off.react([ToggleOn], On, (context) => ({ toggleCount: context.self.toggleCount + 1 }))

      it('should support additional tags via command definition', async () => {
        const r1 = new Runner(On, { toggleCount: 0 })
        r1.feed([], true)

        await r1.machine.get()?.as(On)?.commands()?.off()
        r1.assertPersistedWithFn(([ev]) => {
          expect(ev.meta.tags).toContain('extra-tag-off')
        })
      })
    })

    describe('Errors', () => {
      describe('When Not Caught Up', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })

          await r1.feed([], true) // trigger caughtUpFirstTime
          const stashedCommands = r1.machine.get()?.as(Initial)?.commands()
          if (!stashedCommands) throw new Unreachable()
          expect(stashedCommands).toBeTruthy()
          await r1.feed([], false) // trigger !caughtUp

          return { r1, stashedCommands }
        }

        it('should be undefined', async () => {
          const { r1 } = await setup()

          const whenInitial = r1.machine.get()?.as(Initial)
          if (!whenInitial) throw new Unreachable()
          const commands = whenInitial.commands()

          expect(commands).toBe(undefined)
        })

        it('should throw and emit nothing when force-called', async () => {
          const { r1, stashedCommands } = await setup()

          const errorCatchers = r1.makeErrorCatchers()
          const returnedError = await stashedCommands
            .X(...XCommandParam)
            .then(() => null)
            .catch((e) => e)

          ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
            expect(error).toBeInstanceOf(MachineRunnerErrorCommandFiredWhenNotCaughtUp)
          })

          r1.assertPersistedAsMachineEvent()
        })
      })

      describe('When Event Queue Is Not Empty', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })
          await r1.feed([], true)

          const stashedCommands = r1.machine.get()?.as(Initial)?.commands()
          if (!stashedCommands) throw new Unreachable()
          expect(stashedCommands).toBeTruthy()

          await r1.feed([One.make({ x: 1 })], true) // load the queue

          return { r1, stashedCommands }
        }

        it('should be undefined', async () => {
          const { r1 } = await setup()
          const whenInitial = r1.machine.get()?.as(Initial)
          if (!whenInitial) throw new Unreachable()

          expect(whenInitial.commands()).toBe(undefined)
        })

        it(`should throw and emit nothing when force-called`, async () => {
          const { r1, stashedCommands } = await setup()

          const errorCatchers = r1.makeErrorCatchers()
          const returnedError = await stashedCommands
            .X(...XCommandParam)
            .then(() => null)
            .catch((e) => e)

          ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
            expect(error).toBeInstanceOf(MachineRunnerErrorCommandFiredAfterExpired)
          })

          r1.assertPersistedAsMachineEvent()
        })
      })

      describe('When Expired', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })
          await r1.feed([], true)

          const state = r1.machine.get()?.as(Initial)
          if (!state) throw new Unreachable()
          const stashedCommands = state.commands()
          if (!stashedCommands) throw new Unreachable()

          // Expire by transforming
          await r1.feed([One.make({ x: 1 }), Two.make({ y: 1 })], true)
          return { r1, expiredState: state, stashedCommands }
        }

        it('should be undefined', async () => {
          const { expiredState: state } = await setup()
          expect(state.commands()).toBe(undefined)
        })

        it('should throw and emit nothing when force-called', async () => {
          const { r1, stashedCommands } = await setup()

          const errorCatchers = r1.makeErrorCatchers()
          const returnedError = await stashedCommands
            .X(...XCommandParam)
            .then(() => null)
            .catch((e) => e)

          ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
            expect(error).toBeInstanceOf(MachineRunnerErrorCommandFiredAfterExpired)
          })
          r1.assertPersistedAsMachineEvent()
        })
      })

      describe('When Destroyed', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })
          await r1.feed([], true)
          const stashedCommands = r1.machine.get()?.as(Initial)?.commands()
          if (!stashedCommands) throw new Unreachable()
          r1.machine.destroy()
          return { r1, stashedCommands }
        }

        it('should be undefined', async () => {
          const { r1 } = await setup()
          const whenInitial = r1.machine.get()?.as(Initial)
          if (!whenInitial) throw new Unreachable()
          expect(whenInitial.commands()).toBe(undefined)
        })

        it('should throw and emit nothing when force-called', async () => {
          const { r1, stashedCommands } = await setup()

          const errorCatchers = r1.makeErrorCatchers()
          const returnedError = await stashedCommands
            .X(...XCommandParam)
            .then(() => null)
            .catch((e) => e)

          ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
            expect(error).toBeInstanceOf(MachineRunnerErrorCommandFiredAfterDestroyed)
          })
          r1.assertPersistedAsMachineEvent()
        })
      })

      describe('When Locked and then Resolved', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })
          await r1.feed([], true)

          const state = r1.machine.get()?.as(Initial)
          const commands = state?.commands()
          if (!state || !commands) throw new Unreachable()

          // Delay publication promise resolution.
          // Next command will locks the machine until delay is released
          await r1.toggleCommandDelay({ delaying: true })
          const delayRelease = async () => {
            await r1.toggleCommandDelay({ delaying: false, reject: false })
            await lockingCommandPromise
            r1.clearPersisted()
          }

          // Locks the machine
          const lockingCommandPromise = commands.X(...XCommandParam)
          r1.clearPersisted()

          return { r1, delayRelease, stashedCommands: commands }
        }

        it('should be undefined', async () => {
          const { r1, delayRelease } = await setup()
          const state = r1.machine.get()?.as(Initial)
          if (!state) throw new Unreachable()

          // both commands from the pre-resolution state will be undefined
          // lock stays after its publication succeeded
          // because soon either 1.) the state is expired, 2.) the emitter has a non-empty queue

          expect(state.commands()).toBe(undefined)
          // release delay, wait until all commands are published
          await delayRelease()
          expect(state.commands()).toBe(undefined)
        })

        it('should throw and emit nothing when force-called', async () => {
          const { r1, delayRelease, stashedCommands } = await setup()

          // both commands from the pre-resolution state will be undefined
          // lock stays after its publication succeeded
          // because soon either 1.) the state is expired, 2.) the emitter has a non-empty queue

          await (async () => {
            const errorCatchers = r1.makeErrorCatchers()
            const returnedError = await stashedCommands
              .X(...XCommandParam)
              .then(() => null)
              .catch((e) => e)

            ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
              expect(error).toBeInstanceOf(MachineRunnerErrorCommandFiredAfterLocked)
            })
            r1.assertPersistedAsMachineEvent()
          })()

          // release delay, wait until all commands are published
          await delayRelease()

          await (async () => {
            // Tests for either of these errors: expiry, locked, non-empty queue
            const errorCatchers = r1.makeErrorCatchers()
            const returnedError = await stashedCommands
              .X(...XCommandParam)
              .then(() => null)
              .catch((e) => e)

            ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
              expect(error).toBeTruthy()
            })
            r1.assertPersistedAsMachineEvent()
          })()
        })

        describe('new state after resolution', () => {
          it('should be unlocked', async () => {
            const { delayRelease, r1 } = await setup()
            await delayRelease()

            // trigger reaction
            await r1.feed([Two.make({ y: 1 })], true)

            // state created after resolution
            // assuming no queued events
            const state = r1.machine.get()?.as(Second)
            const commands = state?.commands()
            expect(state).toBeTruthy()
            expect(commands).toBeTruthy()
            if (!state || !commands) throw new Unreachable()

            const error = await commands
              .Y()
              .then(() => null)
              .catch((e) => e)

            expect(error).toBe(null)
            r1.assertPersistedAsMachineEvent(...YEmittedEvents)
          })
        })
      })

      describe('When Locked and then Rejected', () => {
        const setup = async () => {
          const r1 = new Runner(Initial, { transitioned: false })
          await r1.feed([], true)

          const state = r1.machine.get()?.as(Initial)
          const commands = state?.commands()
          if (!state || !commands) throw new Unreachable()

          // Delay publication promise resolution.
          // Next command will locks the machine until delay is released
          await r1.toggleCommandDelay({ delaying: true })
          const delayRelease = async () => {
            await r1.toggleCommandDelay({ delaying: false, reject: true })
            await lockingCommandPromise.catch(() => {})
          }

          // Locks the machine
          const lockingCommandPromise = commands.X(...XCommandParam)
          r1.clearPersisted()

          return { r1, delayRelease, stashedCommands: commands }
        }

        it('should not be undefined after previous persist fails', async () => {
          const { r1, delayRelease } = await setup()
          const state = r1.machine.get()?.as(Initial)
          if (!state) throw new Unreachable()
          await delayRelease()
          expect(state.commands()).not.toBe(undefined)
        })

        it('should be unlocked after previous persist fails', async () => {
          const { r1, delayRelease, stashedCommands } = await setup()
          await delayRelease()
          await (async () => {
            const errorCatchers = r1.makeErrorCatchers()
            const returnedError = await stashedCommands
              .X(...XCommandParam)
              .then(() => null)
              .catch((e) => e)

            ;[...errorCatchers.map((catcher) => catcher.error), returnedError].map((error) => {
              expect(error).toBe(null)
            })
            r1.assertPersistedAsMachineEvent(...XEmittedEvents)
          })()
        })
      })
    })
  })

  describe('.get function', () => {
    it('should return null beforee encountering caughtUp for the first time', () => {
      const r1 = new Runner(Initial, { transitioned: false })

      expect(r1.machine.get()).toBe(null)
      r1.feed([], false)
      expect(r1.machine.get()).toBe(null)
      r1.feed([], true)
      expect(r1.machine.get()).toBeTruthy()
      r1.feed([], false)
      expect(r1.machine.get()).toBeTruthy()
    })
  })

  describe('.is function', () => {
    it('should match by factory and reduce type inside block', () => {
      const r1 = new Runner(Initial, { transitioned: false })

      r1.feed([], true)

      const s1 = r1.machine.get()

      if (!s1) throw new Unreachable()

      expect(s1.is(Initial)).toBe(true)
      expect(s1.is(Second)).toBe(false)

      if (!s1.is(Initial)) throw new Unreachable()
      expect(s1.payload.transitioned).toBe(false)

      const r2 = new Runner(Second, { x: 1, y: 2 })
      r2.feed([], true)
      const s2 = r2.machine.get()

      if (!s2) throw new Unreachable()
      expect(s2.is(Second)).toBe(true)
      expect(s2.is(Initial)).toBe(false)

      if (!s2.is(Second)) throw new Unreachable()
      expect(s2.payload.x).toBe(1)
      expect(s2.payload.y).toBe(2)
    })
  })

  describe('.cast function', () => {
    it('should produce state snapshot after is', () => {
      const r = new Runner(Initial, { transitioned: false })
      r.feed([], true)
      const s = r.machine.get()

      if (!s) throw new Unreachable()

      if (!s.is(Initial)) throw new Unreachable()
      const snapshot = s.cast()
      expect(snapshot.commands()?.X).toBeTruthy()
    })
  })

  describe('.as function', () => {
    it('should produce state snapshot', () => {
      // Initial State

      ;(() => {
        const r = new Runner(Initial, { transitioned: false })
        r.feed([], true)

        const s = r.machine.get()

        r.feed([], true)
        const state = r.machine.get()

        if (!state) throw new Unreachable()

        const snapshot1Invalid = state.as(Second)
        expect(snapshot1Invalid).toBeFalsy()

        const snapshot1 = state.as(Initial)
        expect(snapshot1).toBeTruthy()

        if (!snapshot1) throw new Unreachable()

        expect(snapshot1.commands()?.X).toBeTruthy()
        expect(snapshot1.payload.transitioned).toBe(false)
      })()

      // Second State
      ;(() => {
        const r = new Runner(Second, { x: 1, y: 2 })
        r.feed([], true)

        const s = r.machine.get()

        r.feed([], true)

        const state = r.machine.get()

        if (!state) throw new Unreachable()
        const snapshot2Invalid = state.as(Initial)
        expect(snapshot2Invalid).toBeFalsy()

        const stateAsSecond = state.as(Second)
        expect(stateAsSecond).toBeTruthy()

        if (stateAsSecond) {
          expect(stateAsSecond.payload.x).toBe(1)
          expect(stateAsSecond.payload.y).toBe(2)
        }
      })()
    })
  })
})

describe('reactIntoSelf', () => {
  it('should work', async () => {
    const r = new Runner(ProtocolScorecard.Initial, undefined)
    await r.feed(
      [
        ProtocolScorecard.Events.Begin.make({
          par: 3,
          playerIds: ['a', 'b', 'c'],
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'a',
          numberOfShots: 1,
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'b',
          numberOfShots: 2,
        }),
        ProtocolScorecard.Events.Score.make({
          playerId: 'c',
          numberOfShots: 3,
        }),
        ProtocolScorecard.Events.End.make({}),
      ],
      true,
    )

    const scoreMap = r.machine.get()?.as(ProtocolScorecard.Result)?.payload.scoreMap
    if (!scoreMap) throw new Unreachable()

    const scoreMapAsArray = Array.from(scoreMap.entries())
    expect(scoreMapAsArray).toContainEqual(['a', 1])
    expect(scoreMapAsArray).toContainEqual(['b', 2])
    expect(scoreMapAsArray).toContainEqual(['c', 3])
  })
})

describe('globals.activeRunners', () => {
  it('should contain all living runners', () => {
    const r1 = new Runner(ProtocolSwitch.On, { toggleCount: 0 })
    const r2 = new Runner(ProtocolThreeSwitch.On, { sum: 0 })
    const r3 = new Runner(ProtocolScorecard.Initial, undefined)

    const findMachine = (machine: MachineRunner.Any) =>
      globals.activeRunners.all().find((x) => x[0] === machine)

    const entries = [
      findMachine(r1.machine),
      findMachine(r2.machine),
      findMachine(r3.machine),
    ] as const

    expect(entries[0]).toBeTruthy()
    expect(entries[1]).toBeTruthy()
    expect(entries[2]).toBeTruthy()

    if (!entries[0]) throw new Unreachable()
    if (!entries[1]) throw new Unreachable()
    if (!entries[2]) throw new Unreachable()

    expect(entries[0][1]).toEqual({ tags: r1.tag, initialFactory: ProtocolSwitch.On })
    expect(entries[1][1]).toEqual({ tags: r2.tag, initialFactory: ProtocolThreeSwitch.On })
    expect(entries[2][1]).toEqual({ tags: r3.tag, initialFactory: ProtocolScorecard.Initial })

    r3.machine.destroy()
    // the remaining 2 exists but the destroyed one has been registered
    expect(findMachine(r1.machine)).toBeTruthy()
    expect(findMachine(r2.machine)).toBeTruthy()
    expect(findMachine(r3.machine)).toBe(undefined)
  })
})
