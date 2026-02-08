import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function extFromName(name: string) {
  const parts = name.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  try {
    const body = await parseBody(req);
    const contentType = typeof body?.contentType === "string" ? body.contentType.trim() : "";
    const fileNameRaw = typeof body?.fileName === "string" ? body.fileName.trim() : "photo";
    const parentTypeRaw = typeof body?.parentType === "string" ? body.parentType.trim() : "item";
    const parentIdRaw = typeof body?.parentId === "string" ? body.parentId.trim() : "unknown";

    const fileName = sanitizeFilename(fileNameRaw || "photo");
    const ext = extFromName(fileName);
    const safeParentType = parentTypeRaw === "option" ? "option" : "item";
    const safeParentId = sanitizeFilename(parentIdRaw || "unknown");

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;

    if (!accessKeyId || !secretAccessKey || !region || !bucket) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Missing AWS env vars." }));
      return;
    }

    const key = [
      "uploads",
      safeParentType,
      safeParentId,
      `${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ""}`,
    ].join("/");

    const client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 5 });
    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, uploadUrl, publicUrl, key }));
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to sign upload" }));
  }
}
