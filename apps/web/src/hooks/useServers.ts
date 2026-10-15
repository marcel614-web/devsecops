// apps/web/src/hooks/useServers.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  serverService,
  type CreateServerInput,
  type UpdateServerInput,
} from "@/services/server.service";

// ============================================================
// QUERIES
// ============================================================

export function useServers(params?: {
  search?: string;
  pageSize?: number;
  page?: number;
}) {
  return useQuery({
    queryKey: ["servers", params],
    queryFn: () => serverService.list(params),
  });
}

export function useServer(id: string | undefined) {
  return useQuery({
    queryKey: ["server", id],
    queryFn: () => serverService.get(id!),
    enabled: !!id,
  });
}

// ============================================================
// MUTATIONS
// ============================================================

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServerInput) => serverService.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

export function useUpdateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateServerInput }) =>
      serverService.update(id, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["server", variables.id] });
    },
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => serverService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

export function useTestServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => serverService.testServer(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["server", id] });
    },
  });
}