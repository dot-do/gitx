/**
 * File extension to programming language mapping.
 * Used for code-as-data enrichment to tag blobs with their language.
 */

/** Map of file extension (without dot, lowercase) to language name */
export const LANGUAGES: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',

  // Python
  py: 'Python',
  pyi: 'Python',
  pyw: 'Python',
  pyx: 'Python',

  // Rust
  rs: 'Rust',

  // Go
  go: 'Go',

  // Java / JVM
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  groovy: 'Groovy',
  clj: 'Clojure',
  cljs: 'ClojureScript',
  cljc: 'Clojure',

  // C / C++
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cxx: 'C++',
  cc: 'C++',
  hpp: 'C++',
  hxx: 'C++',

  // C#
  cs: 'C#',

  // Ruby
  rb: 'Ruby',
  erb: 'ERB',

  // PHP
  php: 'PHP',

  // Swift / Objective-C
  swift: 'Swift',
  m: 'Objective-C',
  mm: 'Objective-C++',

  // Shell
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  fish: 'Fish',
  ps1: 'PowerShell',
  psm1: 'PowerShell',

  // Markup / Web
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  styl: 'Stylus',
  vue: 'Vue',
  svelte: 'Svelte',

  // Data / Config
  json: 'JSON',
  jsonc: 'JSON',
  json5: 'JSON5',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  xsl: 'XML',
  csv: 'CSV',
  tsv: 'TSV',
  ini: 'INI',
  env: 'dotenv',

  // Documentation
  md: 'Markdown',
  mdx: 'MDX',
  rst: 'reStructuredText',
  tex: 'LaTeX',
  adoc: 'AsciiDoc',

  // SQL / Database
  sql: 'SQL',
  prisma: 'Prisma',

  // Functional
  hs: 'Haskell',
  lhs: 'Haskell',
  ml: 'OCaml',
  mli: 'OCaml',
  fs: 'F#',
  fsx: 'F#',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  hrl: 'Erlang',
  elm: 'Elm',

  // Systems / Low-level
  zig: 'Zig',
  nim: 'Nim',
  v: 'V',
  d: 'D',
  asm: 'Assembly',
  s: 'Assembly',
  wasm: 'WebAssembly',
  wat: 'WebAssembly',

  // Scripting
  lua: 'Lua',
  r: 'R',
  jl: 'Julia',
  pl: 'Perl',
  pm: 'Perl',
  dart: 'Dart',
  tcl: 'Tcl',

  // DevOps / IaC
  tf: 'Terraform',
  hcl: 'HCL',
  nix: 'Nix',

  // Schema / API
  proto: 'Protocol Buffers',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  thrift: 'Thrift',
  avsc: 'Avro',

  // Other
  sol: 'Solidity',
  wgsl: 'WGSL',
  glsl: 'GLSL',
  hlsl: 'HLSL',
  cmake: 'CMake',
}

/**
 * Detect the programming language of a file based on its path/extension.
 * @param path File path or filename
 * @returns Language name or null if unknown
 */
export function detectLanguage(path: string): string | null {
  if (!path) return null
  const lastSegment = path.split('/').pop() || path
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0) return null // no extension or dot-file like ".hidden"
  const ext = lastSegment.slice(dotIndex + 1).toLowerCase()
  if (!ext) return null
  return LANGUAGES[ext] ?? null
}
