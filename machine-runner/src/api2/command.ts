export type CommandContext = {
  someSystemCall: () => unknown
}

export type CommandDefiner<Args extends any[], Retval extends any> = (
  context: CommandContext,
  ...args: Args
) => Retval

export type CommandDefinerMap<
  Dictionary extends { [key in keyof Dictionary]: CommandDefiner<any, any> },
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
  [key in keyof Dictionary]: Dictionary[key] extends CommandDefiner<infer Args, infer Retval>
    ? CommandSignature<Args, Retval>
    : never
}

export const convertCommandMapToCommandSignatureMap = <T extends CommandDefinerMap<any>>(
  t: T,
  context: CommandContext,
): ToCommandSignatureMap<T> => {
  return Object.fromEntries(
    Object.entries(t).map(([key, definer]) => {
      return [key, convertCommandDefinerToCommandSignature(definer, context)]
    }),
  ) as ToCommandSignatureMap<T>
}

export const convertCommandDefinerToCommandSignature = <Args extends any[], Retval extends any>(
  definer: CommandDefiner<Args, Retval>,
  context: CommandContext,
): CommandSignature<Args, Retval> => {
  return (...args: Args) => definer(context, ...args)
}

export type CommandMapPrototype<Dictionary extends { [key: string]: any }> = {
  [key in keyof Dictionary]: Dictionary[key]
}
