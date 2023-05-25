import * as fs from 'fs'
import { globSync } from 'glob'
import { TEST_CJS_GLOB } from './cjs-common.js'

globSync(TEST_CJS_GLOB, {
  ignore: ['**/jest.config.ts'],
}).forEach((file) => fs.unlinkSync(file))
