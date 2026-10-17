# Funky Playground (Draft 0.2)

This is a browser playground for the Draft 0.2 TypeScript prototype in `../mock/`.

```sh
npm ci
npm run dev
npm run build
npm run preview
```

The page bundles the Peggy grammar and the TypeScript compiler's ES2022 declaration libraries at build time. Parsing, Funky inference/effect checks, generated-TypeScript strict checking, and TypeScript-to-JavaScript transpilation all run locally in the browser; no compiler service or CDN is needed. Generated programs run in a short-lived Web Worker with a time limit. `std/io` uses the editable JSON virtual-file panel rather than the host filesystem.

The built-in `std/io`, `std/text`, `std/list`, and `std/json` modules are available. Linking another Funky source file with `using` remains the prototype's one unsupported feature.
