import { nowMs } from "@/lib/format";
import { newId } from "@/lib/id";
import type { Item, Option } from "@/lib/domain";
import { idbDelete, idbGet, idbGetAllByIndex, idbPut } from "@/storage/idb";

export type AttachmentParentType = "item" | "option";

export type AttachmentRecord = {
  id: string;
  parentType: AttachmentParentType;
  parentId: string;
  parentKey: string;
  name: string | null;
  sourceUrl?: string | null;
  mime: string | null;
  size: number | null;
  blob: Blob;
  createdAt: number;
  updatedAt: number;
};

function parentKey(parentType: AttachmentParentType, parentId: string) {
  return `${parentType}:${parentId}`;
}

async function touchParent(parentType: AttachmentParentType, parentId: string) {
  const ts = nowMs();
  if (parentType === "item") {
    const cur = await idbGet<Item>("items", parentId);
    if (!cur) return;
    await idbPut("items", { ...cur, updatedAt: ts, syncState: "dirty" });
    return;
  }
  const cur = await idbGet<Option>("options", parentId);
  if (!cur) return;
  await idbPut("options", { ...cur, updatedAt: ts, syncState: "dirty" });
}

type SignedUpload = { uploadUrl: string; publicUrl: string; key: string };

async function signUpload(params: {
  contentType: string;
  fileName: string;
  parentType: AttachmentParentType;
  parentId: string;
}): Promise<SignedUpload> {
  const res = await fetch("/api/s3/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json?.ok) {
    throw new Error(json?.message || text || `S3 sign failed (${res.status})`);
  }
  return { uploadUrl: json.uploadUrl, publicUrl: json.publicUrl, key: json.key };
}

async function uploadToS3(blob: Blob, opts: { name?: string | null; parentType: AttachmentParentType; parentId: string }) {
  const contentType = blob.type || "application/octet-stream";
  const fileName = opts.name?.trim() || "photo";
  const signed = await signUpload({
    contentType,
    fileName,
    parentType: opts.parentType,
    parentId: opts.parentId,
  });
  const putRes = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }
  return signed.publicUrl;
}

export async function listAttachments(parentType: AttachmentParentType, parentId: string): Promise<AttachmentRecord[]> {
  const rows = await idbGetAllByIndex<AttachmentRecord>("attachments", "parentKey", parentKey(parentType, parentId));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addAttachment(
  parentType: AttachmentParentType,
  parentId: string,
  file: File,
): Promise<AttachmentRecord> {
  return addAttachmentFromBlob(parentType, parentId, file, { name: file.name || null, sourceUrl: null });
}

export async function addAttachmentFromBlob(
  parentType: AttachmentParentType,
  parentId: string,
  blob: Blob,
  opts?: { name?: string | null; sourceUrl?: string | null },
): Promise<AttachmentRecord> {
  const remoteUrl = await uploadToS3(blob, { name: opts?.name ?? null, parentType, parentId });
  const ts = nowMs();
  const record: AttachmentRecord = {
    id: newId("att"),
    parentType,
    parentId,
    parentKey: parentKey(parentType, parentId),
    name: opts?.name ?? null,
    sourceUrl: remoteUrl ?? opts?.sourceUrl ?? null,
    mime: blob.type || null,
    size: blob.size || null,
    blob,
    createdAt: ts,
    updatedAt: ts,
  };
  await idbPut("attachments", record);
  await touchParent(parentType, parentId);
  return record;
}

export async function addAttachmentFromUrl(
  parentType: AttachmentParentType,
  parentId: string,
  url: string,
): Promise<AttachmentRecord> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const blob = await res.blob();
  const name = url.split("/").pop() || "photo";
  return await addAttachmentFromBlob(parentType, parentId, blob, { name });
}

export async function deleteAttachment(id: string): Promise<void> {
  const cur = await idbGet<AttachmentRecord>("attachments", id);
  await idbDelete("attachments", id);
  if (cur) await touchParent(cur.parentType, cur.parentId);
}

export async function rekeyAttachmentParent(
  parentType: AttachmentParentType,
  oldParentId: string,
  newParentId: string,
): Promise<void> {
  const rows = await idbGetAllByIndex<AttachmentRecord>("attachments", "parentKey", parentKey(parentType, oldParentId));
  if (!rows.length) return;
  const ts = nowMs();
  await Promise.all(
    rows.map((att) =>
      idbPut("attachments", {
        ...att,
        parentId: newParentId,
        parentKey: parentKey(parentType, newParentId),
        updatedAt: ts,
      }),
    ),
  );
}
