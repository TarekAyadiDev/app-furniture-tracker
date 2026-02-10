import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function parseBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => (data += String(chunk)));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sanitizeKeyPart(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function formatExportStamp(ts = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = ts.getFullYear();
  const m = pad(ts.getMonth() + 1);
  const d = pad(ts.getDate());
  const hh = pad(ts.getHours());
  const mm = pad(ts.getMinutes());
  return `${y}${m}${d}_${hh}${mm}`;
}

async function streamToString(body: any): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf-8");
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
  }
  if (typeof body.on === "function") {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      body.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      body.on("error", reject);
      body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
  }
  return "";
}

async function readJsonFromKey(client: S3Client, bucket: string, key: string) {
  const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
  const out = await client.send(getCommand);
  const raw = await streamToString(out.Body as any);
  return raw ? JSON.parse(raw) : null;
}

async function writeJsonToKey(client: S3Client, bucket: string, key: string, data: unknown) {
  const payload = JSON.stringify(data, null, 2);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: payload,
      ContentType: "application/json",
    }),
  );
}

export default async function handler(req: any, res: any) {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const basePrefix = "uploads/exports";
  const legacyPrefix = "exports";

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: "Missing AWS env vars." }));
    return;
  }

  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  if (req.method === "GET") {
    try {
      const url = new URL(req.url || "", "http://localhost");
      const list = url.searchParams.get("list");
      const keyParam = url.searchParams.get("key");
      const key = keyParam && keyParam.trim() ? keyParam.trim() : `${basePrefix}/latest.json`;

      if (list) {
        const latestMetaKey = `${basePrefix}/latest.meta.json`;
        const previousMetaKey = `${basePrefix}/previous.meta.json`;
        const latestKey = `${basePrefix}/latest.json`;
        const previousKey = `${basePrefix}/previous.json`;
        const snapshots: Array<{ key: string; name: string | null; exportedAt: string | null; filename: string | null }> = [];

        async function readMeta(metaKey: string, dataKey: string) {
          try {
            const meta = await readJsonFromKey(client, bucket, metaKey);
            if (meta && typeof meta === "object") return meta as any;
          } catch {
            // ignore
          }
          try {
            const data = await readJsonFromKey(client, bucket, dataKey);
            if (data && typeof data === "object") {
              return {
                filename: typeof (data as any)?.exportMeta?.sessionId === "string" ? null : null,
                exportedAt:
                  typeof (data as any)?.exportedAt === "string"
                    ? (data as any).exportedAt
                    : typeof (data as any)?.exportMeta?.exportedAt === "number"
                      ? new Date((data as any).exportMeta.exportedAt).toISOString()
                      : null,
                homeName: typeof (data as any)?.home?.name === "string" ? (data as any).home.name : null,
              };
            }
          } catch {
            // ignore
          }
          return null;
        }

        const latestMeta = await readMeta(latestMetaKey, latestKey);
        if (latestMeta) {
          snapshots.push({
            key: latestKey,
            name: typeof latestMeta.homeName === "string" ? latestMeta.homeName : null,
            exportedAt: typeof latestMeta.exportedAt === "string" ? latestMeta.exportedAt : null,
            filename: typeof latestMeta.filename === "string" ? latestMeta.filename : null,
          });
        }

        const previousMeta = await readMeta(previousMetaKey, previousKey);
        if (previousMeta) {
          snapshots.push({
            key: previousKey,
            name: typeof previousMeta.homeName === "string" ? previousMeta.homeName : null,
            exportedAt: typeof previousMeta.exportedAt === "string" ? previousMeta.exportedAt : null,
            filename: typeof previousMeta.filename === "string" ? previousMeta.filename : null,
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        // Fallback: try legacy prefix if no snapshots yet.
        if (!snapshots.length) {
          const legacyLatestMetaKey = `${legacyPrefix}/latest.meta.json`;
          const legacyPreviousMetaKey = `${legacyPrefix}/previous.meta.json`;
          const legacyLatestKey = `${legacyPrefix}/latest.json`;
          const legacyPreviousKey = `${legacyPrefix}/previous.json`;

          const legacyLatestMeta = await readMeta(legacyLatestMetaKey, legacyLatestKey);
          if (legacyLatestMeta) {
            snapshots.push({
              key: legacyLatestKey,
              name: typeof legacyLatestMeta.homeName === "string" ? legacyLatestMeta.homeName : null,
              exportedAt: typeof legacyLatestMeta.exportedAt === "string" ? legacyLatestMeta.exportedAt : null,
              filename: typeof legacyLatestMeta.filename === "string" ? legacyLatestMeta.filename : null,
            });
          }

          const legacyPreviousMeta = await readMeta(legacyPreviousMetaKey, legacyPreviousKey);
          if (legacyPreviousMeta) {
            snapshots.push({
              key: legacyPreviousKey,
              name: typeof legacyPreviousMeta.homeName === "string" ? legacyPreviousMeta.homeName : null,
              exportedAt: typeof legacyPreviousMeta.exportedAt === "string" ? legacyPreviousMeta.exportedAt : null,
              filename: typeof legacyPreviousMeta.filename === "string" ? legacyPreviousMeta.filename : null,
            });
          }
        }

        res.end(JSON.stringify({ ok: true, snapshots }));
        return;
      }

      if (!key.startsWith(`${basePrefix}/`) && !key.startsWith(`${legacyPrefix}/`)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, message: "Invalid key." }));
        return;
      }

      const data = await readJsonFromKey(client, bucket, key);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, key, data }));
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to fetch JSON from S3" }));
      return;
    }
  }

  if (req.method === "POST") {
    try {
      const body = await parseBody(req);
      const data = body?.data ?? body?.bundle ?? null;
      if (!data || typeof data !== "object") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, message: "Missing JSON payload." }));
        return;
      }

      const filenameRaw = typeof body?.filename === "string" ? body.filename : "";
      const safeFilename = filenameRaw ? sanitizeKeyPart(filenameRaw) : `furniture_tracker_export_${formatExportStamp()}.json`;
      const key = `${basePrefix}/${safeFilename.endsWith(".json") ? safeFilename : `${safeFilename}.json`}`;
      const latestKey = `${basePrefix}/latest.json`;
      const previousKey = `${basePrefix}/previous.json`;
      const latestMetaKey = `${basePrefix}/latest.meta.json`;
      const previousMetaKey = `${basePrefix}/previous.meta.json`;

      const homeName = typeof (data as any)?.home?.name === "string" ? (data as any).home.name : null;
      const exportedAt =
        typeof (data as any)?.exportedAt === "string"
          ? (data as any).exportedAt
          : typeof (data as any)?.exportMeta?.exportedAt === "number"
            ? new Date((data as any).exportMeta.exportedAt).toISOString()
            : null;
      const meta = { filename: safeFilename, exportedAt, homeName };

      // Move latest -> previous (best effort).
      try {
        const latestPayload = await readJsonFromKey(client, bucket, latestKey);
        if (latestPayload) await writeJsonToKey(client, bucket, previousKey, latestPayload);
      } catch {
        // ignore
      }
      try {
        const latestMeta = await readJsonFromKey(client, bucket, latestMetaKey);
        if (latestMeta) await writeJsonToKey(client, bucket, previousMetaKey, latestMeta);
      } catch {
        // ignore
      }

      await writeJsonToKey(client, bucket, key, data);
      await writeJsonToKey(client, bucket, latestKey, data);
      await writeJsonToKey(client, bucket, latestMetaKey, meta);

      const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, key, latestKey, previousKey, publicUrl, meta }));
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to upload JSON to S3" }));
      return;
    }
  }

  res.statusCode = 405;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
}
