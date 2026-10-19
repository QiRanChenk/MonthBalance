import { defineConfig } from "vitest/config";

// 只跑纯逻辑单测（不起 Nuxt）：lib/**/*.test.ts
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
