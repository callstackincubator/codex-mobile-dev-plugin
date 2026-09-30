import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "https://127.0.0.1:5173/",
  plugins: [react(), tailwindcss(), {
    name: "mobile-dev-identity",
    configureServer(server) {
      server.middlewares.use("/__mobile_dev_project", (_request, response) => { response.end(fileURLToPath(new URL(".", import.meta.url))); });
      server.middlewares.use("/__mobile_dev", (_request, response) => { response.end("mobile-dev"); });
    },
  }],
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    origin: "https://127.0.0.1:5173",
    https: {
      cert: readFileSync(new URL("./.local-dev/localhost.pem", import.meta.url)),
      key: readFileSync(new URL("./.local-dev/localhost-key.pem", import.meta.url)),
    },
    cors: true,
    watch: { ignored: ["**/dist/**", "**/release/**", "**/vendor/**", "**/runtimes/**"] },
    hmr: { host: "127.0.0.1", port: 5173, protocol: "wss" },
  },
});
