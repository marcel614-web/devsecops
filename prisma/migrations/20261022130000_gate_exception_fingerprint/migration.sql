-- Une exception de gate doit cibler un finding précis (CVE, règle,
-- empreinte), et non tout un bucket catégorie + sévérité.
ALTER TABLE "SecurityGateException" ADD COLUMN "fingerprint" TEXT;

CREATE INDEX "SecurityGateException_fingerprint_idx"
  ON "SecurityGateException"("fingerprint");
