import * as fs from 'fs'
import * as path from 'path'
import { globSync } from 'glob'
import { TEST_CJS_DIR, TEST_ESM_DIR, TEST_ESM_GLOB } from './cjs-common.js'

const createNotice = ({ sourcePath }: { sourcePath: string }) =>
  `
// Do not edit! This file is autogenerated from
// ${sourcePath} 
`.trim() + '\n\n'

globSync(TEST_ESM_GLOB, {
  ignore: ['**/jest.config.ts'],
}).forEach((sourcePath) => {
  const destinationPath = path.resolve(TEST_CJS_DIR, path.relative(TEST_ESM_DIR, sourcePath))

  let content = fs.readFileSync(sourcePath, 'utf8')
  content = content.replace(/from '(.*).js'/gi, (_, p1) => `from '${p1}'`)
  content = `${createNotice({ sourcePath })}${content}`

  fs.writeFileSync(destinationPath, content, 'utf8')
})
