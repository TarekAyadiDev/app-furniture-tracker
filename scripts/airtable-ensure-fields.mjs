#!/usr/bin/env node

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local or your environment.`);
  return value;
};

const token = requiredEnv("AIRTABLE_TOKEN");
const baseId = requiredEnv("AIRTABLE_BASE_ID");
const tableRef = requiredEnv("AIRTABLE_TABLE_ID");
const PRIORITY_FIELD = process.env.AIRTABLE_PRIORITY_FIELD || "Priority";
const SYNC_SOURCE_FIELD = process.env.AIRTABLE_SYNC_SOURCE_FIELD || "Last Sync Source";
const SYNC_AT_FIELD = process.env.AIRTABLE_SYNC_AT_FIELD || "Last Sync At";

const META_BASE = `https://api.airtable.com/v0/meta/bases/${baseId}`;

const selectChoices = (names) => ({ choices: names.map((name) => ({ name })) });

const REQUIRED_FIELDS = [
  { name: "Record Type", type: "singleSelect", options: selectChoices(["Item", "Option", "Measurement", "Note", "Purchase"]) },
  { name: "Title", type: "singleLineText" },
  { name: "Room", type: "singleLineText" },
  { name: "Status", type: "singleSelect", options: selectChoices(["Idea", "Shortlist", "Selected", "Ordered", "Delivered", "Installed", "Returned"]) },
  { name: "Price", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Quantity", type: "number", options: { precision: 0 } },
  { name: "Store", type: "singleLineText" },
  { name: "Link", type: "url" },
  { name: "Notes", type: "multilineText" },
  { name: "Dimensions", type: "singleLineText" },
  { name: PRIORITY_FIELD, type: "number", options: { precision: 0 } },
  { name: "Measure Label", type: "singleLineText" },
  { name: "Value (in)", type: "number", options: { precision: 2 } },
  { name: "Value (cm)", type: "number", options: { precision: 2 } },
  { name: "Unit Entered", type: "singleSelect", options: selectChoices(["cm", "in"]) },
  { name: "Confidence", type: "singleSelect", options: selectChoices(["low", "med", "high"]) },
  { name: "Parent Item Record Id", type: "singleLineText" },
  { name: "Promo Code", type: "singleLineText" },
  { name: "Discount", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Shipping", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Tax Estimate", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Final Total", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Selected Option Id", type: "singleLineText" },
  { name: SYNC_SOURCE_FIELD, type: "singleLineText" },
  { name: SYNC_AT_FIELD, type: "singleLineText" },
];

const airtableFetch = async (path, init = {}) => {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Airtable error ${res.status}: ${text || res.statusText}`);
  }

  return text ? JSON.parse(text) : null;
};

const getTable = async () => {
  const json = await airtableFetch(`${META_BASE}/tables`, { method: "GET" });
  const tables = Array.isArray(json?.tables) ? json.tables : [];
  const table = tables.find((t) => t.id === tableRef || t.name === tableRef);
  if (!table) {
    throw new Error(`Table not found for AIRTABLE_TABLE_ID=${tableRef}.`);
  }
  return table;
};

const createField = async (tableId, field) => {
  const payload = { name: field.name, type: field.type, ...(field.options ? { options: field.options } : {}) };
  return await airtableFetch(`${META_BASE}/tables/${tableId}/fields`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

const main = async () => {
  const table = await getTable();
  const existing = new Set((table.fields || []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));

  if (!missing.length) {
    console.log("All required fields already exist.");
    return;
  }

  console.log(`Creating ${missing.length} missing field(s) in ${table.name} (${table.id})...`);
  for (const field of missing) {
    console.log(`- Creating ${field.name}`);
    await createField(table.id, field);
  }

  console.log("Done.");
};

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
