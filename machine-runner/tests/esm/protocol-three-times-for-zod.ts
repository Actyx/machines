import { MachineEvent, SwarmProtocol } from '../../lib/esm/index.js'
import * as z from 'zod'

export namespace Events {
  /**
   * Input type is refined:
   * - value must be more than zero
   */
  export const ToggleOn = MachineEvent.design('ToggleOn').withZod(
    z
      .object({
        literal: z.literal('toggleon'),
        value: z.number(),
      })
      .refine((p) => p.value >= 0),
  )
  export const ToggleOff = MachineEvent.design('ToggleOff').withoutPayload()
  export const all = [ToggleOff, ToggleOn] as const
}

const protocol = SwarmProtocol.make('switch-three-times-for-zod', Events.all)
const machine = protocol.makeMachine('switch-three-times-for-zod')

// On sums all three values passed through Events.ToggleOn
export const On = machine
  .designState('On')
  .withPayload<{ sum: number }>()
  .command('toggle', [Events.ToggleOff], () => [{}])
  .finish()

export const Off = machine
  .designEmpty('Off')
  .command(
    'toggle',
    [Events.ToggleOn, Events.ToggleOn, Events.ToggleOn],
    (_, payload: MachineEvent.Payload.Of<typeof Events.ToggleOn>) => [payload, payload, payload],
  )
  .finish()

On.react([Events.ToggleOff], Off, (_) => undefined)
Off.react([Events.ToggleOn, Events.ToggleOn, Events.ToggleOn], On, (_, a, b, c) => ({
  sum: a.payload.value + b.payload.value + c.payload.value,
}))
