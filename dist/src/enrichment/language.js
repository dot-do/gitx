/**
 * File extension to programming language mapping.
 * Used for code-as-data enrichment to tag blobs with their language.
 */
/** Map of file extension (without dot, lowercase) to language name */
export const LANGUAGES = {
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
};
/**
 * Map of dotfile names (lowercase, without leading dot) to language name.
 * Used for files that start with a dot but have no extension.
 */
export const DOTFILES = {
    // Shell config files
    bashrc: 'Shell',
    bash_profile: 'Shell',
    bash_login: 'Shell',
    bash_logout: 'Shell',
    bash_aliases: 'Shell',
    profile: 'Shell',
    zshrc: 'Shell',
    zshenv: 'Shell',
    zprofile: 'Shell',
    zlogin: 'Shell',
    zlogout: 'Shell',
    zsh_aliases: 'Shell',
    kshrc: 'Shell',
    cshrc: 'Shell',
    tcshrc: 'Shell',
    shrc: 'Shell',
    // Git
    gitignore: 'gitignore',
    gitattributes: 'gitattributes',
    gitmodules: 'gitconfig',
    gitconfig: 'gitconfig',
    // Editor configs
    editorconfig: 'EditorConfig',
    vimrc: 'Vim Script',
    gvimrc: 'Vim Script',
    exrc: 'Vim Script',
    nvimrc: 'Vim Script',
    nanorc: 'nanorc',
    inputrc: 'Readline',
    // Linters and formatters
    eslintrc: 'JSON',
    prettierrc: 'JSON',
    stylelintrc: 'JSON',
    babelrc: 'JSON',
    browserslistrc: 'Browserslist',
    markdownlintrc: 'JSON',
    // Environment and config
    env: 'dotenv',
    envrc: 'Shell',
    npmrc: 'INI',
    yarnrc: 'YAML',
    nvmrc: 'Text',
    node_version: 'Text',
    ruby_version: 'Text',
    python_version: 'Text',
    tool_versions: 'Text',
    // Docker
    dockerignore: 'dockerignore',
    // CI/CD
    travis: 'YAML',
    // Other common dotfiles
    htaccess: 'Apache Config',
    htpasswd: 'Apache Config',
    mailmap: 'mailmap',
    clang_format: 'YAML',
    clang_tidy: 'YAML',
    flake8: 'INI',
    pylintrc: 'INI',
    perlcriticrc: 'INI',
    rubocop: 'YAML',
    rspec: 'Ruby',
    gemrc: 'YAML',
    irbrc: 'Ruby',
    pryrc: 'Ruby',
};
/**
 * Detect the programming language of a file based on its path/extension.
 * Handles regular files, dotfiles (e.g., .bashrc), and dotfiles with extensions (e.g., .eslintrc.json).
 * @param path File path or filename
 * @returns Language name or null if unknown
 */
export function detectLanguage(path) {
    if (!path)
        return null;
    const lastSegment = path.split('/').pop() || path;
    const dotIndex = lastSegment.lastIndexOf('.');
    // Handle dotfiles (files starting with a dot)
    if (lastSegment.startsWith('.')) {
        const withoutLeadingDot = lastSegment.slice(1);
        // Check for dotfile with extension (e.g., .eslintrc.json, .tsconfig.json)
        const extDotIndex = withoutLeadingDot.lastIndexOf('.');
        if (extDotIndex > 0) {
            const ext = withoutLeadingDot.slice(extDotIndex + 1).toLowerCase();
            if (ext && LANGUAGES[ext]) {
                return LANGUAGES[ext];
            }
        }
        // Check for pure dotfile (e.g., .bashrc, .gitignore)
        const dotfileName = withoutLeadingDot.toLowerCase();
        if (DOTFILES[dotfileName]) {
            return DOTFILES[dotfileName];
        }
        return null;
    }
    // Regular file - check extension
    if (dotIndex <= 0)
        return null; // no extension
    const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
    if (!ext)
        return null;
    return LANGUAGES[ext] ?? null;
}
//# sourceMappingURL=language.js.map