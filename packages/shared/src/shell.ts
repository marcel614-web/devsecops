// packages/shared/src/shell.ts
/**
 * Utilitaires de quoting shell.
 *
 * Rappel POSIX : à l'intérieur de guillemets doubles, les caractères
 * `$`, `` ` ``, `\` et `!` restent actifs. Un quoting basé sur
 * `"${v.replace(/"/g, '\\"')}"` n'est donc PAS sûr.
 *
 * La méthode correcte est l'quoting par apostrophe simple :
 *   'valeur'  →  tout est littéral, sauf l'apostrophe qui se ferme,
 *                s'échappe et se rouvre :  'it'\''s'
 */
export function shellQuote(value: string): string {
  // On neutralise les octets NUL : POSIX les interdit dans les arguments.
  const sanitized = value.replace(/\0/g, "");
  return `'${sanitized.replace(/'/g, `'\\''`)}'`;
}

/**
 * Variante tolérante pour les contextes Windows (cmd.exe) où le quoting
 * simple ne fonctionne pas. À n'utiliser que pour les binaires locaux.
 */
export function quoteWindowsArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
}

/**
 * Échappe une valeur destinée à un fichier YAML (bloc scalaire simple).
 * Empêche qu'une chaîne contenant `:` ou `#` casse la structure du
 * fichier compose généré.
 */
export function yamlQuote(value: string): string {
  return JSON.stringify(value);
}
