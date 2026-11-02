// apps/worker/src/steps/sign/cosign.step.ts
import { prisma } from "../../utils/prisma";
import { decryptString } from "../../utils/crypto";
import { SshRunner } from "../../runners/ssh.runner";
import { shellQuote } from "@devsecops/shared";
import type { StepContext, StepResult } from "../../orchestrator/step.executor";

/**
 * Signature de l'image Docker avec Cosign.
 *
 * Deux modes :
 *  - COSIGN_REGISTRY dÃ©fini : l'image est retaguÃ©e, poussÃ©e puis signÃ©e
 *    dans le registre (mode recommandÃ©) ;
 *  - sinon : signature locale avec `--upload=false`, la signature est
 *    enregistrÃ©e dans DockerImage.signatureRef (mode dÃ©gradÃ©, utile en TP).
 */
export async function cosignStep(
  _step: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const image = await prisma.dockerImage.findUnique({
    where: { pipelineId: ctx.pipelineId },
    select: { imageTag: true },
  });

  if (!image) {
    await ctx.log("warn", "Aucune image Docker â€” signature Cosign ignorÃ©e");
    return {
      success: true,
      exitCode: 0,
      data: { skipped: true, technical: true, reason: "no docker image" },
    };
  }

  const privateKeyPath = process.env.COSIGN_PRIVATE_KEY_PATH?.trim();
  const publicKeyPath = process.env.COSIGN_PUBLIC_KEY_PATH?.trim();
  const password = process.env.COSIGN_PASSWORD ?? "";
  const registry = process.env.COSIGN_REGISTRY?.trim();
  const registryUser = process.env.COSIGN_REGISTRY_USERNAME?.trim();
  const registryPassword = process.env.COSIGN_REGISTRY_PASSWORD ?? "";

  if (!privateKeyPath) {
    return {
      success: false,
      exitCode: 1,
      error:
        "Cosign est activÃ© mais COSIGN_PRIVATE_KEY_PATH n'est pas configurÃ© sur le worker",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { server: true },
  });
  if (!project?.server) {
    return {
      success: false,
      exitCode: 1,
      error: "Aucun serveur associÃ© â€” impossible de signer l'image",
    };
  }

  const server = project.server;
  if (!server.encryptedPrivateKey) {
    return {
      success: false,
      exitCode: 1,
      error: "ClÃ© SSH du serveur manquante",
    };
  }

  let privateKey: string;
  try {
    privateKey = decryptString(server.encryptedPrivateKey);
  } catch {
    return {
      success: false,
      exitCode: 1,
      error: "Impossible de dÃ©chiffrer la clÃ© SSH",
    };
  }
  const passphrase = server.encryptedPassphrase
    ? decryptString(server.encryptedPassphrase)
    : undefined;

  const ssh = new SshRunner();
  const started = Date.now();

  try {
    await ctx.log("info", "Connexion SSH pour la signature Cosign...");
    await ssh.connect({
      host: server.host,
      port: server.sshPort,
      username: server.username,
      privateKey,
      passphrase,
      hostKeyFingerprint: server.hostKeyFingerprint,
    });

    const availability = await ssh.exec(
      "command -v cosign >/dev/null 2>&1 && echo OK || echo MISSING",
      20_000,
    );
    if (!availability.stdout.includes("OK")) {
      throw new Error(
        "Cosign n'est pas installÃ© sur la VM (https://docs.sigstore.dev/cosign/installation/)",
      );
    }

    let imageRef = image.imageTag;
    let signedLocally = false;

    if (registry) {
      imageRef = `${registry.replace(/\/$/, "")}/${image.imageTag}`;
      await ctx.log("info", `Publication de l'image vers ${imageRef}...`);

      if (registryUser && registryPassword) {
        const login = await ssh.execStream(
          `printf '%s' ${shellQuote(registryPassword)} | docker login ${shellQuote(
            registry.replace(/\/.*$/, ""),
          )} -u ${shellQuote(registryUser)} --password-stdin`,
          (chunk, stream) => {
            const line = chunk.trim();
            if (line && stream === "stderr") {
              void ctx.log("debug", `[docker login] ${line}`);
            }
          },
          60_000,
        );
        if (login !== 0) {
          throw new Error("docker login au registre a Ã©chouÃ©");
        }
      }

      const tag = await ssh.exec(
        `docker tag ${shellQuote(image.imageTag)} ${shellQuote(imageRef)}`,
        60_000,
      );
      if (tag.code !== 0) throw new Error("docker tag a Ã©chouÃ©");

      const push = await ssh.execStream(
        `docker push ${shellQuote(imageRef)}`,
        (chunk, stream) => {
          const line = chunk.trim();
          if (line) {
            void ctx.log(stream === "stderr" ? "debug" : "info", `[push] ${line}`);
          }
        },
        15 * 60_000,
      );
      if (push !== 0) throw new Error("docker push a Ã©chouÃ©");

      await ctx.log("info", `Signature de ${imageRef}...`);
      const sign = await ssh.exec(
        `COSIGN_PASSWORD=${shellQuote(password)} cosign sign --yes --key ${shellQuote(
          privateKeyPath,
        )} ${shellQuote(imageRef)}`,
        5 * 60_000,
      );
      if (sign.code !== 0) {
        throw new Error(
          `cosign sign a Ã©chouÃ© : ${(sign.stderr || sign.stdout).slice(0, 1000)}`,
        );
      }
    } else {
      // Mode dÃ©gradÃ© : signature dÃ©tachÃ©e, conservÃ©e dans la base.
      await ctx.log(
        "warn",
        "COSIGN_REGISTRY non configurÃ© â€” signature locale (--upload=false)",
      );
      const sign = await ssh.exec(
        `COSIGN_PASSWORD=${shellQuote(password)} cosign sign --yes --key ${shellQuote(
          privateKeyPath,
        )} --upload=false ${shellQuote(image.imageTag)}`,
        5 * 60_000,
      );
      if (sign.code !== 0) {
        throw new Error(
          `cosign sign local a Ã©chouÃ© : ${(sign.stderr || sign.stdout).slice(
            0,
            1000,
          )}`,
        );
      }
      signedLocally = true;
    }

    // VÃ©rification si la clÃ© publique est fournie.
    if (publicKeyPath) {
      await ctx.log("info", "VÃ©rification de la signature (cosign verify)...");
      const verify = await ssh.exec(
        `cosign verify --key ${shellQuote(publicKeyPath)} ${shellQuote(imageRef)}`,
        2 * 60_000,
      );
      if (verify.code !== 0) {
        throw new Error(
          `cosign verify a Ã©chouÃ© : ${(verify.stderr || verify.stdout).slice(0, 1000)}`,
        );
      }
      await ctx.log("info", "Signature Cosign vÃ©rifiÃ©e");
    }

    const signatureRef = signedLocally
      ? `local-signature:${image.imageTag}`
      : `${imageRef}@signed`;

    await prisma.dockerImage.update({
      where: { pipelineId: ctx.pipelineId },
      data: {
        signed: true,
        signatureRef,
      },
    });

    await ctx.log(
      "info",
      `Image signÃ©e avec Cosign en ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );

    return {
      success: true,
      exitCode: 0,
      data: {
        signed: true,
        signatureRef,
        registry: registry ?? "vm-local",
        verified: Boolean(publicKeyPath),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log("error", `Ã‰chec de Cosign : ${msg}`);
    return { success: false, exitCode: 1, error: msg };
  } finally {
    await ssh.disconnect().catch(() => undefined);
  }
}
