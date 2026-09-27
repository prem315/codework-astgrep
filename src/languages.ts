import langAngular from "@ast-grep/lang-angular";
import langBash from "@ast-grep/lang-bash";
import langBicep from "@ast-grep/lang-bicep";
import langC from "@ast-grep/lang-c";
import langCpp from "@ast-grep/lang-cpp";
import langCsharp from "@ast-grep/lang-csharp";
import langCss from "@ast-grep/lang-css";
import langDart from "@ast-grep/lang-dart";
import langElixir from "@ast-grep/lang-elixir";
import langGlimmerJavaScript from "@ast-grep/lang-glimmer-javascript";
import langGlimmerTypeScript from "@ast-grep/lang-glimmer-typescript";
import langGo from "@ast-grep/lang-go";
import langHaskell from "@ast-grep/lang-haskell";
import langHtml from "@ast-grep/lang-html";
import langJava from "@ast-grep/lang-java";
import langJavaScript from "@ast-grep/lang-javascript";
import langJson from "@ast-grep/lang-json";
import langKotlin from "@ast-grep/lang-kotlin";
import langLua from "@ast-grep/lang-lua";
import langMarkdown from "@ast-grep/lang-markdown";
import langPhp from "@ast-grep/lang-php";
import langPython from "@ast-grep/lang-python";
import langRuby from "@ast-grep/lang-ruby";
import langRust from "@ast-grep/lang-rust";
import langScala from "@ast-grep/lang-scala";
import langSql from "@ast-grep/lang-sql";
import langSwift from "@ast-grep/lang-swift";
import langToml from "@ast-grep/lang-toml";
import langTsx from "@ast-grep/lang-tsx";
import langTypeScript from "@ast-grep/lang-typescript";
import langYaml from "@ast-grep/lang-yaml";
import { registerDynamicLanguage, type DynamicLangRegistrations } from "@ast-grep/napi";

interface LanguageModule {
  readonly libraryPath: string;
  readonly extensions: readonly string[];
  readonly languageSymbol?: string;
  readonly metaVarChar?: string;
  readonly expandoChar?: string;
}

const LANGUAGE_MODULES = {
  angular: langAngular,
  bash: langBash,
  bicep: langBicep,
  c: langC,
  cpp: langCpp,
  csharp: langCsharp,
  css: langCss,
  dart: langDart,
  elixir: langElixir,
  "glimmer-javascript": langGlimmerJavaScript,
  "glimmer-typescript": langGlimmerTypeScript,
  go: langGo,
  haskell: langHaskell,
  html: langHtml,
  java: langJava,
  javascript: langJavaScript,
  json: langJson,
  kotlin: langKotlin,
  lua: langLua,
  markdown: langMarkdown,
  php: langPhp,
  python: langPython,
  ruby: langRuby,
  rust: langRust,
  scala: langScala,
  sql: langSql,
  swift: langSwift,
  toml: langToml,
  tsx: langTsx,
  typescript: langTypeScript,
  yaml: langYaml,
} as const satisfies Record<string, LanguageModule>;

export const SUPPORTED_LANGUAGES = [
  "angular",
  "bash",
  "bicep",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "elixir",
  "glimmer-javascript",
  "glimmer-typescript",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "yaml",
] as const satisfies ReadonlyArray<keyof typeof LANGUAGE_MODULES>;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Extensions the grammar accepts beyond the package list.
 * `.h` stays C unless the caller asks for C++.
 */
const EXTRA_EXTENSIONS: Partial<Record<SupportedLanguage, readonly string[]>> = {
  cpp: ["h", "hxx", "inl", "ipp"],
};

/** When several languages claim one extension, auto-detect uses this owner. */
const PREFERRED_LANGUAGE: Partial<Record<string, SupportedLanguage>> = {
  h: "c",
  html: "html",
};

const extensionOwners = new Map<string, SupportedLanguage[]>();

const addExtension = (extension: string, language: SupportedLanguage): void => {
  const owners = extensionOwners.get(extension);
  if (owners) {
    if (!owners.includes(language)) owners.push(language);
    return;
  }
  extensionOwners.set(extension, [language]);
};

for (const language of SUPPORTED_LANGUAGES) {
  for (const extension of LANGUAGE_MODULES[language].extensions) {
    addExtension(extension, language);
  }
  for (const extension of EXTRA_EXTENSIONS[language] ?? []) {
    addExtension(extension, language);
  }
}

let registered = false;

/** Register every dynamic language once per process. Later calls are ignored by ast-grep. */
export const ensureLanguagesRegistered = (): void => {
  if (registered) return;
  const registrations: DynamicLangRegistrations = {};
  for (const language of SUPPORTED_LANGUAGES) {
    const mod = LANGUAGE_MODULES[language];
    registrations[language] = {
      libraryPath: mod.libraryPath,
      extensions: [...mod.extensions],
      ...(mod.languageSymbol ? { languageSymbol: mod.languageSymbol } : {}),
      ...(mod.metaVarChar ? { metaVarChar: mod.metaVarChar } : {}),
      ...(mod.expandoChar ? { expandoChar: mod.expandoChar } : {}),
    };
  }
  registerDynamicLanguage(registrations);
  registered = true;
};

export const isSupportedLanguage = (language: string): language is SupportedLanguage =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(language);

/** Extension of `name.ext`. A leading-dot name such as `.env` has no extension. */
export const fileExtension = (filePath: string): string | undefined => {
  const base = filePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return base.slice(dot + 1).toLowerCase();
};

export const languagesForExtension = (extension: string): readonly SupportedLanguage[] =>
  extensionOwners.get(extension) ?? [];

export const detectLanguage = (filePath: string): SupportedLanguage | undefined => {
  const extension = fileExtension(filePath);
  if (!extension) return undefined;
  const owners = languagesForExtension(extension);
  if (owners.length === 0) return undefined;
  const preferred = PREFERRED_LANGUAGE[extension];
  if (preferred && owners.includes(preferred)) return preferred;
  return owners[0];
};

export const fileSupportsLanguage = (filePath: string, language: SupportedLanguage): boolean => {
  const extension = fileExtension(filePath);
  if (!extension) return false;
  return languagesForExtension(extension).includes(language);
};
