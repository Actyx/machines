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

export type CommandSignature<Args extends unknown[]> = (...args: Args) => Promise<void>

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
  getActualContext: ActualContextGetter<Context>
  onReturn: (retval: RetVal) => Promise<void>
  /**
   * isExpired is intended to flag if a snapshot that owns the reference to a
   * command is not up to date with the state container's state.
   */
  isExpired: () => boolean
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
      return [key, convertCommandDefinerToCommandSignature(definer, params)]
    }),
  ) as ToCommandSignatureMap<T, unknown[], RetVal>
}

export const convertCommandDefinerToCommandSignature = <Context, Args extends unknown[], RetVal>(
  definer: CommandDefiner<Context, Args, RetVal>,
  { getActualContext, onReturn, isExpired }: ConvertCommandMapParams<Context, RetVal>,
): CommandSignature<Args> => {
  return (...args: Args) => {
    if (isExpired()) {
      // TODO: Do we want to provide user an option to handle expired command?
      console.error('Command has expired')
    }
    const returnedValue = definer(getActualContext(), ...args)
    return onReturn(returnedValue)
  }
}
