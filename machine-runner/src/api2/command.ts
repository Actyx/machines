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
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<any, any, any> },
> = {
  [key in keyof Dictionary]: Dictionary[key]
}

export type CommandSignature<Args extends any[], Retval extends any> = (...args: Args) => Retval

export type CommandSignatureMap<Dictionary extends { [key: string]: CommandSignature<any, any> }> =
  {
    [key in keyof Dictionary]: Dictionary[key]
  }

// TODO: unit test,
export type ToCommandSignatureMap<Dictionary extends CommandDefinerMap<any>> = {
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
  T extends CommandDefinerMap<any>,
  Self extends any,
>(
  t: T,
  getActualContext: () => CommandContext<Self>,
): ToCommandSignatureMap<T> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(definer, getActualContext)]
    }),
  ) as ToCommandSignatureMap<T>
}

export const convertCommandDefinerToCommandSignature = <
  Self extends any,
  Args extends any[],
  Retval extends any,
>(
  definer: CommandDefiner<Self, Args, Retval>,
  getActualContext: () => CommandContext<Self>,
): CommandSignature<Args, Retval> => {
  return (...args: Args) => definer(getActualContext(), ...args)
}

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
