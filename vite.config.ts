import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import healthHandler from "./api/health";
import pullHandler from "./api/sync/pull";
import pushHandler from "./api/sync/push";

function localApiPlugin(): Plugin {
  // Dev-only convenience: serve the Vercel-style `/api/*` routes during `vite` dev.
  // This keeps the frontend stateless and avoids exposing Airtable tokens in the browser.
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api/health", (req, res) => {
        void Promise.resolve(healthHandler(req, res)).catch((err: any) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, airtableConfigured: false, message: err?.message || "Health failed" }));
        });
      });
      server.middlewares.use("/api/sync/pull", (req, res) => {
        void Promise.resolve(pullHandler(req, res)).catch((err: any) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, message: err?.message || "Sync pull failed" }));
        });
      });
      server.middlewares.use("/api/sync/push", (req, res) => {
        void Promise.resolve(pushHandler(req, res)).catch((err: any) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, message: err?.message || "Sync push failed" }));
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Vite loads `.env*` for the client (as `import.meta.env`), but our local `/api/*` routes
  // run inside the dev server process and need env vars on `process.env`.
  //
  // We intentionally copy env-file values into `process.env` so `/api/health` reflects `.env.local`.
  ...(function applyLocalEnv() {
    const env = loadEnv(mode, process.cwd(), "");
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return {};
  })(),
  server: {
    // Security: bind to localhost by default so dev server isn't exposed to LAN.
    host: "127.0.0.1",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger(), localApiPlugin()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Avoid scanning archived legacy HTML files as app entrypoints.
  optimizeDeps: {
    entries: ["index.html", "src/main.tsx"],
  },
  build: {
    rollupOptions: {
      input: "index.html",
    },
  },
}));
