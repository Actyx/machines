# machine-check

This is a library for checking the behavioural types obtained by using the `machine-runner`.

## Building and publishing

You’ll need to `cargo install wasm-pack` after which you can

- `wasm-pack build --target nodejs` to build the wasm

This is used for building the whole TypeScript library:

- `npm run build` will build both Rust and TypeScript parts
- `npm publish` will publish to the registry as usual
