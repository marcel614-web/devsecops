// packages/shared/src/shell.test.ts
import { describe, it, expect } from "vitest";
import { shellQuote, yamlQuote } from "./shell";

/**
 * Le quoting shell est la barrierè anti-injection de la plateforme.
 * On vérifie qu'une valeur hostile ne peut PAS s'échapper.
 */
describe("shellQuote", () => {
  it("encadre une valeur simple par des apostrophes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("préserve une valeur contenant un espace", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  it("neutralise une double quote", () => {
    const quoted = shellQuote('"; id; "');
    // La double quote est conservée LITTÉRALEMENT (elle est inoffensive
    // entre apostrophes simples) mais elle ne peut plus fermer le quoting
    // ni être interprétée par le shell.
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    // Le contenu est protégé : aucune apostrophe non échappée à l'intérieur.
    const inner = quoted.slice(1, -1);
    expect(inner).not.toMatch(/'(?!\\')/);
  });

  it("neutralise une substitution de commande $(...)", () => {
    const quoted = shellQuote("$(whoami)");
    // Le $ n'est plus interpreted car on est dans des apostrophes simples.
    expect(quoted).toBe("'$(whoami)'");
  });

  it("neutralise un backtick", () => {
    expect(shellQuote("`id`")).toBe("'`id`'");
  });

  it("neutralise une variable d'environnement", () => {
    expect(shellQuote("$SECRET")).toBe("'$SECRET'");
  });

  it("échappe correctement les apostrophes", () => {
    const quoted = shellQuote("it's");
    // La séquence POSIX standard : 'it'\''s'
    expect(quoted).toBe("'it'\\''s'");
  });

  it("supprime les octets NUL (interdits par POSIX)", () => {
    expect(shellQuote("a\0b")).toBe("'ab'");
  });

  it("produit une commande qui ne casse pas sur une charge d'injection", () => {
    const hostile = '"; rm -rf / #';
    const quoted = shellQuote(hostile);
    // Le nombre de guillemets simples pairs => la chaîne est refermable.
    const singleQuotes = (quoted.match(/'/g) ?? []).length;
    expect(singleQuotes % 2).toBe(0);
  });
});

describe("yamlQuote", () => {
  it("échappe une valeur contenant des deux-points", () => {
    expect(yamlQuote("devsecops/proj:8080")).toBe('"devsecops/proj:8080"');
  });

  it("échappe les guillemets", () => {
    expect(yamlQuote('a"b')).toBe('"a\\"b"');
  });
});
