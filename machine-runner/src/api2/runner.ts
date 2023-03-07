import { Actyx, ActyxEvent, EventKey, MsgType, Tags } from '@actyx/sdk'
import { StateContainerOpaque, Event, StateContainerCommon, State } from './state-machine.js'
import { Agent } from '../api2utils/agent.js'
import { Obs } from '../api2utils/obs.js'

export type MachineRunner = ReturnType<typeof createMachineRunner>

export const createMachineRunner = (
  sdk: Actyx,
  query: Tags<any>,
  stateContainer: StateContainerOpaque,
) =>
  Agent.startBuild()
    .setChannels((c) => ({
      ...c,
      audit: {
        reset: Obs.make<void>(),
        state: Obs.make<{
          state: State.Any
          events: ActyxEvent<Event.Any>[]
        }>(),
        dropped: Obs.make<{
          state: State.Any
          events: ActyxEvent<Event.Any>[]
        }>(),
        error: Obs.make<{
          state: State.Any
          events: ActyxEvent<Event.Any>[]
          error: unknown
        }>(),
      },
      log: Obs.make<string>(),
    }))
    .setAPI((agent) => {
      const subscribeMonotonicQuery = {
        query,
        sessionId: 'dummy',
        attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
      }

      const persist = (e: any[]) =>
        sdk.publish(query.apply(...e)).catch((err) => console.error('error publishing', err, ...e))

      let unsub = null as null | (() => void)

      const unsubscribe = () => {
        unsub?.()
        unsub = null
      }
      const restartSubscription = () => {
        unsubscribe()
        unsub = sdk.subscribeMonotonic<Event.Any>(
          subscribeMonotonicQuery,
          (d) => {
            if (d.type === MsgType.timetravel) {
              agent.channels.log.emit('Time travel')

              stateContainer.reset()
              agent.channels.audit.reset.emit()

              restartSubscription()
            } else if (d.type === MsgType.events) {
              for (const event of d.events) {
                // TODO: Runtime typeguard for event
                const prevState = { ...stateContainer.get() }
                const handlingreport = stateContainer.pushEvent(event)
                const nextState = { ...stateContainer.get() }
                console.log({
                  event,
                  handlingreport,
                  mechanism: stateContainer.factory().mechanism(),
                  factory: stateContainer.factory(),
                  prevState,
                  nextState,
                })
                if (handlingreport.handling === StateContainerCommon.ReactionHandling.Execute) {
                  agent.channels.audit.state.emit({
                    state: stateContainer.get(),
                    events: handlingreport.queueSnapshotBeforeExecution,
                  })
                  if (handlingreport.orphans.length > 0) {
                    agent.channels.audit.dropped.emit({
                      state: stateContainer.get(),
                      events: handlingreport.orphans,
                    })
                  }
                }
              }
              if (d.caughtUp) {
                // the SDK translates an OffsetMap response into MsgType.events with caughtUp=true
                agent.channels.log.emit('Caught up')
                agent.channels.change.emit()
              }
            }
          },
          (err) => {
            agent.channels.log.emit('Restarting in 1sec due to error')

            stateContainer.reset()
            agent.channels.audit.reset.emit()

            unsubscribe()
            setTimeout(() => restartSubscription, 1000)
          },
        )
      }

      // run subscription
      restartSubscription()

      // Pipe events from stateContainer to sdk

      const unsubEventsPipe = stateContainer.obs().sub((events) => {
        persist(events)
      })

      // Important part, if agent is killed, unsubscribe is called
      agent.addDestroyHook(unsubEventsPipe)
      agent.addDestroyHook(unsubscribe)

      return {
        get: () => stateContainer,
      }
    })
    .build()
