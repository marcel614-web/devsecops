// packages/shared/src/exec.test.ts
import { describe, it, expect } from "vitest";
import { quoteForCmd } from "./exec";

describe("quoteForCmd", () => {
  it("place la valeur entre guillemets", () => {
    expect(quoteForCmd("simple")).toBe('"simple"');
  });

  it("neutralise le separateur de commandes (litteral entre guillemets)", () => {
    // Entre guillemets doubles, `&` `|` `;` `<` `>` sont litteraux pour cmd.
    expect(quoteForCmd("a; whoami")).toBe('"a; whoami"');
    expect(quoteForCmd("a | whoami")).toBe('"a | whoami"');
    expect(quoteForCmd("a > out.txt")).toBe('"a > out.txt"');
  });

  it("neutralise la substitution de commande", () => {
    expect(quoteForCmd("$(whoami)")).toBe('"$(whoami)"');
  });

  it("refuse un guillemet (fail closed)", () => {
    expect(() => quoteForCmd('a"b')).toThrowError(/non sur/i);
  });

  it("refuse une expansion de variable % (fail closed)", () => {
    expect(() => quoteForCmd("%PATH%")).toThrowError(/non sur/i);
  });

  it("supprime les caracteres de controle", () => {
    expect(quoteForCmd("a\nb")).toBe('"ab"');
    expect(quoteForCmd("a\0b")).toBe('"ab"');
  });

  it("preserve les espaces d'un chemin", () => {
    expect(quoteForCmd("C:\\Program Files\\gitleaks.exe")).toBe(
      '"C:\\Program Files\\gitleaks.exe"',
    );
  });
});
