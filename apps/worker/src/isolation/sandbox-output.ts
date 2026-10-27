// apps/worker/src/isolation/sandbox-output.ts

/** Taille maximale conservée en mémoire pour stdout/stderr d'une commande. */
export const MAX_SANDBOX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Tampon texte borné : une commande de dépôt peut produire un flux
 * arbitrairement volumineux. On conserve le début jusqu'au plafond et on
 * signale la troncature, sans faire croître la mémoire du worker.
 */
export class BoundedText {
  private parts: string[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: string): void {
    if (!chunk) return;
    const remaining = this.maxBytes - this.bytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (Buffer.byteLength(chunk, "utf8") > remaining) {
      const slice = chunk.slice(0, remaining);
      this.parts.push(slice);
      this.bytes += Buffer.byteLength(slice, "utf8");
      this.truncated = true;
      return;
    }
    this.parts.push(chunk);
    this.bytes += Buffer.byteLength(chunk, "utf8");
  }

  toString(): string {
    const text = this.parts.join("");
    return this.truncated
      ? `${text}\n[sortie tronquée à ${this.maxBytes} octets]`
      : text;
  }
}
