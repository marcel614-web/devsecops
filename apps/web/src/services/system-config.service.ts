// apps/web/src/services/system-config.service.ts
import { api } from "./api";

export interface GithubAppConfigPublic {
  appId: string | null;
  slug: string | null;
  hasPrivateKey: boolean;
  hasWebhookSecret: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpdateGithubConfigInput {
  appId?: string;
  slug?: string;
  privateKey?: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export const systemConfigService = {
  getGithubConfig: () =>
    api
      .get<{ config: GithubAppConfigPublic }>("/api/system-config/github")
      .then((r) => r.data.config),

  updateGithubConfig: (input: UpdateGithubConfigInput) =>
    api
      .put<{ config: GithubAppConfigPublic }>("/api/system-config/github", input)
      .then((r) => r.data.config),

  testGithubConfig: (input: { appId: string; privateKey: string }) =>
    api
      .post<TestResult>("/api/system-config/github/test", input)
      .then((r) => r.data),
};