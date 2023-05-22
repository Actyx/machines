import * as fs from 'fs'

const packageJSON = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
const packageJSONCJSPatch = JSON.parse(fs.readFileSync('./cjs/package.patch.json', 'utf8'))

const cjsPackageJSON = { ...packageJSON, ...packageJSONCJSPatch }

fs.writeFileSync('./cjs/package.json', JSON.stringify(cjsPackageJSON, null, 2), 'utf8')
