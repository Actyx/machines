/* eslint-disable @typescript-eslint/ban-types */

import { State, ToEmit } from './types.js'

let dict: ToEmit = {}
export const init = (d: ToEmit) => {
  dict = d
}

type M = {
  new (...args: never[]): State<{ type: string }>
}
type D = <T extends M>(constructor: T) => void

export const proto =
  (protocol: string): D =>
  (constructor) => {
    try {
      const { events, commands } = dict[protocol].states[constructor.name]
      constructor.prototype.reactions = () => events
      constructor.prototype.commands = () => commands
    } catch (e) {
      console.error(
        `failing to decorate ${protocol}:${constructor.name}: make sure to import the generated protocol file (and use its default export) before importing the state definition!`,
      )
      throw e
    }
  }
