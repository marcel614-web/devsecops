// apps/api/src/modules/github/teams.schema.test.ts
import { describe, it, expect } from "vitest";
import {
  addMemberSchema,
  createTeamSchema,
  listMembersQuerySchema,
  listTeamsQuerySchema,
  projectTeamRoleSchema,
  setRepoPermissionSchema,
  teamParamSchema,
} from "./teams.schema";

describe("teams.schema", () => {
  it("accepte une création d'équipe minimale valide", () => {
    const parsed = createTeamSchema.parse({
      name: "Équipe Sécurité",
      privacy: "closed",
    });
    expect(parsed.name).toBe("Équipe Sécurité");
    expect(parsed.privacy).toBe("closed");
  });

  it("rejette un nom vide, une visibilité inconnue ou une description trop longue", () => {
    expect(() =>
      createTeamSchema.parse({ name: "   ", privacy: "closed" }),
    ).toThrow();
    expect(() =>
      createTeamSchema.parse({ name: "Team", privacy: "public" }),
    ).toThrow();
    expect(() =>
      createTeamSchema.parse({
        name: "Team",
        privacy: "closed",
        description: "a".repeat(256),
      }),
    ).toThrow();
  });

  it("rejette les identifiants et logins GitHub invalides", () => {
    expect(() =>
      createTeamSchema.parse({
        name: "Team",
        privacy: "closed",
        parentTeamId: "abc",
      }),
    ).toThrow();
    expect(() =>
      createTeamSchema.parse({
        name: "Team",
        privacy: "closed",
        maintainers: ["-invalid"],
      }),
    ).toThrow();
    expect(() =>
      createTeamSchema.parse({
        name: "Team",
        privacy: "closed",
        repoFullNames: ["pas-un-depot"],
      }),
    ).toThrow();
  });

  it("valide les paramètres d'URL d'équipe", () => {
    expect(
      teamParamSchema.parse({ installationId: "123", slug: "security" }),
    ).toEqual({ installationId: "123", slug: "security" });
    expect(() =>
      teamParamSchema.parse({ installationId: "abc", slug: "security" }),
    ).toThrow();
    expect(() =>
      teamParamSchema.parse({ installationId: "123", slug: "bad slug" }),
    ).toThrow();
  });

  it("applique les valeurs par défaut de pagination", () => {
    expect(listTeamsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 30 });
    expect(listMembersQuerySchema.parse({ page: "2", pageSize: "10" })).toEqual({
      page: 2,
      pageSize: 10,
    });
    expect(() => listTeamsQuerySchema.parse({ pageSize: "500" })).toThrow();
  });

  it("valide les rôles de membre et les permissions de dépôt", () => {
    expect(addMemberSchema.parse({ username: "alice" }).role).toBe("member");
    expect(() =>
      addMemberSchema.parse({ username: "alice--bob", role: "member" }),
    ).toThrow();
    expect(setRepoPermissionSchema.parse({ permission: "maintain" })).toEqual({
      permission: "maintain",
    });
    expect(() =>
      setRepoPermissionSchema.parse({ permission: "owner" }),
    ).toThrow();
    expect(projectTeamRoleSchema.parse("SECURITY_ANALYST")).toBe(
      "SECURITY_ANALYST",
    );
    expect(() => projectTeamRoleSchema.parse("SUPER_ADMIN")).toThrow();
  });
});
