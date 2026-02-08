const AIRTABLE_API = "https://api.airtable.com/v0";

export function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} environment variable`);
  return v;
}

export function getAirtableConfig() {
  const token = requireEnv("AIRTABLE_TOKEN");
  const baseId = requireEnv("AIRTABLE_BASE_ID");
  const tableId = requireEnv("AIRTABLE_TABLE_ID");
  const view = process.env.AIRTABLE_VIEW_NAME || process.env.AIRTABLE_VIEW_ID || "";
  return { token, baseId, tableId, view };
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function airtableFetch(path: string, init: RequestInit & { token: string }) {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtable error ${res.status}: ${text || res.statusText}`);
  }

  return await res.json();
}

export async function listAllRecords(opts: {
  token: string;
  baseId: string;
  tableId: string;
  view?: string;
  filterByFormula?: string;
  fields?: string[];
}) {
  const { token, baseId, tableId, view, filterByFormula, fields } = opts;
  let offset = "";
  const records: any[] = [];

  while (true) {
    const u = new URL(`${AIRTABLE_API}/${baseId}/${tableId}`);
    u.searchParams.set("pageSize", "100");
    if (view) u.searchParams.set("view", view);
    if (filterByFormula) u.searchParams.set("filterByFormula", filterByFormula);
    if (fields?.length) for (const f of fields) u.searchParams.append("fields[]", f);
    if (offset) u.searchParams.set("offset", offset);

    const json = await airtableFetch(u.toString(), { method: "GET", token });
    records.push(...(json.records || []));
    offset = json.offset || "";
    if (!offset) break;
  }

  return records;
}

export async function createRecords(opts: { token: string; baseId: string; tableId: string; records: any[]; typecast?: boolean }) {
  const { token, baseId, tableId, typecast } = opts;
  const created: any[] = [];
  for (const batch of chunk(opts.records, 10)) {
    const url = typecast ? `${AIRTABLE_API}/${baseId}/${tableId}?typecast=true` : `${AIRTABLE_API}/${baseId}/${tableId}`;
    const json = await airtableFetch(url, {
      method: "POST",
      token,
      body: JSON.stringify({ records: batch }),
    });
    created.push(...(json.records || []));
  }
  return created;
}

export async function updateRecords(opts: { token: string; baseId: string; tableId: string; records: any[]; typecast?: boolean }) {
  const { token, baseId, tableId, typecast } = opts;
  const updated: any[] = [];
  for (const batch of chunk(opts.records, 10)) {
    const url = typecast ? `${AIRTABLE_API}/${baseId}/${tableId}?typecast=true` : `${AIRTABLE_API}/${baseId}/${tableId}`;
    const json = await airtableFetch(url, {
      method: "PATCH",
      token,
      body: JSON.stringify({ records: batch }),
    });
    updated.push(...(json.records || []));
  }
  return updated;
}

export async function deleteRecords(opts: { token: string; baseId: string; tableId: string; ids: string[] }) {
  const { token, baseId, tableId } = opts;
  const deleted: any[] = [];
  for (const batch of chunk(opts.ids, 10)) {
    const u = new URL(`${AIRTABLE_API}/${baseId}/${tableId}`);
    for (const id of batch) u.searchParams.append("records[]", id);
    const json = await airtableFetch(u.toString(), { method: "DELETE", token });
    deleted.push(...(json.records || []));
  }
  return deleted;
}
