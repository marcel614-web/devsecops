// apps/web/src/hooks/useSystemConfig.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemConfigService } from "@/services/system-config.service";

export function useGithubConfig() {
  return useQuery({
    queryKey: ["system-config", "github"],
    queryFn: systemConfigService.getGithubConfig,
  });
}

export function useUpdateGithubConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: systemConfigService.updateGithubConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-config"] });
    },
  });
}

export function useTestGithubConfig() {
  return useMutation({
    mutationFn: systemConfigService.testGithubConfig,
  });
}