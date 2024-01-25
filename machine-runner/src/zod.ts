/* eslint-disable @typescript-eslint/no-var-requires */

export const importZod = () => ({
  zod: require('zod') as typeof import('zod'),
  zodError: require('zod-validation-error') as typeof import('zod-validation-error'),
})
