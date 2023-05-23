import * as fs from 'fs'
import { globSync } from 'glob'
import { TEST_CJS_DIR, TEST_FILE_EXTENSION } from './cjs-common.js'

globSync(`${TEST_CJS_DIR}/**/*${TEST_FILE_EXTENSION}`).forEach((file) => fs.unlinkSync(file))
