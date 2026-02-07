export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, airtableConfigured: false, message: "Method not allowed" }));
    return;
  }

  const tokenRaw = process.env.AIRTABLE_TOKEN;
  const baseIdRaw = process.env.AIRTABLE_BASE_ID;
  const tableIdRaw = process.env.AIRTABLE_TABLE_ID;

  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  const baseId = typeof baseIdRaw === "string" ? baseIdRaw.trim() : "";
  const tableId = typeof tableIdRaw === "string" ? tableIdRaw.trim() : "";

  // Treat placeholder values as missing (common when copying `.env.example`).
  const env = {
    AIRTABLE_TOKEN: Boolean(token) && token !== "YOUR_AIRTABLE_PERSONAL_ACCESS_TOKEN",
    AIRTABLE_BASE_ID: Boolean(baseId) && baseId !== "appXXXXXXXXXXXXXX",
    AIRTABLE_TABLE_ID: Boolean(tableId) && tableId !== "tblXXXXXXXXXXXXXX",
  };

  const configured = env.AIRTABLE_TOKEN && env.AIRTABLE_BASE_ID && env.AIRTABLE_TABLE_ID;
  const missing = Object.entries(env)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      airtableConfigured: configured,
      env,
      message: configured
        ? "Airtable env vars present."
        : `Missing env vars: ${missing.join(", ")}. Local dev: put them in .env.local and restart \`npm run dev\`.`,
    }),
  );
}
