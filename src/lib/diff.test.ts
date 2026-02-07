import { describe, expect, it } from "vitest";
import { diffItem, diffMeasurement, diffOption } from "@/lib/diff";
import type { Item, Measurement, Option } from "@/lib/domain";

describe("diffMeasurement", () => {
  it("diffs tracked fields with normalization", () => {
    const base: Measurement = {
      id: "m_1",
      room: "Living",
      label: "Wall to wall",
      valueIn: 100,
      sort: 0,
      confidence: "med",
      forCategory: null,
      forItemId: null,
      notes: "tape",
      createdAt: 1,
      updatedAt: 1,
      provenance: { dataSource: "concrete", sourceRef: "Plan A", reviewStatus: null },
    };

    const incoming: Measurement = {
      ...base,
      label: "Wall to wall ", // trim should normalize
      valueIn: 101,
      notes: "tape v2",
      provenance: { ...base.provenance, sourceRef: "Plan B" },
      updatedAt: 999,
    };

    const changes = diffMeasurement(base, incoming);
    expect(changes.map((c) => c.field).sort()).toEqual(["notes", "provenance.sourceRef", "valueIn"].sort());
  });
});

describe("diffItem", () => {
  it("diffs nested dimensions and per-key specs", () => {
    const base: Item = {
      id: "i_1",
      name: "Sofa",
      room: "Living",
      category: "Sofa",
      status: "Shortlist",
      sort: 0,
      qty: 1,
      price: 1000,
      store: null,
      link: "https://example.com",
      notes: null,
      priority: null,
      dimensions: { wIn: 80, dIn: 35, hIn: 30 },
      specs: { color: "blue" },
      createdAt: 1,
      updatedAt: 1,
      provenance: { dataSource: "estimated", sourceRef: null, reviewStatus: null },
    };

    const incoming: Item = {
      ...base,
      price: 1200,
      dimensions: { ...base.dimensions, wIn: 82 },
      specs: { color: "blue", size: "L" },
      provenance: { ...base.provenance, dataSource: "concrete" },
      updatedAt: 999,
    };

    const fields = diffItem(base, incoming).map((c) => c.field).sort();
    expect(fields).toEqual(["dimensions.wIn", "price", "provenance.dataSource", "specs.size"].sort());
  });
});

describe("diffOption", () => {
  it("diffs tracked option fields", () => {
    const base: Option = {
      id: "o_1",
      itemId: "i_1",
      title: "Option",
      sort: 0,
      store: "Store",
      link: null,
      promoCode: null,
      price: 100,
      shipping: 10,
      taxEstimate: 5,
      discount: 0,
      dimensionsText: null,
      notes: null,
      selected: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { reviewStatus: null },
    };

    const incoming: Option = { ...base, selected: true, price: 120, updatedAt: 999 };
    const fields = diffOption(base, incoming).map((c) => c.field).sort();
    expect(fields).toEqual(["price", "selected"].sort());
  });
});
