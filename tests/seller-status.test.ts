import { describe, expect, it } from "vitest";
import { readingStatus, orderStatus } from "../src/components/seller-status";
describe("seller-facing status projections", () => {
  it("keeps a mixed cart needing information while a sibling is ready", () => {
    expect(orderStatus([{issues:["quantity_context"]},{issues:["quantity_context"]},{issues:[]}])).toBe("Customer information needed");
    expect(readingStatus([])).toBe("Ready");
  });
  it("never hides financial or source holds behind a setup or input issue", () => {
    expect(readingStatus(["missing_input","unmapped_listing","canceled"])).toBe("Canceled");
    expect(readingStatus(["missing_input","refund_review"])).toBe("Review refund");
    expect(readingStatus(["unmapped_listing","source_changed"])).toBe("Purchase details changed");
    expect(readingStatus(["quantity_context","unpaid"])).toBe("Awaiting payment");
  });
  it("does not turn unknown issues into ready readings", () => { expect(readingStatus(["future_hold"])).toBe("Review required"); });
  it("distinguishes product setup from paused and customer information", () => {
    expect(readingStatus(["unmapped_listing","quantity_context"])).toBe("Product setup required");
    expect(readingStatus(["mapping_paused"])).toBe("Product paused");
    expect(readingStatus(["unusable_input"])).toBe("Customer information needed");
  });
});
