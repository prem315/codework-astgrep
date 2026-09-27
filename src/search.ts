import { parse, type SgNode } from "@ast-grep/napi";
import type { SandboxFileSystem } from "@codeworksh/plugin/sandbox";
import { Effect } from "effect";
import {
  detectLanguage,
  ensureLanguagesRegistered,
  fileSupportsLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
} from "./languages.js";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".pnpm-store",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
]);

const MAX_FILE_BYTES = 1_000_000;
const MAX_SNIPPET_CHARS = 4_000;

const META_VARIABLE = /\$\$\$([A-Z_][A-Z0-9_]*)|\$([A-Z_][A-Z0-9_]*)/g;

export interface AstMatch {
  readonly file: string;
  readonly lang: SupportedLanguage;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly matchedText: string;
  readonly rewrittenText?: string;
  readonly metaVariables: Readonly<Record<string, string>>;
}

export interface SearchOptions {
  readonly pattern: string;
  readonly path?: string;
  readonly lang?: SupportedLanguage;
  readonly rewrite?: string;
  readonly limit: number;
}

export interface SearchResult {
  readonly matches: ReadonlyArray<AstMatch>;
  readonly truncated: boolean;
}

const clip = (text: string): string =>
  text.length <= MAX_SNIPPET_CHARS ? text : `${text.slice(0, MAX_SNIPPET_CHARS)}…`;

const sliceSource = (source: string, start: number, end: number): string =>
  Buffer.from(source, "utf8").subarray(start, end).toString("utf8");

const captureMetaVariables = (node: SgNode, pattern: string, source: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const match of pattern.matchAll(META_VARIABLE)) {
    const multiName = match[1];
    const singleName = match[2];
    if (multiName) {
      const key = `$$$${multiName}`;
      if (key in vars) continue;
      const nodes = [...node.getMultipleMatches(multiName)].sort(
        (left, right) => left.range().start.index - right.range().start.index,
      );
      if (nodes.length === 0) {
        vars[key] = "";
        continue;
      }
      const start = nodes[0]?.range().start.index ?? 0;
      const end = nodes[nodes.length - 1]?.range().end.index ?? start;
      vars[key] = sliceSource(source, start, end);
    } else if (singleName) {
      const key = `$${singleName}`;
      if (key in vars) continue;
      const captured = node.getMatch(singleName);
      if (captured) vars[key] = captured.text();
    }
  }
  return vars;
};

const applyRewrite = (template: string, vars: Readonly<Record<string, string>>): string => {
  const keys = Object.keys(vars).sort((left, right) => right.length - left.length);
  let result = template;
  for (const key of keys) {
    result = result.replaceAll(key, vars[key] ?? "");
  }
  return result;
};

const toMatch = (
  file: string,
  lang: SupportedLanguage,
  source: string,
  pattern: string,
  rewrite: string | undefined,
  node: SgNode,
): AstMatch => {
  const range = node.range();
  const metaVariables = captureMetaVariables(node, pattern, source);
  const rewrittenText = rewrite === undefined ? undefined : applyRewrite(rewrite, metaVariables);
  return {
    file,
    lang,
    lineStart: range.start.line + 1,
    lineEnd: range.end.line + 1,
    columnStart: range.start.column + 1,
    columnEnd: range.end.column + 1,
    matchedText: clip(node.text()),
    ...(rewrittenText === undefined ? {} : { rewrittenText: clip(rewrittenText) }),
    metaVariables,
  };
};

const joinPath = (directory: string, name: string): string =>
  directory === "." || directory === "" ? name : `${directory.replace(/\/$/, "")}/${name}`;

type FileSystem = SandboxFileSystem.Interface;

const collectFiles = (fs: FileSystem, directory: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const entries = yield* Effect.catch(fs.readdir(directory), () => Effect.succeed([] as string[]));
    const files: string[] = [];
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      const fullPath = joinPath(directory, entry);
      const stat = yield* Effect.catch(fs.stat(fullPath), () => Effect.succeed(undefined));
      if (!stat || stat.isSymbolicLink) continue;
      if (stat.isDirectory) {
        const nested = yield* collectFiles(fs, fullPath);
        files.push(...nested);
      } else if (stat.isFile) {
        if (stat.size !== undefined && stat.size > MAX_FILE_BYTES) continue;
        files.push(fullPath);
      }
    }
    return files;
  });

const languageForFile = (
  filePath: string,
  requested: SupportedLanguage | undefined,
  explicitFile: boolean,
): SupportedLanguage | undefined => {
  if (requested && explicitFile) return requested;
  if (requested) return fileSupportsLanguage(filePath, requested) ? requested : undefined;
  return detectLanguage(filePath);
};

export const runAstSearch = (fs: FileSystem, options: SearchOptions): Effect.Effect<SearchResult, Error> =>
  Effect.gen(function* () {
    try {
      ensureLanguagesRegistered();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return yield* Effect.fail(new Error(message));
    }
    if (options.pattern.trim() === "") {
      return yield* Effect.fail(new Error("Pattern is empty."));
    }
    if (options.lang !== undefined && !isSupportedLanguage(options.lang)) {
      return yield* Effect.fail(new Error(`Unsupported language "${options.lang}".`));
    }

    const root = options.path && options.path.length > 0 ? options.path : ".";
    const stat = yield* Effect.catch(fs.stat(root), () => Effect.succeed(undefined));
    if (!stat) {
      return yield* Effect.fail(new Error(`Path not found: ${root}`));
    }

    const explicitFile = stat.isFile;
    const candidates = explicitFile ? [root] : yield* collectFiles(fs, root);
    const files = candidates.flatMap((filePath) => {
      const lang = languageForFile(filePath, options.lang, explicitFile);
      return lang ? [{ filePath, lang }] : [];
    });

    if (explicitFile && files.length === 0) {
      return yield* Effect.fail(
        new Error(`Could not detect a language for ${root}. Pass lang explicitly.`),
      );
    }

    const matches: AstMatch[] = [];
    let truncated = false;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const current = files[fileIndex];
      if (!current) continue;
      const content = yield* Effect.catch(fs.readFile(current.filePath), () => Effect.succeed(undefined));
      if (!content || content.includes("\0")) continue;

      let nodes: SgNode[];
      try {
        nodes = parse(current.lang, content).root().findAll(options.pattern);
      } catch (error) {
        if (options.lang) {
          const message = error instanceof Error ? error.message : String(error);
          return yield* Effect.fail(new Error(message));
        }
        continue;
      }

      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        const node = nodes[nodeIndex];
        if (!node) continue;
        matches.push(toMatch(current.filePath, current.lang, content, options.pattern, options.rewrite, node));
        if (matches.length >= options.limit) {
          truncated = nodeIndex < nodes.length - 1 || fileIndex < files.length - 1;
          break;
        }
      }
      if (truncated) break;
    }

    return { matches, truncated };
  });
