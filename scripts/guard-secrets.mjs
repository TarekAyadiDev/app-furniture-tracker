import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

// Guardrail: fail CI/build if an Airtable token (or similar) is present in tracked files.
//
// This is intentionally conservative: it only matches token-like strings (not the literal
// env var names) to avoid false positives.

const ROOT = process.cwd();

const PAT = /\bpat[a-zA-Z0-9]{10,}\.[a-zA-Z0-9]{20,}\b/g; // Airtable PATs are long and include a dot.
const LEGACY_KEY = /\bkey[a-zA-Z0-9]{14,}\b/g; // Older Airtable API keys.

function isProbablyBinary(buf) {
  // If the first chunk contains null bytes, treat as binary.
  const sample = buf.subarray(0, 1024);
  return sample.includes(0);
}

function getTrackedFiles() {
  try {
    const out = execSync("git ls-files -z", { stdio: ["ignore", "pipe", "ignore"] });
    const raw = out.toString("utf8");
    return raw.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
      out.push(...(await walk(full)));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function findTokenHits(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchPat = line.match(PAT);
    const matchKey = line.match(LEGACY_KEY);
    if (matchPat || matchKey) {
      hits.push({
        line: i + 1,
        preview: line.trim().slice(0, 220),
      });
    }
  }
  return hits;
}

async function main() {
  const tracked = getTrackedFiles();
  const files = tracked
    ? tracked.map((p) => path.join(ROOT, p))
    : await walk(ROOT);

  const findings = [];

  for (const file of files) {
    // Skip env files entirely; they should be gitignored, but be defensive.
    const base = path.basename(file);
    // Scan `.env.example` since it's tracked and should never contain real secrets.
    if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) continue;

    let buf;
    try {
      buf = await fs.readFile(file);
    } catch {
      continue;
    }
    if (isProbablyBinary(buf)) continue;

    const text = buf.toString("utf8");
    const hits = findTokenHits(text);
    if (hits.length) {
      findings.push({
        file: path.relative(ROOT, file),
        hits,
      });
    }
  }

  if (!findings.length) {
    console.log("guard-secrets: OK (no token-like strings found)");
    return;
  }

  console.error("guard-secrets: POTENTIAL SECRETS DETECTED");
  for (const f of findings) {
    console.error(`- ${f.file}`);
    for (const h of f.hits.slice(0, 5)) {
      console.error(`  - line ${h.line}: ${h.preview}`);
    }
    if (f.hits.length > 5) console.error(`  - (+${f.hits.length - 5} more)`);
  }
  console.error("\nFix: remove secrets from tracked files, rotate/revoke tokens, and use env vars.");
  process.exit(1);
}

main().catch((err) => {
  console.error("guard-secrets: error", err);
  process.exit(2);
});
