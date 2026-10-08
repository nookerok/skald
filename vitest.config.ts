import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
    globalSetup: "./scripts/vitest-global-setup.ts",
  },
});