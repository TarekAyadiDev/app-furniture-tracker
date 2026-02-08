import { nowMs } from "@/lib/format";
import { newId } from "@/lib/id";
import { idbDelete, idbGetAllByIndex, idbPut } from "@/storage/idb";

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
  const ts = nowMs();
  const record: AttachmentRecord = {
    id: newId("att"),
    parentType,
    parentId,
    parentKey: parentKey(parentType, parentId),
    name: opts?.name ?? null,
    sourceUrl: opts?.sourceUrl ?? null,
    mime: blob.type || null,
    size: blob.size || null,
    blob,
    createdAt: ts,
    updatedAt: ts,
  };
  await idbPut("attachments", record);
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
  return await addAttachmentFromBlob(parentType, parentId, blob, { name, sourceUrl: url });
}

export async function deleteAttachment(id: string): Promise<void> {
  await idbDelete("attachments", id);
}
