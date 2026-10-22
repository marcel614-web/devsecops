// packages/shared/src/index.ts
/**
 * @devsecops/shared — contrats et utilitaires partagés entre l'API, le
 * worker, le front et le package `scanners`.
 */
export {
  MIN_SECRET_LENGTH,
  isPlaceholderSecret,
  secretField,
} from "./secrets";

export {
  GIT_SHA_PATTERN,
  MANUAL_SHA_PATTERN,
  isValidGitSha,
  assertValidGitSha,
} from "./git";

export { shellQuote, quoteWindowsArg, yamlQuote } from "./shell";

export {
  execTool,
  spawnTool,
  quoteForCmd,
  type ToolExecOptions,
  type ToolExecResult,
} from "./exec";
