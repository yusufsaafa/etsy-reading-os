import { it, expect } from "vitest";
import { connectionPresentation } from "../src/modules/onboarding/service";
it("presents connected, disconnected and reauthorization states without leaking internals", () => {
  expect(connectionPresentation("connected", null).kind).toBe("connected");
  expect(connectionPresentation("disconnected", null).kind).toBe("disconnected");
  expect(connectionPresentation("reauthorization_required", null).kind).toBe("expired");
  expect(connectionPresentation("connected", new Date(0)).label).toBe("Etsy connection needs attention");
  expect(connectionPresentation("connected", new Date("2100-01-01")).kind).toBe("connected");
});
