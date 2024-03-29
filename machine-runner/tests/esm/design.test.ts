/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from '@jest/globals'
import { MachineEvent } from '../../lib/esm/design/event.js'
import { z } from 'zod'

describe('MachineEvent', () => {
  it('should parse empty payload', () => {
    const event = MachineEvent.design('a').withoutPayload()
    expect(event.parse(null as any)).toEqual({
      error: 'Event null is not an object',
      success: false,
    })
    expect(event.parse({} as any)).toEqual({
      error: 'Event type undefined does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'b' } as any)).toEqual({
      error: 'Event type b does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'a' })).toEqual({
      success: true,
      event: { type: 'a' },
    })
  })

  it('should parse non-empty non-zod payload', () => {
    const event = MachineEvent.design('a').withPayload<{ a: number }>()
    expect(event.parse(null as any)).toEqual({
      error: 'Event null is not an object',
      success: false,
    })
    expect(event.parse({} as any)).toEqual({
      error: 'Event type undefined does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'b' } as any)).toEqual({
      error: 'Event type b does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'a' } as any)).toEqual({
      success: true,
      event: { type: 'a' },
    })
    expect(event.parse({ type: 'a', a: 42 })).toEqual({
      success: true,
      event: { type: 'a', a: 42 },
    })
  })

  it('should parse non-empty zod payload', () => {
    const event = MachineEvent.design('a').withZod(z.object({ a: z.number() }))
    expect(event.parse(null as any)).toEqual({
      error: 'Event null is not an object',
      success: false,
    })
    expect(event.parse({} as any)).toEqual({
      error: 'Event type undefined does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'b' } as any)).toEqual({
      error: 'Event type b does not match expected type a',
      success: false,
    })
    expect(event.parse({ type: 'a' } as any)).toEqual({
      success: false,
      error: 'Validation error: Required at "a"',
    })
    expect(event.parse({ type: 'a', a: null } as any)).toEqual({
      success: false,
      error: 'Validation error: Expected number, received null at "a"',
    })
    expect(event.parse({ type: 'a', a: 42 })).toEqual({
      success: true,
      event: { type: 'a', a: 42 },
    })
  })
})
