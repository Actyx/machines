/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */

const ZOD = {
  zod: (await import('zod').catch(
    (e: any) => new Error(`cannot import zod, please install: ${e}`),
  )) as typeof import('zod') | Error,
  zodError: (await import('zod-validation-error').catch(
    (e: any) => new Error(`cannot import zod, please install: ${e}`),
  )) as typeof import('zod-validation-error') | Error,
}

export const importZod = () => {
  const { zod, zodError } = ZOD
  if (zod instanceof Error) throw zod
  if (zodError instanceof Error) throw zodError
  return { zod, zodError }
}
