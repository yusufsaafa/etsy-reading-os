import type { EtsyIntakeAdapter } from "./port";
import type { ExternalOrder, ExternalListing } from "../intake/contracts";
const now = 1791198000;
export const fixtureListings: ExternalListing[] = [
  { externalId: "101", title: "Love Reading", state: "active", updatedAt: now, personalization: [{ label: "Question", type: "text_input", required: true }] },
  { externalId: "102", title: "Career Reading", state: "active", updatedAt: now, personalization: [{ label: "Question", type: "text_input", required: true }] },
  { externalId: "103", title: "Future Reading", state: "active", updatedAt: now, personalization: [{ label: "Question", type: "text_input", required: true }] },
];
const line = (id: string, listingId: string, quantity: number, value: string, variantKey = "default"): ExternalOrder["lines"][number] => ({
  externalId: id, listingId, quantity, title: fixtureListings.find(l => l.externalId === listingId)!.title,
  sku: listingId === "102" ? "CAREER-STD" : null, variantKey,
  variations: variantKey === "default" ? [] : [{ propertyId: "500", valueId: "600", label: "Detail", value: "Extended" }],
  answers: value ? [{ label: "Question", value, kind: "text" }] : [], digital: true,
});
const order = (id: string, buyer: string, lines: ExternalOrder["lines"]): ExternalOrder => ({ externalId: id, buyerName: buyer, createdAt: now, updatedAt: now, paid: true, canceled: false, refund: "none", lines });
export const fixtureOrders: ExternalOrder[] = [
  order("2001", "Alex Morgan", [line("3001", "101", 1, "What should I understand about this connection?")]),
  order("2002", "Taylor Reed", [line("3002", "101", 2, "Two readings for separate people; please confirm their questions."), line("3003", "102", 1, "How can I approach a career change?")]),
  order("2003", "Jamie Park", [line("3004", "101", 1, "")]),
  order("2004", "Jordan Lee", [line("3005", "103", 1, "What deserves my attention this year?", "500:600")]),
  order("2005", "Çağla 山田", [line("3006", "102", 1, "Yeni işimde neye dikkat etmeliyim? 日本語でも読めますか？ مرحباً")]),
  order("2006", "Robin Quinn", [line("3007", "103", 3, "Please clarify the recipient for each of the three readings.")]),
];
export class FixtureEtsyAdapter implements EtsyIntakeAdapter {
  readonly kind = "fixtures" as const;
  constructor(private readonly repeat = true, private readonly failAfter?: number) {}
  async *listings() { for (const listing of fixtureListings) yield structuredClone(listing); }
  async *orders(_shopId: string, since: Date) {
    let count = 0;
    for (const order of [...fixtureOrders, ...(this.repeat ? [fixtureOrders[1]] : [])]) {
      if (this.failAfter !== undefined && count++ === this.failAfter) throw new Error("FIXTURE_INTERRUPTION");
      if (order.createdAt * 1000 >= since.getTime()) yield structuredClone(order);
    }
  }
}
