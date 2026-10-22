// apps/web/src/features/servers/ServerResourcesPanel.tsx
import {
  Clock,
  Container,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, formatBytes, timeAgo } from "@/lib/utils";
import type { ServerResources } from "@/services/server.service";

interface Props {
  resources: ServerResources;
  onRefresh?: () => void;
  refreshing?: boolean;
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatUptime(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function barColor(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function ResourceBar({
  icon: Icon,
  label,
  value,
  percent,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  percent: number | null;
  detail?: string;
}) {
  const safePercent = clampPercent(percent);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 font-medium">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cn("h-full rounded-full transition-all", barColor(safePercent))}
          style={{ width: `${safePercent}%` }}
        />
      </div>
      {detail && <div className="mt-0.5 text-[11px] text-muted">{detail}</div>}
    </div>
  );
}

function InfoLine({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Icon className="h-3 w-3 shrink-0 text-muted" />
      <span className="shrink-0 text-muted">{label} :</span>
      <span className="truncate font-mono text-[11px]">{value}</span>
    </div>
  );
}

export function ServerResourcesPanel({ resources, onRefresh, refreshing }: Props) {
  const { cpu, memory, disk, docker } = resources;

  const load =
    cpu.load1 == null
      ? "—"
      : `${cpu.load1.toFixed(2)} / ${cpu.load5?.toFixed(2) ?? "—"} / ${
          cpu.load15?.toFixed(2) ?? "—"
        }`;

  const swap =
    memory.swapTotalBytes > 0
      ? `Swap ${formatBytes(memory.swapUsedBytes)} / ${formatBytes(memory.swapTotalBytes)}`
      : "Swap inactif";

  return (
    <div className="mt-3 rounded-lg border border-border bg-slate-50/60 p-3 dark:bg-slate-800/20">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Gauge className="h-3.5 w-3.5" />
          Ressources système
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">
            Relevé {timeAgo(resources.fetchedAt)}
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="text-muted hover:text-primary-500 disabled:opacity-50"
              title="Actualiser les ressources"
              aria-label="Actualiser les ressources"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <ResourceBar
          icon={Cpu}
          label="CPU"
          value={
            cpu.usagePercent == null
              ? "—"
              : `${cpu.usagePercent.toFixed(1)} %`
          }
          percent={cpu.usagePercent}
          detail={`${cpu.cores} cœur${cpu.cores > 1 ? "s" : ""} · charge ${load}`}
        />
        <ResourceBar
          icon={MemoryStick}
          label="Mémoire"
          value={`${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
          percent={memory.usagePercent}
          detail={`${formatBytes(memory.availableBytes)} disponibles · ${swap}`}
        />
        <ResourceBar
          icon={HardDrive}
          label={`Disque ${disk.mount}`}
          value={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
          percent={disk.usagePercent}
          detail={`${formatBytes(disk.availableBytes)} disponibles`}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border/60 pt-2 sm:grid-cols-2">
        <InfoLine icon={Server} label="Hôte" value={resources.hostname || "—"} />
        <InfoLine
          icon={Clock}
          label="Uptime"
          value={formatUptime(resources.uptimeSeconds)}
        />
        <InfoLine
          icon={Cpu}
          label="Processeur"
          value={resources.cpuModel || "—"}
          className="sm:col-span-2"
        />
        <InfoLine
          icon={Server}
          label="Système"
          value={
            [resources.os, resources.kernel, resources.architecture]
              .filter(Boolean)
              .join(" · ") || "—"
          }
          className="sm:col-span-2"
        />
      </div>

      <div className="mt-2 border-t border-border/60 pt-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Container className="h-3.5 w-3.5 text-muted" />
          Docker
          <span className="ml-auto text-[11px] font-normal text-muted">
            {docker.available
              ? `${docker.running} actif${docker.running > 1 ? "s" : ""} · ${
                  docker.total
                } au total · ${docker.images} image${docker.images > 1 ? "s" : ""}`
              : "indisponible"}
          </span>
        </div>

        {docker.available && docker.containers.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {docker.containers.slice(0, 5).map((container) => (
              <li
                key={`${container.name}-${container.image}`}
                className="flex min-w-0 items-center gap-2 rounded bg-slate-500/5 px-2 py-1 text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {container.name}
                </span>
                <span className="hidden min-w-0 flex-1 truncate text-muted sm:block">
                  {container.image}
                </span>
                <span
                  className={cn(
                    "shrink-0",
                    container.state === "running"
                      ? "text-emerald-600 dark:text-emerald-500"
                      : "text-muted",
                  )}
                >
                  {container.state || "—"}
                </span>
              </li>
            ))}
            {docker.containers.length > 5 && (
              <li className="text-[11px] text-muted">
                + {docker.containers.length - 5} autre
                {docker.containers.length - 5 > 1 ? "s" : ""}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
