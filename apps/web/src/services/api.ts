// apps/web/src/services/api.ts
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  withCredentials: true,
});

// --- Requête : ajoute le Bearer token si présent ---
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- Réponse : refresh automatique en cas de 401 ---
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { data } = await axios.post(
    `${api.defaults.baseURL}/api/auth/refresh`,
    {},
    { withCredentials: true },
  );
  const token = data.accessToken as string;
  localStorage.setItem("accessToken", token);
  return token;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const url: string = cfg?.url ?? "";
    const isAuthEndpoint =
      url.includes("/api/auth/login") ||
      url.includes("/api/auth/register") ||
      url.includes("/api/auth/refresh");

    if (error.response?.status === 401 && cfg && !cfg._retry && !isAuthEndpoint) {
      cfg._retry = true;
      try {
        if (!refreshing) {
          refreshing = refreshAccessToken().finally(() => {
            refreshing = null;
          });
        }
        const newToken = await refreshing;
        cfg.headers.Authorization = `Bearer ${newToken}`;
        return api(cfg);
      } catch {
        localStorage.removeItem("accessToken");
        // Déconnexion locale + redirection
        window.dispatchEvent(new Event("auth:expired"));
      }
    }
    return Promise.reject(error);
  },
);

// --- Helper pour extraire un message d'erreur lisible ---
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string; details?: Array<{ path: string; message: string }> } }
      | undefined;
    if (data?.error?.message) {
      if (data.error.details?.length) {
        return `${data.error.message} : ${data.error.details.map((d) => d.message).join(", ")}`;
      }
      return data.error.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Erreur inconnue";
}