// scripts/backfill-fingerprints.mjs
//
// Renseigne l'empreinte (fingerprint) des vulnérabilités créées avant
// l'introduction de la déduplication, puis recalcule les compteurs de
// cycle de vie (occurrences, firstSeenAt, lastSeenAt, statut).
//
// Idempotent : peut être relancé sans effet de bord.
//
// Usage : npm run db:backfill-fingerprints

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INHERITED = new Set([
  "FALSE_POSITIVE",
  "RISK_ACCEPTED",
  "DUPLICATE",
  "CONFIRMED",
]);

function norm(value) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fingerprint(projectId, finding) {
  const source = [
    projectId,
    norm(finding.tool),
    norm(finding.packageName),
    norm(finding.filePath),
    norm(finding.reference) || norm(finding.description).slice(0, 300),
  ].join("|");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function laterOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function main() {
  const rows = await prisma.vulnerability.findMany({
    include: { scan: { select: { projectId: true } } },
  });

  console.log(`Vulnérabilités chargées : ${rows.length}`);

  // 1. Calcule et persiste l'empreinte manquante.
  let filled = 0;
  for (const row of rows) {
    if (row.fingerprint) continue;
    row.fingerprint = fingerprint(row.scan.projectId, row);
    await prisma.vulnerability.update({
      where: { id: row.id },
      data: { fingerprint: row.fingerprint },
    });
    filled += 1;
  }
  console.log(`Empreintes calculées et enregistrées : ${filled}`);

  // 1bis. Sépare les occurrences d'un même scan qui partagent une
  // empreinte : un scanner peut signaler plusieurs emplacements distincts
  // avec la même règle (Semgrep), et l'ancienne empreinte ne contenait
  // pas le numéro de ligne. On ne touche pas aux groupes multi-scans,
  // qui représentent de vraies répétitions dans le temps.
  const initialGroups = new Map();
  for (const row of rows) {
    const key = `${row.scan.projectId}|${row.fingerprint}`;
    const list = initialGroups.get(key) ?? [];
    list.push(row);
    initialGroups.set(key, list);
  }

  let split = 0;
  for (const list of initialGroups.values()) {
    if (list.length <= 1) continue;
    const scanIds = new Set(list.map((r) => r.scanId));
    if (scanIds.size !== 1) continue;
    for (const row of list) {
      const unique = crypto
        .createHash("sha256")
        .update(`${row.fingerprint}|${row.id}`)
        .digest("hex");
      await prisma.vulnerability.update({
        where: { id: row.id },
        data: { fingerprint: unique },
      });
      row.fingerprint = unique;
      split += 1;
    }
  }
  console.log(`Occurrences séparées (même scan) : ${split}`);

  // 2. Regroupe par (projet, empreinte).
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.scan.projectId}|${row.fingerprint}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let updated = 0;

  for (const list of groups.values()) {
    // La ligne la plus récente porte les métadonnées de cycle de vie.
    const sorted = [...list].sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() ||
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );
    const latest = sorted[0];

    const inherited = sorted.find((r) => INHERITED.has(r.status));
    const status = inherited?.status ?? latest.status;

    let firstSeenAt = sorted[0].firstSeenAt;
    let lastSeenAt = sorted[0].lastSeenAt;
    let notes = null;
    let dueDate = null;
    let assignedToId = null;

    for (const row of sorted) {
      if (new Date(row.firstSeenAt) < new Date(firstSeenAt)) {
        firstSeenAt = row.firstSeenAt;
      }
      lastSeenAt = laterOf(lastSeenAt, row.lastSeenAt);
      if (!notes && row.notes) notes = row.notes;
      if (!dueDate && row.dueDate) dueDate = row.dueDate;
      if (!assignedToId && row.assignedToId) assignedToId = row.assignedToId;
    }

    const result = await prisma.vulnerability.updateMany({
      where: {
        fingerprint: latest.fingerprint,
        scan: { projectId: latest.scan.projectId },
      },
      data: {
        firstSeenAt,
        lastSeenAt,
        occurrences: list.length,
        status,
        notes,
        dueDate,
        assignedToId,
      },
    });

    updated += result.count;  }

  console.log(`Occurrences mises à jour : ${updated}`);
  console.log(`Groupes (findings uniques) : ${groups.size}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
