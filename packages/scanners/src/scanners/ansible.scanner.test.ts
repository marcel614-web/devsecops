// packages/scanners/src/scanners/ansible.scanner.test.ts
import { describe, expect, it } from "vitest";
import {
  mapAnsibleSeverity,
  normalizeAnsibleSyntaxFailures,
  parseAnsibleLintOutput,
} from "./ansible.scanner";

describe("mapAnsibleSeverity", () => {
  it("mappe les niveaux Ansible vers les sévérités normalisées", () => {
    expect(mapAnsibleSeverity("very_high")).toBe("CRITICAL");
    expect(mapAnsibleSeverity("critical")).toBe("CRITICAL");
    expect(mapAnsibleSeverity("error")).toBe("HIGH");
    expect(mapAnsibleSeverity("warning")).toBe("MEDIUM");
    expect(mapAnsibleSeverity("very_low")).toBe("LOW");
    expect(mapAnsibleSeverity("")).toBe("INFO");
  });
});

describe("parseAnsibleLintOutput", () => {
  it("accepte une liste directe", () => {
    const output = JSON.stringify([
      {
        check_name: "yaml[truthy]",
        severity: "medium",
        filename: "site.yml",
        lineno: 12,
        message: "truthy value should be quoted",
      },
    ]);
    const findings = parseAnsibleLintOutput(output);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      tool: "ansible-lint",
      technology: "IAC",
      severity: "MEDIUM",
      filePath: "site.yml:12",
      description: "truthy value should be quoted",
      reference: "yaml[truthy]",
    });
  });

  it("accepte l'enveloppe { results: [] }", () => {
    const output = JSON.stringify({
      results: [
        {
          checkName: "no-changed-when",
          severity: "HIGH",
          path: "roles/web/tasks/main.yml",
          line: 4,
          description: "command should use changed_when",
        },
      ],
    });
    const findings = parseAnsibleLintOutput(output);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("HIGH");
    expect(findings[0]?.filePath).toBe("roles/web/tasks/main.yml:4");
  });

  it("retourne une liste vide pour une sortie vide ou invalide", () => {
    expect(parseAnsibleLintOutput("")).toEqual([]);
    expect(parseAnsibleLintOutput("{not json")).toEqual([]);
  });
});

describe("normalizeAnsibleSyntaxFailures", () => {
  it("transforme chaque échec en finding HIGH", () => {
    const findings = normalizeAnsibleSyntaxFailures([
      { playbook: "site.yml", message: "syntax error near line 7" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      tool: "ansible-syntax-check",
      technology: "IAC",
      severity: "HIGH",
      filePath: "site.yml",
      description: "syntax error near line 7",
      reference: "ansible-playbook:syntax-check",
    });
  });
});