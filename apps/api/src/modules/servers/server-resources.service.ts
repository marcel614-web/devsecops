// apps/api/src/modules/servers/server-resources.service.ts
import { BadRequestError } from "../../utils/errors";
import {
  runRemoteCommand,
  type DeploymentServerCreds,
} from "../deployments/ssh.util";

export interface ServerResourceContainer {
  name: string;
  image: string;
  status: string;
  state: string;
}

export interface ServerResources {
  fetchedAt: string;
  hostname: string;
  os: string;
  kernel: string;
  architecture: string;
  cpuModel: string;
  uptimeSeconds: number | null;
  cpu: {
    cores: number;
    usagePercent: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
  };
  disk: {
    mount: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  docker: {
    available: boolean;
    running: number;
    total: number;
    images: number;
    containers: ServerResourceContainer[];
  };
}

/**
 * Script POSIX volontairement sans dépendance à des outils non présents
 * sur une Ubuntu minimale : /proc, df, uname et Docker uniquement.
 */
const RESOURCES_SCRIPT = `
echo "HOSTNAME=$(hostname 2>/dev/null)"
echo "OS=$(grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"')"
echo "KERNEL=$(uname -r 2>/dev/null)"
echo "ARCH=$(uname -m 2>/dev/null)"
echo "CPU_MODEL=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')"
echo "UPTIME_SECONDS=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
echo "CORES=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
echo "LOAD=$(cat /proc/loadavg 2>/dev/null)"
CPU1=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8" "$5}' /proc/stat 2>/dev/null)
sleep 0.5
CPU2=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8" "$5}' /proc/stat 2>/dev/null)
echo "CPU1=$CPU1"
echo "CPU2=$CPU2"
awk '/^MemTotal:/{print "MEM_TOTAL_KB="$2} /^MemAvailable:/{print "MEM_AVAILABLE_KB="$2} /^SwapTotal:/{print "SWAP_TOTAL_KB="$2} /^SwapFree:/{print "SWAP_FREE_KB="$2}' /proc/meminfo 2>/dev/null
df -Pk / 2>/dev/null | awk 'NR==2{print "DISK_TOTAL_KB="$2; print "DISK_USED_KB="$3; print "DISK_AVAILABLE_KB="$4; print "DISK_MOUNT="$6}'
if command -v docker >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
  echo "DOCKER_AVAILABLE=1"
  echo "DOCKER_RUNNING=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  echo "DOCKER_TOTAL=$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
  echo "DOCKER_IMAGES=$(docker images -q 2>/dev/null | sort -u | wc -l | tr -d ' ')"
  echo "CONTAINER_BEGIN"
  docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}' 2>/dev/null
  echo "CONTAINER_END"
else
  echo "DOCKER_AVAILABLE=0"
fi
`;

function toInt(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function kbToBytes(value: string | undefined): number {
  return (toInt(value) ?? 0) * 1024;
}

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function parseMetrics(stdout: string) {
  const metrics: Record<string, string> = {};
  const containers: ServerResourceContainer[] = [];
  let inContainers = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "CONTAINER_BEGIN") {
      inContainers = true;
      continue;
    }
    if (line === "CONTAINER_END") {
      inContainers = false;
      continue;
    }

    if (inContainers) {
      const [name, image, status, state] = line.split("|");
      if (name) {
        containers.push({
          name,
          image: image ?? "",
          status: status ?? "",
          state: state ?? "",
        });
      }
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    metrics[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return { metrics, containers };
}

export async function collectServerResources(
  server: DeploymentServerCreds,
): Promise<ServerResources> {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await runRemoteCommand(server, RESOURCES_SCRIPT, 30_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BadRequestError(`Connexion SSH impossible : ${message}`);
  }

  const { metrics, containers } = parseMetrics(result.stdout);

  if (!metrics.HOSTNAME && !metrics.OS) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 300);
    throw new BadRequestError(
      `Impossible de récupérer les ressources du serveur${
        detail ? ` : ${detail}` : ""
      }`,
    );
  }

  // /proc/stat donne des compteurs cumulés : on calcule l'utilisation sur
  // l'intervalle entre les deux relevés (0,5 s).
  const [cpuTotal1, cpuIdle1] = (metrics.CPU1 ?? "")
    .split(/\s+/)
    .map((part) => Number(part));
  const [cpuTotal2, cpuIdle2] = (metrics.CPU2 ?? "")
    .split(/\s+/)
    .map((part) => Number(part));
  const totalDelta = cpuTotal2 - cpuTotal1;
  const idleDelta = cpuIdle2 - cpuIdle1;
  const cpuUsage =
    Number.isFinite(totalDelta) && totalDelta > 0
      ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
      : null;

  const load = (metrics.LOAD ?? "").split(/\s+/);
  const memTotal = kbToBytes(metrics.MEM_TOTAL_KB);
  const memAvailable = kbToBytes(metrics.MEM_AVAILABLE_KB);
  const memUsed = Math.max(0, memTotal - memAvailable);
  const swapTotal = kbToBytes(metrics.SWAP_TOTAL_KB);
  const swapFree = kbToBytes(metrics.SWAP_FREE_KB);
  const swapUsed = Math.max(0, swapTotal - swapFree);

  const diskTotal = kbToBytes(metrics.DISK_TOTAL_KB);
  const diskUsed = kbToBytes(metrics.DISK_USED_KB);
  const diskAvailable = kbToBytes(metrics.DISK_AVAILABLE_KB);

  return {
    fetchedAt: new Date().toISOString(),
    hostname: metrics.HOSTNAME ?? "",
    os: metrics.OS ?? "",
    kernel: metrics.KERNEL ?? "",
    architecture: metrics.ARCH ?? "",
    cpuModel: metrics.CPU_MODEL ?? "",
    uptimeSeconds: toInt(metrics.UPTIME_SECONDS),
    cpu: {
      cores: toInt(metrics.CORES) ?? 1,
      usagePercent: cpuUsage,
      load1: toNumber(load[0]),
      load5: toNumber(load[1]),
      load15: toNumber(load[2]),
    },
    memory: {
      totalBytes: memTotal,
      usedBytes: memUsed,
      availableBytes: memAvailable,
      usagePercent: percent(memUsed, memTotal),
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapUsed,
    },
    disk: {
      mount: metrics.DISK_MOUNT ?? "/",
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      usagePercent: percent(diskUsed, diskTotal),
    },
    docker: {
      available: metrics.DOCKER_AVAILABLE === "1",
      running: toInt(metrics.DOCKER_RUNNING) ?? 0,
      total: toInt(metrics.DOCKER_TOTAL) ?? 0,
      images: toInt(metrics.DOCKER_IMAGES) ?? 0,
      containers,
    },
  };
}
