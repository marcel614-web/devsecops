// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@devsecops/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // Les tests d'intégration DB utilisent une base dédiée : on les
    // sérialise pour éviter que deux suites ne se marchent dessus.
    fileParallelism: false,
    pool: "forks",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/index.ts",
        "src/**/index.ts",
      ],
    },
  },
});
