import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts"],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "cloudflare:sockets": path.resolve(import.meta.dirname, "worker/test-shims/cloudflare-sockets.ts"),
    },
  },
});
