import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
    globalTeardown: "./scripts/vitest-global-teardown.ts",
  },
});