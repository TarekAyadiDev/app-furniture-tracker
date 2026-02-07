#!/usr/bin/env node
/**
 * Creates missing fields in the Airtable table used by config.js.
 * Requires: AIRTABLE_TOKEN env var or pass as first arg. Uses BASE_ID and TABLE_ID from config.
 * Scope needed: schema.bases:read, schema.bases:write
 */

const BASE_ID = "appu7GVFA0L582jSY";
const TABLE_ID = "tbl2QlNsGlRbDBMSH";

function getToken() {
  const token = process.env.AIRTABLE_TOKEN || process.argv[2];
  if (!token) {
    console.error("Set AIRTABLE_TOKEN or pass token as first argument.");
    process.exit(1);
  }
  return token;
}

async function api(token, method, path, body = null) {
  const url = path.startsWith("http") ? path : `https://api.airtable.com/v0/meta/bases/${BASE_ID}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && (method === "POST" || method === "PATCH")) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getTables(token) {
  const data = await api(token, "GET", "/tables");
  return data.tables || [];
}

const FIELDS_TO_CREATE = [
  {
    name: "Record Type",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Measurement" },
        { name: "Item" },
        { name: "Option" },
        { name: "Purchase" },
        { name: "Note" },
      ],
    },
  },
  { name: "Title", type: "singleLineText" },
  {
    name: "Room",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Living" },
        { name: "Dining" },
        { name: "Master" },
        { name: "Bedroom2" },
        { name: "Balcony" },
        { name: "Entry" },
        { name: "Kitchen" },
        { name: "Bath" },
      ],
    },
  },
  {
    name: "Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Idea" },
        { name: "Shortlist" },
        { name: "Selected" },
        { name: "Ordered" },
        { name: "Delivered" },
        { name: "Installed" },
        { name: "Returned" },
      ],
    },
  },
  { name: "Priority", type: "number", options: { precision: 0 } },
  { name: "Link", type: "url" },
  { name: "Notes", type: "multilineText" },
  { name: "Budget Target", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Price", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Quantity", type: "number", options: { precision: 0 } },
  { name: "Selected Option Id", type: "singleLineText" },
  // Measurement
  { name: "Measure Label", type: "singleLineText" },
  { name: "Value", type: "number", options: { precision: 2 } },
  {
    name: "Unit Entered",
    type: "singleSelect",
    options: { choices: [{ name: "cm" }, { name: "in" }] },
  },
  { name: "Value (cm)", type: "number", options: { precision: 2 } },
  { name: "Value (in)", type: "number", options: { precision: 2 } },
  {
    name: "Confidence",
    type: "singleSelect",
    options: { choices: [{ name: "low" }, { name: "med" }, { name: "high" }] },
  },
  // Option
  { name: "Parent Item Record Id", type: "singleLineText" },
  { name: "Parent Item Key", type: "singleLineText" },
  { name: "Store", type: "singleLineText" },
  { name: "Promo Code", type: "singleLineText" },
  { name: "Discount", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Shipping", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Tax Estimate", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Final Total", type: "currency", options: { symbol: "$", precision: 2 } },
  { name: "Dimensions", type: "singleLineText" },
  // Purchase
  { name: "Order Date", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
  { name: "Order Number", type: "singleLineText" },
  { name: "Expected Delivery", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
  { name: "Actual Delivery", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
  { name: "Return By", type: "date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
];

async function main() {
  const token = getToken();
  const tables = await getTables(token);
  const table = tables.find((t) => t.id === TABLE_ID || t.name === TABLE_ID);
  if (!table) {
    console.error("Table not found:", TABLE_ID);
    process.exit(1);
  }
  const existingNames = new Set((table.fields || []).map((f) => f.name));
  console.log("Existing fields:", [...existingNames].join(", "));

  const toCreate = FIELDS_TO_CREATE.filter((f) => !existingNames.has(f.name));
  if (toCreate.length === 0) {
    console.log("All required fields already exist.");
    return;
  }

  const pathPrefix = `/tables/${TABLE_ID}/fields`;
  for (const field of toCreate) {
    const body = { name: field.name, type: field.type };
    if (field.options) body.options = field.options;
    try {
      const created = await api(token, "POST", pathPrefix, body);
      console.log("Created:", field.name, "->", created.id);
      existingNames.add(field.name);
    } catch (err) {
      if (err.message.includes("422") || err.message.includes("DUPLICATE")) {
        console.log("Skip (already exists or conflict):", field.name);
      } else {
        throw err;
      }
    }
  }

  console.log("Done. Fetching final schema...");
  const tablesAfter = await getTables(token);
  const tableAfter = tablesAfter.find((t) => t.id === TABLE_ID);
  const names = (tableAfter.fields || []).map((f) => f.name);
  console.log("All columns now:", names.join(", "));

  const recordTypeField = tableAfter.fields.find((f) => f.name === "Record Type");
  if (recordTypeField && recordTypeField.options && recordTypeField.options.choices) {
    const choices = recordTypeField.options.choices.map((c) => c.name);
    console.log("Record Type options:", choices.join(", "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
