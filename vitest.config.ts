import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Several suites are integration tests against the real dev Postgres
    // DB (see src/lib/prisma-city-scope.test.ts, src/lib/archive/*.test.ts)
    // — each test file opens its own PrismaClient, and Supabase's
    // session-mode pooler caps concurrent connections project-wide.
    // Running files in parallel (Vitest's default) intermittently exhausts
    // that cap; sequential is slightly slower but deterministic.
    fileParallelism: false,
  },
});
