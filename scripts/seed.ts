import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { users, stores, memberships, connections } from "../src/db/schema";
import { createWorkspace, authorizeStore } from "../src/modules/identity/service";
import { ingestListing, ingestOrder, configureMapping } from "../src/modules/intake/service";
import { fixtureListings, fixtureOrders } from "../src/modules/etsy/fixtures";
if (process.env.NODE_ENV === "production" || process.env.ETSY_ADAPTER !== "fixtures") throw new Error("Seed is for synthetic development data only");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const { db, client } = createDatabase(process.env.DATABASE_URL);
try {
  await db.insert(users).values({ id: "dev:owner", name: "Development seller" }).onConflictDoNothing();
  const storeId = await createWorkspace(db, "dev:owner", "Reading Studio · Demo", "fixtures");
  const scope = await authorizeStore(db, "dev:owner", storeId, true);
  await db.update(stores).set({ importSince: new Date("2026-10-01T00:00:00Z") }).where(eq(stores.id, storeId));
  for (const listing of fixtureListings) await ingestListing(db, scope, listing);
  await configureMapping(db, scope, "101", "default", false);
  await configureMapping(db, scope, "102", "default", false);
  for (const order of [...fixtureOrders, fixtureOrders[1]]) await ingestOrder(db, scope, order);
  console.log("Synthetic workspace seeded. Six orders, seven lines, ten fulfillment units. Replay is safe.");
} finally { await client.end(); }
