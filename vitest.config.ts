import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 180000,
    hookTimeout: 180000,
    sequence: { concurrent: false },
  },
});
