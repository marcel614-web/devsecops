// apps/web/src/components/security/PipelineTimeline.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PipelineStage } from "./PipelineStage";
import type { PipelineStep } from "@/types/api";

interface Props {
  steps: PipelineStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  blockedReason?: string | null;
}

export function PipelineTimeline({
  steps,
  selectedStepId,
  onSelectStep,
  blockedReason,
}: Props) {
  const successCount = steps.filter((s) => s.status === "SUCCESS").length;
  const failedCount = steps.filter((s) => s.status === "FAILED").length;
  const blockedCount = steps.filter((s) => s.status === "SECURITY_BLOCKED").length;
  const cancelledCount = steps.filter((s) => s.status === "CANCELLED").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Étapes du pipeline ({steps.length})</CardTitle>
          <div className="flex gap-3 text-xs text-muted">
            {successCount > 0 && (
              <span className="text-emerald-500">✓ {successCount}</span>
            )}
            {failedCount > 0 && (
              <span className="text-red-500">✗ {failedCount}</span>
            )}
            {blockedCount > 0 && (
              <span className="text-amber-500">🛡 {blockedCount}</span>
            )}
            {cancelledCount > 0 && (
              <span className="text-slate-500">⊘ {cancelledCount}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        <div className="space-y-0.5">
          {steps.map((s) => (
            <PipelineStage
              key={s.id}
              step={s}
              selected={selectedStepId === s.id}
              onSelect={() => onSelectStep(s.id)}
            />
          ))}
        </div>

        {blockedReason && (
          <div className="mt-3 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400">
            <strong className="block mb-0.5">Pipeline bloqué</strong>
            {blockedReason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}