import type { ValidationIssue } from "@pattern-js/admin-sdk";

/**
 * Validation issues come in two severities. **Errors** block (save/deploy/fork
 * refuse); **warnings** are advisory (e.g. a privileged op reachable with no
 * `requireAuth`) — they surface but never stop the action. `severity` is
 * undefined for legacy errors, so absence means "error".
 */
export const isWarning = (i: ValidationIssue): boolean => i.severity === "warning";
export const hasErrors = (issues: ValidationIssue[]): boolean => issues.some((i) => !isWarning(i));
export const errorCount = (issues: ValidationIssue[]): number => issues.filter((i) => !isWarning(i)).length;
export const warningCount = (issues: ValidationIssue[]): number => issues.filter(isWarning).length;

/** A short "2 errors, 1 warning" summary (omits the zero side). */
export function issueSummary(issues: ValidationIssue[]): string {
  const e = errorCount(issues);
  const w = warningCount(issues);
  return [e && `${e} error${e > 1 ? "s" : ""}`, w && `${w} warning${w > 1 ? "s" : ""}`].filter(Boolean).join(", ");
}
