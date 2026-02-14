import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import healthHandler from "./api/health";
import s3SignHandler from "./api/s3/sign";
import s3JsonHandler from "./api/s3/json";
import pullHandler from "./api/sync/pull";
import pushHandler from "./api/sync/push";
import scrapeProductHandler from "./api/scrape/product";
import clipHandler from "./api/clip";

function localApiPlugin(): Plugin {
  // Dev-only convenience: serve the Vercel-style `/api/*` routes during `vite` dev.
  // This keeps the frontend stateless and avoids exposing Airtable tokens in the browser.
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res, next) => {
        const url = req.url || "";
        if (url.startsWith("/health")) {
          void Promise.resolve(healthHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, airtableConfigured: false, message: err?.message || "Health failed" }));
          });
          return;
        }
        if (url.startsWith("/s3/sign")) {
          void Promise.resolve(s3SignHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "S3 sign failed" }));
          });
          return;
        }
        if (url.startsWith("/s3/json")) {
          void Promise.resolve(s3JsonHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "S3 JSON failed" }));
          });
          return;
        }
        if (url.startsWith("/sync/pull")) {
          void Promise.resolve(pullHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "Sync pull failed" }));
          });
          return;
        }
        if (url.startsWith("/sync/push")) {
          void Promise.resolve(pushHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "Sync push failed" }));
          });
          return;
        }
        if (url.startsWith("/scrape/product")) {
          void Promise.resolve(scrapeProductHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "Product scrape failed" }));
          });
          return;
        }
        if (url.startsWith("/clip")) {
          void Promise.resolve(clipHandler(req, res)).catch((err: any) => {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message: err?.message || "Clip failed" }));
          });
          return;
        }
        next();
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
