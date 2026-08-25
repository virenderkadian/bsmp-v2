import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/lib"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
      // Lets the driver app's local stores (mobile/src/...) be tested without
      // a device. See tests/stubs/async-storage.ts.
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "./tests/stubs/async-storage.ts",
      ),
    },
  },
  test: {
    environment: "node",
    // tests/unit holds the pure-logic tests for the driver app's own modules
    // (mobile/src/...). They live here rather than beside the source because
    // the mobile package has no test runner of its own, and its "@/" alias
    // points somewhere different from this project's.
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    // Several suites are integration tests against the real dev Postgres
    // DB (see src/lib/prisma-city-scope.test.ts, src/lib/archive/*.test.ts)
    // — each test file opens its own PrismaClient, and Supabase's
    // session-mode pooler caps concurrent connections project-wide.
    // Running files in parallel (Vitest's default) intermittently exhausts
    // that cap; sequential is slightly slower but deterministic.
    fileParallelism: false,
  },
});
