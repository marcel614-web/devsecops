// packages/scanners/src/exec.ts
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ToolExecOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ToolExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execution d'un outil externe sans interpretation shell.
 *
 * PROBLEME CORRIGE : tous les scanners utilisaient `execFile(..., {
 * shell: true })`. En mode shell, Node concatene les arguments en une
 * ligne de commande transmise a `cmd.exe` (Windows) ou `/bin/sh` (Linux),
 * qui en interprete les metacaracteres (`&`, `|`, `;`, `$()`, backticks).
 * Un chemin de workspace, un tag d'image ou une URL contenant
 * `; whoami` executait donc une commande arbitraire sur la machine.
 *
 * CORRECTIF : `shell: false` par defaut. Les arguments sont passes comme un
 * tableau et echappes par Node, sans interpretation.
 *
 * Cas particulier Windows : les fichiers `.bat` / `.cmd` ne sont pas
 * executables sans un interpreteur. On les lance alors via `cmd.exe` en
 * construisant nous-memes la ligne de commande avec un echappement strict.
 */

/** Metacaracteres cmd.exe qui doivent etre neutralises. */
const CMD_SPECIALS = /([()%!^"<>&|])/g;


/**
 * Echappe une valeur pour une ligne de commande cmd.exe.
 *
 * Regles cmd.exe reelles :
 *  - a l'interieur de guillemets doubles, `&`, `|`, `<`, `>`, `(`, `)`
 *    sont LITTURAUX (ils ne sont pas interpretes) ;
 *  - `%` reste actif (expansion `%VAR%`), meme entre guillemets ;
 *  - `^` est litteral entre guillemets doubles (l'echappement par caret
 *    ne fonctionne qu'HORS guillemets).
 *
 * On applique donc la strategie "fail closed" : la valeur est placee entre
 * guillemets doubles, et on REFUSE les caracteres qui resteraient actifs
 * (`"` et `%`) plutot que de tenter un echappement approximatif.
 */
export function quoteForCmd(value: string): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "");

  if (sanitized.includes('"')) {
    throw new Error(
      `Argument non sur pour cmd.exe (guillemet) : ${JSON.stringify(value)}`,
    );
  }
  if (sanitized.includes("%")) {
    throw new Error(
      `Argument non sur pour cmd.exe (expansion de variable) : ${JSON.stringify(value)}`,
    );
  }

  return `"${sanitized}"`;
}

function isWindowsBatch(bin: string): boolean {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(bin);
}

/**
 * Execute un outil externe et retourne stdout/stderr.
 */
export async function execTool(
  bin: string,
  args: string[],
  options: ToolExecOptions = {},
): Promise<ToolExecResult> {
  if (isWindowsBatch(bin)) {
    // On construit la commande nous-memes et on la passe en un seul
    // argument a cmd.exe : Node l'echappe pour CreateProcess, cmd ne voit
    // donc qu'une commande unique et explicite.
    const command = [bin, ...args].map(quoteForCmd).join(" ");
    return execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
    });
  }

  return execFileAsync(bin, args, {
    ...options,
    shell: false,
  });
}

/**
 * Execute un outil en capturant sa sortie ligne par ligne (utile pour les
 * commandes longues dont on veut suivre la progression).
 */
export function spawnTool(
  bin: string,
  args: string[],
  onData: (chunk: string, stream: "stdout" | "stderr") => void,
  options: ToolExecOptions = {},
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });

    child.stdout?.on("data", (chunk: Buffer) =>
      onData(chunk.toString("utf8"), "stdout"),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      onData(chunk.toString("utf8"), "stderr"),
    );

    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}
