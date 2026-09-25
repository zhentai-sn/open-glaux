import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // 测试默认开放工作台，覆盖双模式契约；缺省关闭的形态见 workbenchFlag.test.tsx
    env: { VITE_GLAUX_EDITION: "full", VITE_GLAUX_WORKBENCH: "1" },
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    restoreMocks: true,
  },
});
