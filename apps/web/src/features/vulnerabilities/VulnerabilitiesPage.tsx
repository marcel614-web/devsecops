import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Filter,
  Save,
  ShieldAlert,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SeverityBadge } from "@/components/ui/Badge";
import { SeveritySummaryCards } from "@/components/security/SeveritySummaryCards";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { projectService } from "@/services/project.service";
import { vulnerabilityService } from "@/services/vulnerability.service";
import { userService } from "@/services/user.service";
import { getErrorMessage } from "@/services/api";
import { timeAgo, cn } from "@/lib/utils";
import type {
  ScanType,
  Severity,
  Vulnerability,
  VulnerabilityStatus,
} from "@/types/api";

const TOOLS = [
  { value: "", label: "Tous les outils" },
  { value: "gitleaks", label: "Gitleaks" },
  { value: "semgrep", label: "Semgrep" },
  { value: "npm-audit", label: "npm audit" },
  { value: "composer-audit", label: "composer audit" },
  { value: "pip-audit", label: "pip-audit" },
  { value: "trivy", label: "Trivy image" },
  { value: "trivy-config", label: "Trivy config (IaC)" },
  { value: "zap", label: "OWASP ZAP" },
];

const SCAN_TYPES: Array<{ value: ScanType | ""; label: string }> = [
  { value: "", label: "Tous les types" },
  { value: "SECRET", label: "Secrets" },
  { value: "SAST", label: "SAST" },
  { value: "SCA", label: "Dépendances (SCA)" },
  { value: "IAC", label: "IaC" },
  { value: "IMAGE", label: "Image Docker" },
  { value: "DAST", label: "DAST" },
];

const STATUSES: Array<{ value: VulnerabilityStatus | ""; label: string }> = [
  { value: "", label: "Tous les statuts" },
  { value: "OPEN", label: "Ouverte" },
  { value: "CONFIRMED", label: "Confirmée" },
  { value: "FIXED", label: "Corrigée" },
  { value: "FALSE_POSITIVE", label: "Faux positif" },
  { value: "RISK_ACCEPTED", label: "Risque accepté" },
  { value: "DUPLICATE", label: "Doublon" },
];

const STATUS_LABELS: Record<VulnerabilityStatus, string> = {
  OPEN: "Ouverte",
  CONFIRMED: "Confirmée",
  FIXED: "Corrigée",
  FALSE_POSITIVE: "Faux positif",
  RISK_ACCEPTED: "Risque accepté",
  DUPLICATE: "Doublon",
};

