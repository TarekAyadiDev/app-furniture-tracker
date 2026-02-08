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
  const ts = nowMs();
  const record: AttachmentRecord = {
    id: newId("att"),
    parentType,
    parentId,
    parentKey: parentKey(parentType, parentId),
    name: file.name || null,
    mime: file.type || null,
    size: file.size || null,
    blob: file,
    createdAt: ts,
    updatedAt: ts,
  };
  await idbPut("attachments", record);
  return record;
}

export async function deleteAttachment(id: string): Promise<void> {
  await idbDelete("attachments", id);
}
