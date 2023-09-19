import { Metadata } from '@actyx/sdk'
import {
  MachineRunnerError,
  MachineRunnerErrorCommandFiredAfterDestroyed,
  MachineRunnerErrorCommandFiredAfterLocked,
  MachineRunnerErrorCommandFiredWhenNotCaughtUp,
  MachineRunnerErrorCommandFiredAfterExpired,
} from '../errors.js'
/**
 * DO NOT CHANGE `any` usage in this file! TypeScript's behavior towards extends
 * `any` is completely different than `object`. `any` here tells TypeScript that
 * whatever is passed here is an important type that needs to be accounted for
 * in compilation.
 *
 * Changing some of them to unknown or object will cause issues.
 */

export type CommandDefiner<Context, Args extends unknown[], Retval> = (
  context: Context,
  ...args: Args
) => Retval

export type CommandDefinerMap<
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<unknown, Args, RetVal> },
  Args extends unknown[],
  RetVal,
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandSignature<Args extends unknown[]> = (...args: Args) => Promise<Metadata[]>

export type CommandSignatureMap<Dictionary extends { [key: string]: CommandSignature<unknown[]> }> =
  {
    [key in keyof Dictionary]: Dictionary[key]
  }

// TODO: unit test,

export type ToCommandSignatureMap<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Dictionary extends CommandDefinerMap<any, Args, RetVal>,
  Args extends unknown[],
  RetVal,
> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key in keyof Dictionary]: Dictionary[key] extends CommandDefiner<any, infer Args, any>
    ? CommandSignature<Args>
    : never
}

export type CommandGeneratorCriteria = {
  /**
   * Expired: a state snapshot is expired when it is not the host runner's current state
   */
  isNotExpired: () => boolean
  /**
   * Locked: the host runner is already processing a command publication
   */
  isNotLocked: () => boolean
  /**
   * Destroyed: the host runner is destroyed
   */
  isNotDestroyed: () => boolean
  /**
   * Caught Up: the host runner has processed all published events from Actyx from an active subscription
   */
  isCaughtUp: () => boolean
  /**
   * Queue Empty: the host runner is not withholding an event that MAY results in a future transformation to its current state
   */
  isQueueEmpty: () => boolean
}
export namespace CommandGeneratorCriteria {
  export const allOk = ({
    isCaughtUp,
    isNotDestroyed,
    isNotExpired,
    isNotLocked,
    isQueueEmpty,
  }: CommandGeneratorCriteria) =>
    isCaughtUp() && isNotDestroyed() && isNotExpired() && isNotLocked() && isQueueEmpty()

  /**
   * On snapshot, being locked does not constitute as one of the reason a command is unavailable permanently
   * Because locking is an undoable status.
   * A state that is unlocked after it has been produced is a valid state
   * Meanwhile, the other conditions are not so.
   */
  export const allOkForSnapshotTimeCommandEnablementAssessment = ({
    isCaughtUp,
    isNotDestroyed,
    isNotExpired,
    isQueueEmpty,
  }: CommandGeneratorCriteria) =>
    isCaughtUp() && isNotDestroyed() && isNotExpired() && isQueueEmpty()

  export const produceError = (
    {
      isCaughtUp,
      isNotDestroyed,
      isNotExpired,
      isNotLocked,
      isQueueEmpty,
    }: CommandGeneratorCriteria,
    messageGenerator: () => string,
  ): MachineRunnerError | null => {
    const prototype = (() => {
      if (!isCaughtUp()) return MachineRunnerErrorCommandFiredWhenNotCaughtUp
      if (!isNotDestroyed()) return MachineRunnerErrorCommandFiredAfterDestroyed
      if (!isNotExpired()) return MachineRunnerErrorCommandFiredAfterExpired
      if (!isQueueEmpty()) return MachineRunnerErrorCommandFiredAfterExpired
      if (!isNotLocked()) return MachineRunnerErrorCommandFiredAfterLocked
      return null
    })()

    if (!prototype) return null
    return new prototype(messageGenerator())
  }
}

/**
 * Used by StateContainers to get the current context of the StateContainer. It
 * is in the form of getter function so that it can be called when a command is
 * called and not when it is defined because it MAY contain a possible mutable
 * property. It is called when the command is called to make sure that it has
 * the latest mutable property in case the property turns out to be a
 * non-reference/primitives
 */
export type ActualContextGetter<Context> = () => Readonly<Context>

export type ConvertCommandMapParams<Context, RetVal> = {
  commandGeneratorCriteria: CommandGeneratorCriteria
  getActualContext: ActualContextGetter<Context>
  onReturn: (props: {
    commandKey: string
    commandGeneratorCriteria: CommandGeneratorCriteria
    generateEvents: () => RetVal
  }) => Promise<Metadata[]>
}

export const convertCommandMapToCommandSignatureMap = <
  T extends CommandDefinerMap<object, unknown[], RetVal>,
  Context,
  RetVal,
>(
  t: T,
  params: ConvertCommandMapParams<Context, RetVal>,
): ToCommandSignatureMap<T, unknown[], RetVal> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(key, definer, params)]
    }),
  ) as ToCommandSignatureMap<T, unknown[], RetVal>
}

export const convertCommandDefinerToCommandSignature = <Context, Args extends unknown[], RetVal>(
  key: string,
  definer: CommandDefiner<Context, Args, RetVal>,
  {
    getActualContext,
    onReturn,
    commandGeneratorCriteria,
  }: ConvertCommandMapParams<Context, RetVal>,
): CommandSignature<Args> => {
  return (...args: Args) => {
    return onReturn({
      commandKey: key,
      generateEvents: () => definer(getActualContext(), ...args),
      commandGeneratorCriteria,
    })
  }
}
