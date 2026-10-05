import { describe, it, expect } from "vitest";
import { fixtureOrders, FixtureEtsyAdapter } from "../src/modules/etsy/fixtures";
import { orderSchema, triage, validateInputs } from "../src/modules/intake/contracts";
describe("deterministic intake contract", () => {
  it("preserves mixed checkout and quantity", () => {
    const order = orderSchema.parse(fixtureOrders[1]);
    expect(order.lines).toHaveLength(2); expect(order.lines.reduce((n,l) => n+l.quantity,0)).toBe(3);
  });
  it("detects absent personalization without creating an answer", () => {
    expect(fixtureOrders[2].lines[0].answers).toEqual([]);
    expect(triage(fixtureOrders[2],fixtureOrders[2].lines[0],{required:[{label:"Question",minimumLength:1}],paused:false})).toContain("missing_input");
  });
  it("holds unmapped listings and unknown variants", () => { expect(triage(fixtureOrders[3],fixtureOrders[3].lines[0])).toContain("unmapped_listing"); });
  it("requires separate quantity context confirmation", () => { expect(triage(fixtureOrders[1],fixtureOrders[1].lines[0])).toContain("quantity_context"); });
  it("does not lose multilingual Unicode", () => {
    const parsed = orderSchema.parse(fixtureOrders[4]);
    expect(parsed.buyerName).toBe("Çağla 山田");
    expect(parsed.lines[0].answers[0].value).toContain("مرحباً");
    expect(validateInputs(parsed.lines[0].answers,[{label:"Question",minimumLength:1}])).toEqual([]);
  });
  it("holds unsupported uploads instead of fetching URLs", () => { expect(validateInputs([{label:"Photo",value:"https://example.invalid/file",kind:"upload"}],[])).toEqual(["unusable_input"]); });
  it("holds duplicate answer labels", () => { expect(validateInputs([{label:"Question",value:"One",kind:"text"},{label:"Question",value:"Two",kind:"text"}],[{label:"Question",minimumLength:1}])).toEqual(["unusable_input"]); });
  it("rejects malformed quantity and duplicate transaction IDs", () => {
    expect(orderSchema.safeParse({...fixtureOrders[0],lines:[{...fixtureOrders[0].lines[0],quantity:0}]}).success).toBe(false);
    expect(orderSchema.safeParse({...fixtureOrders[0],lines:[fixtureOrders[0].lines[0],fixtureOrders[0].lines[0]]}).success).toBe(false);
  });
  it("fixture adapter represents repeated import", async () => {
    const values=[]; for await(const order of new FixtureEtsyAdapter().orders("900",new Date("2026-10-01"))) values.push(order.externalId);
    expect(values.filter(id=>id==="2002")).toHaveLength(2);
  });
});
