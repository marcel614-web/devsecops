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
  FULL_GIT_SHA_PATTERN,
  MANUAL_SHA_PATTERN,
  isValidGitSha,
  isFullGitSha,
  assertValidGitSha,
} from "./git";

export { DEVSECOPS_CHECK_NAME } from "./github";

export {
  assertHostKeyTrusted,
  computeHostKeyFingerprint,
  hostKeyMatches,
  isValidHostKeyFingerprint,
  normalizeHostKeyFingerprint,
} from "./ssh-host-key";

export { shellQuote, quoteWindowsArg, yamlQuote } from "./shell";

export {
  execTool,
  spawnTool,
  quoteForCmd,
  type ToolExecOptions,
  type ToolExecResult,
} from "./exec";

export {
  isTransientNetworkError,
  describeExecError,
  type ExecLikeError,
} from "./network-errors";

export {
  RESCAN_QUEUE_NAME,
  RESCAN_SCHEDULER_ID,
  RESCAN_TICK_JOB,
  RESCAN_RUN_JOB,
  isRescanRunJobData,
  type RescanJobData,
  type RescanRunJobData,
  type RescanTickJobData,
} from "./queues";

export {
  GATE_CATEGORIES,
  DEFAULT_MANDATORY_CONTROLS,
  buildSecurityPolicy,
  effectiveGateMode,
  hashSecurityPolicy,
  isGateCategory,
  normalizeMandatoryControls,
  stableJson,
  type GateCategory,
  type GateCategoryPolicy,
  type GateMode,
  type GateThresholds,
  type SecurityPolicySource,
  type SecurityPolicyV1,
} from "./security-policy";