const STATUS_STYLE: Record<VulnerabilityStatus, string> = {
  OPEN: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  CONFIRMED:
    "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  FIXED:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  FALSE_POSITIVE:
    "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  RISK_ACCEPTED:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  DUPLICATE:
    "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

export function VulnerabilitiesPage() {
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);

  const projectId = params.get("projectId") ?? "";
  const severity = (params.get("severity") ?? "") as Severity | "";
  const status = (params.get("status") ?? "") as VulnerabilityStatus | "";
  const scanType = (params.get("scanType") ?? "") as ScanType | "";
  const tool = params.get("tool") ?? "";
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? 1);

  const { data: projects } = useQuery({
    queryKey: ["projects-list"],
    queryFn: () => projectService.list({ pageSize: 100 }),
  });

  const effectiveProjectId = projectId || projects?.items[0]?.id || "";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "vulnerabilities",
      effectiveProjectId,
      { severity, status, scanType, tool, search, page },
    ],
    queryFn: () =>
      vulnerabilityService.listByProject(effectiveProjectId, {
        page,
        pageSize: 25,
        severity: severity || undefined,
        status: status || undefined,
        scanType: scanType || undefined,
        tool: tool || undefined,
        search: search || undefined,
      }),
    enabled: !!effectiveProjectId,
  });

  const { data: users } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => userService.list({ pageSize: 100 }),
    staleTime: 60_000,
  });

  const updateParams = (
    updates: Record<string, string | number | undefined>,
  ) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnérabilités"
        description="Findings dédupliqués, cycle de vie et historique des occurrences"
      />

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Filter className="h-4 w-4" />
            Filtres
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Select
              value={effectiveProjectId}
              onChange={(e) =>
                updateParams({ projectId: e.target.value, page: 1 })
              }
            >
              {projects?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>

            <Select
              value={status}
              onChange={(e) =>
                updateParams({ status: e.target.value, page: 1 })
              }
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>

            <Select
              value={scanType}
              onChange={(e) =>
                updateParams({ scanType: e.target.value, page: 1 })
              }
            >
              {SCAN_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>

            <Select
              value={tool}
              onChange={(e) => updateParams({ tool: e.target.value, page: 1 })}
            >
              {TOOLS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>

            <div className="md:col-span-2">
              <Input
                value={search}
                onChange={(e) => {
                  updateParams({ search: e.target.value, page: 1 });
                }}
                placeholder="Rechercher un package, fichier, CVE ou empreinte…"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Findings uniques"
              value={data.uniqueCount}
              hint="après déduplication"
            />
            <Stat
              label="Occurrences"
              value={data.occurrenceCount}
              hint="toutes exécutions"
            />
            <Stat
              label="Ouverts"
              value={
                data.uniqueCount -
                (data.statusCounts.FIXED ?? 0) -
                (data.statusCounts.FALSE_POSITIVE ?? 0) -
                (data.statusCounts.DUPLICATE ?? 0)
              }
              hint="à traiter"
            />
            <Stat
              label="Corrigés"
              value={data.statusCounts.FIXED ?? 0}
              hint="cycle de vie"
            />
          </div>
          <SeveritySummaryCards
            counts={data.severityCounts}
            active={severity || null}
            onSelect={(s) => updateParams({ severity: s ?? "", page: 1 })}
          />
        </div>
      )}

      {isLoading && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </CardContent>
        </Card>
      )}

      {isError && (
        <ErrorState
          title="Impossible de charger les vulnérabilités"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={ShieldAlert}
          title="Aucune vulnérabilité"
          description={
            search || severity || tool || status || scanType
              ? "Aucun résultat pour ces filtres."
              : "Lance un pipeline pour analyser le projet."
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <Card className="rounded-2xl">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-slate-50/60 text-muted dark:bg-slate-800/40">
                    <tr>
                      <th className="w-8 px-2 py-3" />
                      <th className="px-4 py-3 text-left font-medium">
                        Sévérité
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Outil / Type
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Package / Fichier
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Description
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Statut
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Occurrences
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Dernière détection
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((v) => {
                      const expanded = openId === v.id;
                      return (
                        <FragmentRow
                          key={v.id}
                          vulnerability={v}
                          expanded={expanded}
                          onToggle={() =>
                            setOpenId(expanded ? null : v.id)
                          }
                          projectId={effectiveProjectId}
                          users={users?.items ?? []}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="pt-2">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onPage={(p) => updateParams({ page: p })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
      <p className="mt-1.5 text-xs font-medium">{label}</p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}

function FragmentRow({
  vulnerability: v,
  expanded,
  onToggle,
  projectId,
  users,
}: {
  vulnerability: Vulnerability;
  expanded: boolean;
  onToggle: () => void;
  projectId: string;
  users: Array<{ id: string; name: string | null; email: string }>;
}) {
  const target =
    v.packageName ?? v.filePath?.split(/[\\/]/).pop() ?? "—";

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b border-border/60 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40",
          expanded && "bg-slate-50 dark:bg-slate-800/40",
        )}
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-muted">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="px-4 py-3">
          <SeverityBadge severity={v.severity} />
        </td>
        <td className="px-4 py-3">
          <span className="rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-medium text-muted dark:bg-slate-700/60">
            {v.tool}
          </span>
          {v.scan?.type && (
            <span className="ml-1.5 text-[11px] text-muted">
              {v.scan.type}
            </span>
          )}
        </td>
        <td
          className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200"
          title={v.filePath ?? v.packageName ?? ""}
        >
          {target}
          {v.version && (
            <span className="ml-1 text-muted">@{v.version}</span>
          )}
        </td>
        <td className="max-w-md px-4 py-3">
          {v.reference ? (
            <a
              href={v.reference}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex max-w-full items-center gap-1 truncate text-muted hover:text-primary-500"
              title={v.description ?? ""}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{v.description}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <span className="block truncate text-muted">
              {v.description}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={v.status} />
        </td>
        <td className="px-4 py-3 text-right">
          <span
            className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs tabular-nums dark:bg-slate-700/60"
            title={`${v.occurrences} occurrence(s)`}
          >
            ×{v.occurrences}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted">
          {timeAgo(v.detectedAt)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-slate-50/60 dark:bg-slate-800/20">
          <td colSpan={8} className="px-6 py-4">
            <VulnerabilityEditor
              projectId={projectId}
              vulnerability={v}
              users={users}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: VulnerabilityStatus }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function VulnerabilityEditor({
  projectId,
  vulnerability: v,
  users,
}: {
  projectId: string;
  vulnerability: Vulnerability;
  users: Array<{ id: string; name: string | null; email: string }>;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const [status, setStatus] = useState<VulnerabilityStatus>(v.status);
  const [assignedToId, setAssignedToId] = useState(
    v.assignedTo?.id ?? "",
  );
  const [dueDate, setDueDate] = useState(
    v.dueDate ? v.dueDate.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(v.notes ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      vulnerabilityService.update(projectId, v.id, {
        status,
        assignedToId: assignedToId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes.trim() ? notes : null,
      }),
    onSuccess: (result) => {
      toast.show(
        "success",
        `Mise à jour appliquée à ${result.updatedOccurrences} occurrence(s)`,
      );
      qc.invalidateQueries({ queryKey: ["vulnerabilities"] });
      qc.invalidateQueries({ queryKey: ["project-vulnerabilities"] });
      qc.invalidateQueries({ queryKey: ["vulnerability-summary"] });
    },
    onError: (err) => toast.show("error", getErrorMessage(err)),
  });

  const dirty =
    status !== v.status ||
    assignedToId !== (v.assignedTo?.id ?? "") ||
    dueDate !== (v.dueDate ? v.dueDate.slice(0, 10) : "") ||
    notes !== (v.notes ?? "");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-muted">Première détection</dt>
              <dd>
                {new Date(v.firstSeenAt).toLocaleString("fr-FR")}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Dernière détection</dt>
              <dd>{new Date(v.lastSeenAt).toLocaleString("fr-FR")}</dd>
            </div>
            <div>
              <dt className="text-muted">Version installée</dt>
              <dd className="font-mono">{v.version ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Version corrigée</dt>
              <dd className="font-mono">
                {v.fixedVersion ?? "—"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted">Empreinte (déduplication)</dt>
              <dd className="truncate font-mono" title={v.fingerprint ?? ""}>
                {v.fingerprint ?? "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Statut</label>
          <Select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as VulnerabilityStatus)
            }
          >
            <option value="OPEN">Ouverte</option>
            <option value="CONFIRMED">Confirmée</option>
            <option value="FIXED">Corrigée</option>
            <option value="FALSE_POSITIVE">Faux positif</option>
            <option value="RISK_ACCEPTED">Risque accepté</option>
            <option value="DUPLICATE">Doublon</option>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Assignée à</label>
          <Select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
          >
            <option value="">Non assignée</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </Select>
          <label className="mb-1 mt-3 block text-xs text-muted">
            Échéance
          </label>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted">
          Notes / justification
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          placeholder="Analyse, plan de remédiation, référence au ticket…"
        />
      </div>

      {v.scans.length > 1 && (
        <div>
          <p className="mb-1 text-xs text-muted">
            Historique des occurrences ({v.scans.length})
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {v.scans.map((scan) => (
              <li
                key={scan.id}
                className="flex flex-wrap items-center gap-x-3 rounded-md border border-border/60 px-2.5 py-1.5"
              >
                <span className="font-medium">{scan.scanner}</span>
                <span className="text-muted">{scan.type}</span>
                <span className="font-mono text-muted">
                  {scan.pipeline?.commitSha.slice(0, 8) ?? scan.pipelineId.slice(0, 8)}
                </span>
                <span className="text-muted">{scan.pipeline?.branch}</span>
                <span className="ml-auto text-muted">
                  {new Date(scan.createdAt).toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={!dirty}
          className="gap-2"
        >
          <Save className="h-4 w-4" /> Enregistrer
        </Button>
      </div>
    </div>
  );
}
