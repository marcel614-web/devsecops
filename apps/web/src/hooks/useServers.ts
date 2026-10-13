// apps/web/src/hooks/useServers.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serverService, type CreateServerInput } from "@/services/server.service";

export function useServers(params?: { search?: string; pageSize?: number }) {
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

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServerInput) => serverService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => serverService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });
}