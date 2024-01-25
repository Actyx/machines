import * as fs from 'fs'

const copy = (fromDir: string, intoDir: string) => {
  const from = fs.readdirSync(fromDir)
  for (const entry of from) {
    const stat = fs.statSync(`${fromDir}/${entry}`)
    if (stat.isFile()) {
      fs.copyFileSync(`${fromDir}/${entry}`, `${intoDir}/${entry}`)
    } else if (stat.isDirectory()) {
      fs.mkdirSync(`${intoDir}/${entry}`, { recursive: true })
      copy(`${fromDir}/${entry}`, `${intoDir}/${entry}`)
    }
  }
}

if (process.argv.length != 3) {
  console.error('Usage: node copy-cjs-esm <cjs|esm>')
  process.exit(1)
}

switch (process.argv[2]) {
  case 'cjs':
    copy('cjs', 'src')
    break
  case 'esm':
    copy('esm', 'src')
    break
  default:
    console.error('Usage: node copy-cjs-esm <cjs|esm>')
    process.exit(1)
}
