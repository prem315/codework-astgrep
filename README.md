# codework-astgrep

AST search and rewrite plugin for CodeWork, powered by [ast-grep](https://ast-grep.github.io/).

It registers the `ast_search` tool (plugin ID `astgrep.tool.search`), letting agents search code by syntax tree instead of text. Patterns capture structure (`$NAME`, `$$$ARGS`), and `rewrite` previews a substitution. Nothing is written back to disk.

## Installation

```sh
codework plugin add codework-astgrep          # this project (.codework/settings.jsonc)
codework plugin add codework-astgrep -g       # every project (your user settings)
```

`plugin add` records the entry and installs it. On a fresh checkout that already declares it, run `codework plugin install`.

The language parsers ship as native libraries and unpack in a postinstall script. pnpm does not run those scripts unless the project allows them. Add this to `pnpm-workspace.yaml` before installing:

```yaml
allowBuilds:
  "@ast-grep/lang-angular": true
  "@ast-grep/lang-bash": true
  "@ast-grep/lang-bicep": true
  "@ast-grep/lang-c": true
  "@ast-grep/lang-cpp": true
  "@ast-grep/lang-csharp": true
  "@ast-grep/lang-css": true
  "@ast-grep/lang-dart": true
  "@ast-grep/lang-elixir": true
  "@ast-grep/lang-glimmer-javascript": true
  "@ast-grep/lang-glimmer-typescript": true
  "@ast-grep/lang-go": true
  "@ast-grep/lang-haskell": true
  "@ast-grep/lang-html": true
  "@ast-grep/lang-java": true
  "@ast-grep/lang-javascript": true
  "@ast-grep/lang-json": true
  "@ast-grep/lang-kotlin": true
  "@ast-grep/lang-lua": true
  "@ast-grep/lang-markdown": true
  "@ast-grep/lang-php": true
  "@ast-grep/lang-python": true
  "@ast-grep/lang-ruby": true
  "@ast-grep/lang-rust": true
  "@ast-grep/lang-scala": true
  "@ast-grep/lang-sql": true
  "@ast-grep/lang-swift": true
  "@ast-grep/lang-toml": true
  "@ast-grep/lang-tsx": true
  "@ast-grep/lang-typescript": true
  "@ast-grep/lang-yaml": true
```

## Configuration

Configure it with a second entry that names the plugin, next to the one that loads it:

```jsonc
// .codework/settings.jsonc or ~/.codework/settings.jsonc
{
  "plugins": [
    "codework-astgrep",
    {
      "plugin": "astgrep.tool.search",
      "options": { "limit": 40 }
    }
  ]
}
```

The configuration entry only sets options; it never loads anything. It can also address the plugin by the string that loaded it (`"package": "codework-astgrep"`), or turn it off in one project that inherits it from user settings (`"enabled": false`).

## Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | `50` | Default maximum number of matches a search returns. A per-call `limit` overrides this. |

## Tool: `ast_search`

Searches the session sandbox with an ast-grep pattern.

### Parameters

- `pattern` (string, required): AST pattern. `$NAME` captures one node, `$$$NAME` captures zero or more nodes, `$_` matches any single node.
- `path` (string, optional): File or directory to search. Defaults to the workspace root (`.`).
- `lang` (string, optional): Parser to use. Omit it to detect a language from the file extension.
- `rewrite` (string, optional): Replacement preview. Captured metavariables are substituted. Files are not modified.
- `limit` (number, optional): Maximum matches to return. Defaults to the configured `limit`, or 50.

### Example

Find every `console.log` call and preview a rename:

```json
{
  "pattern": "console.log($MSG)",
  "lang": "typescript",
  "rewrite": "logger.info($MSG)"
}
```

`console.log("hello")` is reported as `logger.info("hello")`. The source file stays unchanged.

A multi-node capture keeps the text between nodes, including commas and spaces:

```json
{
  "pattern": "logger($$$ARGS)",
  "rewrite": "info($$$ARGS)"
}
```

## Languages

`angular`, `bash`, `bicep`, `c`, `cpp`, `csharp`, `css`, `dart`, `elixir`, `glimmer-javascript`, `glimmer-typescript`, `go`, `haskell`, `html`, `java`, `javascript`, `json`, `kotlin`, `lua`, `markdown`, `php`, `python`, `ruby`, `rust`, `scala`, `sql`, `swift`, `toml`, `tsx`, `typescript`, `yaml`.

When `lang` is omitted, the file extension picks the parser. Two extensions are shared:

- `.html` is `html`. Pass `lang: "angular"` to parse those files as Angular templates.
- `.h` is `c`. Pass `lang: "cpp"` to parse those files as C++.

## Project Structure

- `src/index.ts`: Plugin entry point. Registers `ast_search` and reads the `limit` option.
- `src/languages.ts`: Loads every `@ast-grep/lang-*` parser and maps file extensions to languages.
- `src/search.ts`: Walks the sandbox filesystem, runs the pattern, and builds rewrite previews.

## Development

```sh
pnpm install
pnpm run build
pnpm run typecheck
```

`pnpm run watch` rebuilds while you edit.
