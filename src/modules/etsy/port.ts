import type { ExternalOrder, ExternalListing } from "../intake/contracts";
export interface EtsyIntakeAdapter {
  readonly kind: "fixtures" | "etsy";
  listings(shopId: string): AsyncIterable<ExternalListing>;
  orders(shopId: string, since: Date): AsyncIterable<ExternalOrder>;
}
export interface EtsyRevocationAdapter {
  revoke(): Promise<{ remotelyRevoked: boolean; manualActionRequired: boolean }>;
}
export class UnverifiedLiveIntakeAdapter implements EtsyIntakeAdapter {
  readonly kind = "etsy" as const;
  async *listings(): AsyncIterable<ExternalListing> { throw new Error("LIVE_INTAKE_CONTRACT_NOT_VERIFIED"); }
  async *orders(): AsyncIterable<ExternalOrder> { throw new Error("LIVE_INTAKE_CONTRACT_NOT_VERIFIED"); }
}
