import { DeepReadonly } from '../utils/type-utils.js'

export type CommandContext<Self extends any> = {
  self: Self
}

export type CommandDefiner<Self extends any, Args extends any[], Retval extends any> = (
  context: CommandContext<DeepReadonly<Self>>,
  ...args: Args
) => Retval

export type CommandDefinerMap<
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<any, Args, RetVal> },
  Args extends any[],
  RetVal extends any,
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandSignature<Args extends any[]> = (...args: Args) => void

export type CommandSignatureMap<Dictionary extends { [key: string]: CommandSignature<any> }> = {
  [key in keyof Dictionary]: Dictionary[key]
}

// TODO: unit test,
export type ToCommandSignatureMap<
  Dictionary extends CommandDefinerMap<any, Args, RetVal>,
  Args extends any[],
  RetVal extends any,
> = {
  [key in keyof Dictionary]: Dictionary[key] extends CommandDefiner<any, infer Args, infer Retval>
    ? CommandSignature<Args>
    : never
}

/**
 * Used by StateContainers to get the current context of the StateContainer
 * It is in the form of getter function so that it can be called when a command is called
 * and not when it is defined because it MAY contain a possible mutable property
 * It is called when the command is called to make sure that it has the latest mutable property
 * in case the property turns out to be a non-reference/primitives
 */
export type ActualContextGetter<Self> = () => Readonly<CommandContext<DeepReadonly<Self>>>

export type ConvertCommandMapParams<Self, RetVal> = {
  getActualContext: ActualContextGetter<Self>
  onReturn: (retval: RetVal) => unknown
  /**
   * isExpired is intended to flag if a snapshot that owns the reference to a command
   * is not up to date with the state container's state.
   */
  isExpired: () => boolean
}

export const convertCommandMapToCommandSignatureMap = <
  T extends CommandDefinerMap<any, any, RetVal>,
  Self extends any,
  RetVal extends any,
>(
  t: T,
  params: ConvertCommandMapParams<Self, RetVal>,
): ToCommandSignatureMap<T, any, RetVal> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(definer, params)]
    }),
  ) as ToCommandSignatureMap<T, any, RetVal>
}

export const convertCommandDefinerToCommandSignature = <
  Self extends any,
  Args extends any[],
  RetVal extends any,
>(
  definer: CommandDefiner<Self, Args, RetVal>,
  { getActualContext, onReturn, isExpired }: ConvertCommandMapParams<Self, RetVal>,
): CommandSignature<Args> => {
  return (...args: Args) => {
    if (isExpired()) {
      // TODO: Do we want to provide user an option to handle expired command?
      console.error('Command has expired')
    }
    const returnedValue = definer(getActualContext(), ...args)
    onReturn(returnedValue)
  }
}

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
