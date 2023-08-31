import { EventEmitter } from 'events'
import { GlobalEmitter } from './runner/runner-utils.js'

export const emitter = new EventEmitter() as GlobalEmitter
