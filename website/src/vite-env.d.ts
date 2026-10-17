/// <reference types="vite/client" />

declare module 'virtual:funky-parser' {
  export function parse(source: string): unknown
}

declare module 'virtual:typescript-libs' {
  const libraries: Record<string, string>
  export default libraries
}
