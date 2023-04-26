import { nanoid } from 'nanoid'

export type DockSim = ReturnType<typeof DockSim.make>
export namespace DockSim {
  export type ShipId = string

  export type OnDockDirection = OnDockDirection.In | OnDockDirection.Out
  export namespace OnDockDirection {
    export const Out: unique symbol = Symbol('out')
    export type Out = typeof Out
    export const In: unique symbol = Symbol('in')
    export type In = typeof In
  }

  const createInternals = () => ({
    // static
    docked: new Map<ShipId, { since: Date }>(),

    // requests
    undockingRequests: new Map<ShipId, { at: Date }>(),
    dockingRequests: new Map<ShipId, { until: Date }>(),

    // onDock
    onRunway: new Map<ShipId, { direction: OnDockDirection; at: Date; dur: number }>(),

    // stats
    crashed: false as boolean,
    alive: true as boolean,
  })

  export const make = () => {
    const LOOP_DURATION = 250
    const UNDOCK_REQ_CHANCE_PER_MIN = 0.8
    const UNDOCK_REQ_CHANGE_PER_SECOND = UNDOCK_REQ_CHANCE_PER_MIN / 60
    const UNDOCK_REQ_CHANCE_PER_LOOP_DURATION =
      UNDOCK_REQ_CHANGE_PER_SECOND / (1000 / LOOP_DURATION)
    const DOCK_REQ_CHANGE_PER_SECOND = 0.3
    const DOCK_REQ_CHANCE_PER_LOOP_DURATION = DOCK_REQ_CHANGE_PER_SECOND / (1000 / LOOP_DURATION)

    const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur))

    const data = createInternals()

    const generateRandomDockRequest = () => {
      if (data.dockingRequests.size < 10) {
        addGuestShip()
      }
    }

    const generateRandomUndockRequest = () => {
      const potentialShip = Array.from(data.docked.keys())
        .filter((id) => data.undockingRequests.has(id))
        .at(0)

      if (potentialShip !== undefined) {
        data.undockingRequests.set(potentialShip, {
          at: new Date(),
        })
      }
    }

    const addGuestShip = () => {
      if (!data.alive || data.crashed) return
      const ship = `ship:${nanoid()}`
      const patience = (6 + Math.floor(Math.random() * 5)) * 1000
      data.dockingRequests.set(ship, { until: new Date(new Date().getTime() + patience) })
      return ship
    }

    const allowUndocking = (shipId: ShipId) => {
      if (!data.alive || data.crashed) return false
      if (!data.undockingRequests.has(shipId)) return false
      data.undockingRequests.delete(shipId)
      data.onRunway.set(shipId, {
        direction: OnDockDirection.Out,
        at: new Date(),
        dur: (4 + Math.floor(Math.random() * 6)) * 1000,
      })
      return true
    }

    const allowDocking = (shipId: ShipId) => {
      if (!data.alive || data.crashed) return false
      if (!data.dockingRequests.has(shipId)) return false
      data.dockingRequests.delete(shipId)
      data.onRunway.set(shipId, {
        direction: OnDockDirection.In,
        at: new Date(),
        dur: (4 + Math.floor(Math.random() * 6)) * 1000,
      })
      return true
    }
    const destroy = () => (data.alive = false)

    const getDockingRequests = () =>
      Array.from(data.dockingRequests.entries()).map(([id, data]) => ({
        id,
        ...data,
      }))

    const getUndockingRequests = () =>
      Array.from(data.undockingRequests).map(([id, data]) => ({
        id,
        ...data,
      }))

    const getOnRunway = () =>
      Array.from(data.onRunway.entries()).map(([id, data]) => ({
        id,
        ...data,
      }))

    const isCrashed = () => data.crashed

    ;(async () => {
      while (data.alive && !data.crashed) {
        // calculate crash
        if (!data.crashed) {
          data.crashed = data.onRunway.size > 1
        }

        // clear runway
        const pastTheDuration = Array.from(data.onRunway.entries()).filter(
          ([_, padData]) => padData.at.getTime() + padData.dur > new Date().getTime(),
        )
        pastTheDuration.forEach(([id, padData]) => {
          data.onRunway.delete(id)
          if (padData.direction === OnDockDirection.In) {
            data.docked.set(id, { since: new Date() })
          }
        })
        // generate random dock / undock reqs
        if (Math.random() < UNDOCK_REQ_CHANCE_PER_LOOP_DURATION) {
          generateRandomUndockRequest()
        }
        if (Math.random() < DOCK_REQ_CHANCE_PER_LOOP_DURATION) {
          generateRandomDockRequest()
        }

        // Remove impatient ships
        Array.from(data.dockingRequests.entries())
          .filter(([_, req]) => req.until.getTime() > new Date().getTime())
          .forEach(([id, _]) => data.dockingRequests.delete(id))

        await sleep(LOOP_DURATION)
      }
    })()

    return {
      destroy,
      isCrashed,
      addGuestShip,
      allowDocking,
      allowUndocking,
      getDockingRequests,
      getUndockingRequests,
      getOnRunway,
    }
  }

  export type UndockSignalerAgent = ReturnType<typeof UndockSignalerAgent>
  export const UndockSignalerAgent = ({
    getUndockingRequests,
    allowUndocking,
    isCrashed,
  }: DockSim) => ({
    getUndockingRequests,
    allowUndocking,
    isCrashed,
  })

  export type ShipReceivingAgent = ReturnType<typeof ShipReceivingAgent>
  export const ShipReceivingAgent = ({ getDockingRequests, allowDocking, isCrashed }: DockSim) => ({
    getDockingRequests,
    allowDocking,
    isCrashed,
  })

  export type RunwayMonitorAgent = ReturnType<typeof RunwayMonitorAgent>
  export const RunwayMonitorAgent = ({ getOnRunway, isCrashed }: DockSim) => ({
    getOnRunway,
    isCrashed,
  })
}
