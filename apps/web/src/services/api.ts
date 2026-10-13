import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config;
    if (
      error.response?.status === 401 &&
      cfg &&
      !cfg._retry &&
      !cfg.url?.includes("/auth/login") &&
      !cfg.url?.includes("/auth/register")
    ) {
      cfg._retry = true;
      try {
        const { data } = await api.post("/api/auth/refresh");
        localStorage.setItem("accessToken", data.accessToken);
        cfg.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(cfg);
      } catch {
        localStorage.removeItem("accessToken");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string; details?: Array<{ path: string; message: string }> } };
    if (data?.error?.message) {
      if (data.error.details && data.error.details.length > 0) {
        return `${data.error.message} : ${data.error.details.map((d) => d.message).join(", ")}`;
      }
      return data.error.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Erreur inconnue";
}