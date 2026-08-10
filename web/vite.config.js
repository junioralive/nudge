import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    // Force the automatic JSX runtime. Cloudflare's Rolldown build can
    // otherwise fall back to classic JSX and emit React.createElement calls
    // without importing React in every component.
    react({ jsxRuntime: "automatic" }),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      manifest: {
        name: "Nudge",
        short_name: "Nudge",
        description: "Capture tasks and ideas, get nudged before you forget them.",
        theme_color: "#F3F3F3",
        background_color: "#F3F3F3",
        display: "standalone",
        id: "/",
        start_url: "/",
        scope: "/",
        orientation: "portrait-primary",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
    // The root config is the one Cloudflare customizes for Deploy buttons.
    // Keeping Vite on that same file prevents forked Worker names and secrets
    // from drifting away from the generated deployment configuration.
    cloudflare({ configPath: "../wrangler.jsonc" }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "gemini-live": ["@google/genai"],
        },
      },
    },
  },
});
