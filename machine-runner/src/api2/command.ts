export type CommandContext<Self extends any> = {
  self: Self

  /**
   * Just for demo, we could put anything here
   */
  someSystemCall: () => unknown
}

export type CommandDefiner<Self extends any, Args extends any[], Retval extends any> = (
  context: CommandContext<Self>,
  ...args: Args
) => Retval

export type CommandDefinerMap<
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<any, Args, RetVal> },
  Args extends any[],
  RetVal extends any,
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandSignature<Args extends any[], Retval extends any> = (...args: Args) => Retval

export type CommandSignatureMap<Dictionary extends { [key: string]: CommandSignature<any, any> }> =
  {
    [key in keyof Dictionary]: Dictionary[key]
  }

// TODO: unit test,
export type ToCommandSignatureMap<
  Dictionary extends CommandDefinerMap<any, Args, RetVal>,
  Args extends any[],
  RetVal extends any,
> = {
  [key in keyof Dictionary]: Dictionary[key] extends CommandDefiner<any, infer Args, infer Retval>
    ? CommandSignature<Args, Retval>
    : never
}

/**
 * Used by StateContainers to get the current context of the StateContainer
 * It is in the form of getter function so that it can be called when a command is called
 * and not when it is defined because it MAY contain a possible mutable property
 * It is called when the command is called to make sure that it has the latest mutable property
 * in case the property turns out to be a non-reference/primitives
 */
export type ActualContextGetter<Self> = () => Readonly<CommandContext<Self>>

export const convertCommandMapToCommandSignatureMap = <
  T extends CommandDefinerMap<any, any, RetVal>,
  Self extends any,
  RetVal extends any,
>(
  t: T,
  getActualContext: () => CommandContext<Self>,
  onReturn: (retval: RetVal) => unknown,
): ToCommandSignatureMap<T, any, RetVal> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(definer, getActualContext, onReturn)]
    }),
  ) as ToCommandSignatureMap<T, any, RetVal>
}

export const convertCommandDefinerToCommandSignature = <
  Self extends any,
  Args extends any[],
  RetVal extends any,
>(
  definer: CommandDefiner<Self, Args, RetVal>,
  getActualContext: () => CommandContext<Self>,
  onReturn: (retval: RetVal) => unknown,
): CommandSignature<Args, RetVal> => {
  return (...args: Args) => {
    const returnedValue = definer(getActualContext(), ...args)
    onReturn(returnedValue)
    return returnedValue
  }
}

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
