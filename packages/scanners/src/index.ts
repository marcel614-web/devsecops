// packages/scanners/src/index.ts
export * from "./scanner";
export { GitleaksScanner } from "./scanners/gitleaks.scanner";
export { SemgrepScanner } from "./scanners/semgrep.scanner";
export { NpmAuditScanner } from "./scanners/npm-audit.scanner";
export { ComposerAuditScanner } from "./scanners/composer-audit.scanner";
export { PipAuditScanner } from "./scanners/pip-audit.scanner";
export { TrivyScanner } from "./scanners/trivy.scanner";
export {
  SyftScanner,
  parseSyftReport,
  type SyftReport,
  type SyftSummary,
  type SyftArtifact,
} from "./scanners/syft.scanner";
export {
  ZapScanner,
  parseZapReport,
  type ZapReport,
  type ZapAlert,
  type ZapInstance,
} from "./scanners/zap.scanner";
export {
  scoreToSeverity,
  cvssVectorToScore,
  severityFromOsvVuln,
  fetchOsvSeverities,
  FALLBACK_SEVERITY,
} from "./severity/osv";