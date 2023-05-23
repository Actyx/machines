# Overview

Do not edit the .ts files in this folder
These files are auto-generated from the ESM version in ../esm folder
These files are .gitignored and are not supposed to be committed

# CJS testing workflow:

- All tests are based on the ESM version
- Tests are copied from the ESM folder to the CJS folder
- Imports are rewritten so to follow CJS import style: without the `.js` extension
- See implementation detail in these files: scripts/test
