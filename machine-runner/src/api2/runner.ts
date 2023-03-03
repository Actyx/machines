import { Actyx, ActyxEvent, EventKey, MsgType, Tags } from '@actyx/sdk'
import { StateLensOpaque, Event, StateLensCommon } from './state-machine.js'
import { Agent } from '../api2utils/agent.js'
import { Obs } from '../api2utils/obs.js'

export const createMachineRunner = <E extends Event.Any>(
  sdk: Actyx,
  query: Tags<E>,
  stateContainer: StateLensOpaque,
) =>
  Agent.startBuild()
    .setChannels((c) => ({
      ...c,
      audit: {
        reset: Obs.make<void>(),
        state: Obs.make<unknown>(),
        dropped: Obs.make<ActyxEvent<Event.Any>[]>(),
        error: Obs.make<string>(),
      },
      log: Obs.make<string>(),
    }))
    .setAPI((agent) => {
      const subscribeMonotonicQuery = {
        query,
        sessionId: 'dummy',
        attemptStartFrom: { from: {}, latestEventKey: EventKey.zero },
      }

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
                const handledBy = stateContainer.pushEvent(event)
                if (handledBy.handling === StateLensCommon.ReactionHandling.Execute) {
                  agent.channels.audit.state.emit(stateContainer.get())
                  if (handledBy.orphans.length > 0) {
                    agent.channels.audit.dropped.emit(handledBy.orphans)
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

      // Important part, if agent is killed, unsubscribe is called
      agent.addDestroyHook(unsubscribe)

      return {
        get: () => stateContainer,
      }
    })
    .build()
