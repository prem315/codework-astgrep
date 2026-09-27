import { Plugin, Tool } from "@codeworksh/plugin";
import { SandboxIO } from "@codeworksh/plugin/sandbox";
import { Effect, Schema } from "effect";
import { SUPPORTED_LANGUAGES } from "./languages.js";
import { runAstSearch } from "./search.js";

const DEFAULT_MATCH_LIMIT = 50;

const AstMatchSchema = Schema.Struct({
  file: Schema.String,
  lang: Schema.Literals(SUPPORTED_LANGUAGES),
  lineStart: Schema.Int,
  lineEnd: Schema.Int,
  columnStart: Schema.Int,
  columnEnd: Schema.Int,
  matchedText: Schema.String,
  rewrittenText: Schema.optional(Schema.String),
  metaVariables: Schema.Record(Schema.String, Schema.String),
});

const AstSearchParams = Schema.Struct({
  pattern: Schema.String.annotate({
    description:
      "AST pattern. `$NAME` captures one node, `$$$NAME` captures zero or more nodes, `$_` matches any single node.",
  }),
  path: Schema.optional(
    Schema.String.annotate({
      description: "File or directory to search. Defaults to the workspace root ('.').",
    }),
  ),
  lang: Schema.optional(
    Schema.Literals(SUPPORTED_LANGUAGES).annotate({
      description:
        "Parser to use. Omit it to detect a language from the file extension. `.html` is html unless this is angular. `.h` is c unless this is cpp.",
    }),
  ),
  rewrite: Schema.optional(
    Schema.String.annotate({
      description:
        "Replacement preview. Captured metavariables such as `$NAME` and `$$$ARGS` are substituted. Nothing is written to disk.",
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0)).annotate({
      description: "Maximum matches to return. Defaults to 50.",
    }),
  ),
});

const AstSearchSuccess = Schema.Struct({
  matches: Schema.Array(AstMatchSchema),
  truncated: Schema.Boolean,
});

class AstSearchFailed extends Schema.TaggedError<AstSearchFailed>()("AstSearchFailed", {
  message: Schema.String,
}) {}

const formatMatch = (match: {
  readonly file: string;
  readonly lang: string;
  readonly lineStart: number;
  readonly columnStart: number;
  readonly matchedText: string;
  readonly rewrittenText?: string;
}): string => {
  let text = `### ${match.file}:${match.lineStart}:${match.columnStart} (${match.lang})\n\`\`\`\n${match.matchedText}\n\`\`\``;
  if (match.rewrittenText !== undefined) {
    text += `\n**Rewrite preview:**\n\`\`\`\n${match.rewrittenText}\n\`\`\``;
  }
  return text;
};

export default Plugin.define({
  id: "codework.tool.astgrep",
  kind: "tool",
  setup: Effect.fn("AstGrepPlugin.setup")(function* (ctx, options) {
    const fs = yield* SandboxIO.FileSystem;
    const configuredLimit = options["limit"];
    const defaultLimit =
      typeof configuredLimit === "number" && configuredLimit > 0 ? configuredLimit : DEFAULT_MATCH_LIMIT;

    ctx.plugin.tools.add(
      Tool.register(
        Tool.make({
          name: "ast_search",
          label: "AST Code Search",
          promptSnippet: "Search code by syntax tree with ast-grep patterns ($VAR, $$$ARGS).",
          description:
            "Search code structurally with ast-grep across Angular, Bash, Bicep, C, C++, C#, CSS, Dart, Elixir, Glimmer JavaScript, Glimmer TypeScript, Go, Haskell, HTML, Java, JavaScript, JSON, Kotlin, Lua, Markdown, PHP, Python, Ruby, Rust, Scala, SQL, Swift, TOML, TSX, TypeScript, and YAML. " +
            "`$NAME` captures one AST node and `$$$NAME` captures zero or more. Pass `rewrite` to preview a substitution. Matches are not written back to the files.",
          parameters: AstSearchParams,
          success: AstSearchSuccess,
          failure: AstSearchFailed,
          encodeContent: (success) => {
            if (success.matches.length === 0) {
              return [{ type: "text", text: "No AST matches found." }];
            }
            const body = success.matches.map((match) => formatMatch(match)).join("\n\n");
            const note = success.truncated ? "\n\nResults stopped at the match limit." : "";
            return [{ type: "text", text: `Found ${success.matches.length} match(es):\n\n${body}${note}` }];
          },
          encodeFailureContent: (failure) => [{ type: "text", text: failure.message }],
          handler: (params) =>
            runAstSearch(fs, {
              pattern: params.pattern,
              path: params.path,
              lang: params.lang,
              rewrite: params.rewrite,
              limit: params.limit ?? defaultLimit,
            }).pipe(
              Effect.mapError(
                (error) => new AstSearchFailed({ message: error instanceof Error ? error.message : String(error) }),
              ),
            ),
        }),
      ),
    );
  }),
});
