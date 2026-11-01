import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE ?? (process.env.GITHUB_ACTIONS ? "/mint-harness/" : "/"),
  resolve: {
    alias: {
      "@mint/cat-art": fileURLToPath(new URL("../src/cat-art.ts", import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    target: "es2022",
  },
});
