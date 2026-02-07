import { describe, expect, it } from "vitest";
import { markProvenanceNeedsReview, markProvenanceVerified } from "@/lib/provenance";

describe("provenance helpers", () => {
  it("markProvenanceVerified sets verified fields and clears modifiedFields", () => {
    const out = markProvenanceVerified(
      {
        reviewStatus: "ai_modified",
        modifiedFields: ["price", "link"],
        dataSource: "estimated",
      },
      123,
    );
    expect(out.reviewStatus).toBe("verified");
    expect(out.verifiedAt).toBe(123);
    expect(out.verifiedBy).toBe("human");
    expect(out.modifiedFields).toBeNull();
  });

  it("markProvenanceNeedsReview clears verifiedAt/verifiedBy", () => {
    const out = markProvenanceNeedsReview(
      {
        reviewStatus: "verified",
        verifiedAt: 100,
        verifiedBy: "human",
      },
      200,
    );
    expect(out.reviewStatus).toBe("needs_review");
    expect(out.verifiedAt).toBeNull();
    expect(out.verifiedBy).toBeNull();
  });
});

