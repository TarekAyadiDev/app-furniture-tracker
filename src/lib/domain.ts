export const DEFAULT_ROOMS = [
  "Living",
  "Dining",
  "Master",
  "Bedroom2",
  "Balcony",
  "Entry",
  "Kitchen",
  "Bath",
] as const;

export type RoomId = string;

export const ITEM_STATUSES = [
  "Idea",
  "Shortlist",
  "Selected",
  "Ordered",
  "Delivered",
  "Installed",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type EntityType = "item" | "option" | "measurement" | "room";

export type SyncState = "clean" | "dirty" | "deleted";

export type ReviewStatus = "needs_review" | "verified" | "ai_modified" | null;

export type DataSource = "concrete" | "estimated" | null;

export type Actor = "human" | "ai" | "import" | "system" | null;

export type ProvenanceChangeLogEntry = {
  field: string;
  from: unknown;
  to: unknown;
  by: Actor;
  at: number;
  sessionId?: string;
};

export type Provenance = {
  createdBy?: Actor;
  createdAt?: number;
  lastEditedBy?: Actor;
  lastEditedAt?: number;
  sourceRef?: string | null;
  dataSource?: DataSource;
  reviewStatus?: ReviewStatus;
  verifiedAt?: number | null;
  verifiedBy?: Actor | null;
  modifiedFields?: string[] | null;
  changeLog?: ProvenanceChangeLogEntry[] | null;
};

export type Dimensions = {
  wIn?: number | null;
  hIn?: number | null;
  dIn?: number | null;
};

export type Item = {
  id: string;
  // Airtable record id once synced (we migrate local ids to Airtable ids on create).
  remoteId?: string | null;
  syncState?: SyncState;

  name: string;
  room: RoomId;
  category: string;
  status: ItemStatus;
  selectedOptionId?: string | null;
  // Manual ordering within a room (lower comes first).
  sort?: number | null;
  price?: number | null;
  discountType?: "amount" | "percent" | null;
  discountValue?: number | null;
  qty: number;
  store?: string | null;
  link?: string | null;
  notes?: string | null;
  priority?: number | null;
  tags?: string[] | null;
  dimensions?: Dimensions;
  // Flexible per-item attributes (size, finish, etc).
  specs?: Record<string, string | number | boolean | null> | null;

  provenance?: Provenance;
  createdAt: number;
  updatedAt: number;
};

export type Option = {
  id: string;
  remoteId?: string | null;
  syncState?: SyncState;

  itemId: string;
  title: string;
  // Manual ordering within an item (lower comes first).
  sort?: number | null;
  store?: string | null;
  link?: string | null;
  promoCode?: string | null;
  price?: number | null;
  shipping?: number | null;
  taxEstimate?: number | null;
  discount?: number | null;
  dimensionsText?: string | null;
  dimensions?: Dimensions;
  specs?: Record<string, string | number | boolean | null> | null;
  notes?: string | null;
  priority?: number | null;
  tags?: string[] | null;
  selected?: boolean;
  sourceItemId?: string;

  provenance?: Provenance;
  createdAt: number;
  updatedAt: number;
};

export type Measurement = {
  id: string;
  remoteId?: string | null;
  syncState?: SyncState;

  room: RoomId;
  label: string;
  // Stored canonically as inches for simpler mental model while shopping.
  valueIn: number;
  // Manual ordering within a room (lower comes first).
  sort?: number | null;
  confidence?: "low" | "med" | "high" | null;
  // Optional linkage for fit checks/templates.
  forCategory?: string | null;
  forItemId?: string | null;
  notes?: string | null;

  provenance?: Provenance;
  createdAt: number;
  updatedAt: number;
};

export type Room = {
  id: RoomId;
  name: string;
  remoteId?: string | null;
  syncState?: SyncState;

  // Manual ordering of rooms (lower comes first).
  sort?: number | null;
  notes?: string | null;
  provenance?: Provenance;
  createdAt: number;
  updatedAt: number;
};

export type PlannerAttachmentV1 = {
  version: 1;
  mergedAt: string;
  // Raw planner/template JSON (kept as-is so you can round-trip edits).
  template: unknown;
};

export type ExportBundleV1 = {
  version: 1;
  exportedAt: string;
  exportMeta?: {
    exportedAt: number;
    exportedBy: Actor;
    appVersion?: string;
    schemaVersion: number;
    sessionId?: string;
  };
  home?: {
    name?: string;
    tags?: string[];
    description?: string;
  };
  planner?: PlannerAttachmentV1 | null;
  rooms: Room[];
  measurements: Measurement[];
  items: Item[];
  options: Option[];
};

export type ExportBundleV2 = Omit<ExportBundleV1, "version" | "exportMeta"> & {
  version: 2;
  exportMeta: {
    exportedAt: number;
    exportedBy: Actor;
    appVersion?: string;
    schemaVersion: 2;
    sessionId?: string;
  };
};
