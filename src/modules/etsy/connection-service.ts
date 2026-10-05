import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../../db/client";
import { connections, stores, oauthStates, syncRuns, auditLogs } from "../../db/schema";
import { verifyScope, tenantWhere } from "../intake/service";
import type { Scope } from "../intake/contracts";
import type { SecretVault } from "../../infrastructure/secrets";
import { newOAuthIntent, hashState, authorizationUrl, exchangeTokens, resolveAuthorizedShop, readScopes, tokenSchema } from "./oauth";

export function liveOAuthConfig() {
  if (process.env.ETSY_LIVE_OAUTH_ENABLED !== "true" || process.env.ETSY_ADAPTER !== "etsy") throw new Error("LIVE_OAUTH_DISABLED");
  const { ETSY_CLIENT_ID: clientId, ETSY_SHARED_SECRET: secret, ETSY_REDIRECT_URI: redirectUri } = process.env;
  if (!clientId || !secret || !redirectUri) throw new Error("ETSY_CONFIGURATION_REQUIRED");
  return { clientId, secret, redirectUri };
}
const context = (scope: Scope) => `${scope.organizationId}:${scope.storeId}:etsy`;
export async function beginOAuth(db: Database, scope: Scope, vault: SecretVault, config = liveOAuthConfig()) {
  const intent = newOAuthIntent();
  const url = authorizationUrl(config.clientId, config.redirectUri, intent);
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const [store] = await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    if (store.source !== "etsy") throw new Error("WRONG_ADAPTER");
    const [connection] = await tx.select().from(connections).where(tenantWhere(connections, scope));
    await tx.update(oauthStates).set({ consumedAt: new Date() }).where(and(tenantWhere(oauthStates, scope), isNull(oauthStates.consumedAt)));
    await tx.insert(oauthStates).values({ organizationId: scope.organizationId, storeId: scope.storeId, userId: scope.userId, stateHash: intent.stateHash, encryptedVerifier: vault.seal(intent.verifier, context(scope)), connectionEpoch: connection.epoch, expiresAt: new Date(Date.now() + 600000) });
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "etsy_authorization_started" });
  });
  return url;
}
export async function completeOAuth(db: Database, userId: string, state: string, code: string, vault: SecretVault, config = liveOAuthConfig()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) throw new Error("INVALID_OAUTH_CALLBACK");
  // User and hash are scoped even before the tenant/store is discovered from server state.
  const [record] = await db.select().from(oauthStates).where(and(eq(oauthStates.userId, userId), eq(oauthStates.stateHash, hashState(state))));
  if (!record) throw new Error("INVALID_OAUTH_STATE");
  const scope: Scope = { userId, organizationId: record.organizationId, storeId: record.storeId };
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const consumed = await tx.update(oauthStates).set({ consumedAt: new Date(), encryptedVerifier: "deleted" }).where(and(tenantWhere(oauthStates, scope), eq(oauthStates.id, record.id), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, new Date()))).returning({ id: oauthStates.id });
    if (!consumed.length) throw new Error("EXPIRED_OR_REPLAYED_OAUTH_STATE");
  });
  const tokens = await exchangeTokens({ grant_type: "authorization_code", client_id: config.clientId, redirect_uri: config.redirectUri, code, code_verifier: vault.open(record.encryptedVerifier, context(scope)) });
  const scopes = tokens.scope.split(" ");
  if (readScopes.some(s => !scopes.includes(s))) throw new Error("ETSY_SCOPES_NOT_GRANTED");
  const shop = await resolveAuthorizedShop(tokens, config.clientId, config.secret);
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const [store] = await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    const [connection] = await tx.select().from(connections).where(tenantWhere(connections, scope));
    if (connection.epoch !== record.connectionEpoch || (store.externalShopId && store.externalShopId !== shop.id)) throw new Error("CONNECTION_CHANGED");
    await tx.update(stores).set({ externalShopId: shop.id, name: shop.name }).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId)));
    await tx.update(connections).set({ status: "connected", encryptedTokens: vault.seal(JSON.stringify(tokens), context(scope)), scopes, expiresAt: new Date(Date.now() + tokens.expires_in * 1000), epoch: connection.epoch + 1, refreshClaim: null, refreshStartedAt: null }).where(tenantWhere(connections, scope));
    await tx.update(syncRuns).set({ status: "canceled" }).where(and(tenantWhere(syncRuns, scope), sql`${syncRuns.status} in ('queued','running')`));
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: userId, action: "etsy_connected" });
  });
  return scope.storeId;
}
export async function connectFixtures(db: Database, scope: Scope) {
  if (process.env.NODE_ENV === "production" || process.env.ETSY_ADAPTER !== "fixtures") throw new Error("FIXTURES_DISABLED");
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const [store] = await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    if (store.source !== "fixtures") throw new Error("WRONG_ADAPTER");
    await tx.update(connections).set({ status: "connected", scopes: [], encryptedTokens: null, epoch: sql`${connections.epoch} + 1` }).where(tenantWhere(connections, scope));
    await tx.update(syncRuns).set({ status: "canceled" }).where(and(tenantWhere(syncRuns, scope), sql`${syncRuns.status} in ('queued','running')`));
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "fixture_connection_enabled" });
  });
}
export async function disconnect(db: Database, scope: Scope) {
  await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    await tx.select().from(stores).where(and(eq(stores.organizationId, scope.organizationId), eq(stores.id, scope.storeId))).for("update");
    await tx.update(connections).set({ status: "disconnected", encryptedTokens: null, scopes: [], expiresAt: null, epoch: sql`${connections.epoch} + 1`, refreshClaim: null, refreshStartedAt: null }).where(tenantWhere(connections, scope));
    await tx.update(oauthStates).set({ consumedAt: new Date(), encryptedVerifier: "deleted" }).where(tenantWhere(oauthStates, scope));
    await tx.update(syncRuns).set({ status: "canceled", claim: null }).where(and(tenantWhere(syncRuns, scope), sql`${syncRuns.status} in ('queued','running')`));
    await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "etsy_locally_disconnected" });
  });
  return { remotelyRevoked: false, manualActionRequired: true };
}
export async function refreshConnection(db: Database, scope: Scope, vault: SecretVault, config = liveOAuthConfig()) {
  const claim = randomUUID();
  const connection = await db.transaction(async tx => {
    await verifyScope(tx, scope, true);
    const [row] = await tx.select().from(connections).where(tenantWhere(connections, scope)).for("update");
    if (!row || row.status !== "connected" || !row.encryptedTokens) throw new Error("ETSY_REAUTHORIZE");
    if (row.refreshClaim) throw new Error("ETSY_REFRESH_ALREADY_RUNNING");
    await tx.update(connections).set({ refreshClaim: claim, refreshStartedAt: new Date() }).where(tenantWhere(connections, scope));
    return row;
  });
  try {
    const old = tokenSchema.parse(JSON.parse(vault.open(connection.encryptedTokens!, context(scope))));
    const tokens = await exchangeTokens({ grant_type: "refresh_token", client_id: config.clientId, refresh_token: old.refresh_token });
    if (readScopes.some(s => !tokens.scope.split(" ").includes(s))) throw new Error("ETSY_REAUTHORIZE");
    await db.transaction(async tx => {
      await verifyScope(tx, scope, true);
      const updated = await tx.update(connections).set({ encryptedTokens: vault.seal(JSON.stringify(tokens), context(scope)), expiresAt: new Date(Date.now() + tokens.expires_in * 1000), scopes: tokens.scope.split(" "), refreshClaim: null, refreshStartedAt: null }).where(and(tenantWhere(connections, scope), eq(connections.epoch, connection.epoch), eq(connections.refreshClaim, claim), eq(connections.status, "connected"))).returning({ id: connections.id });
      if (!updated.length) throw new Error("CONNECTION_CHANGED");
      await tx.insert(auditLogs).values({ organizationId: scope.organizationId, storeId: scope.storeId, actorId: scope.userId, action: "etsy_token_refreshed" });
    });
  } catch {
    await db.update(connections).set({ status: "reauthorization_required", encryptedTokens: null, refreshClaim: null, refreshStartedAt: null }).where(and(tenantWhere(connections, scope), eq(connections.epoch, connection.epoch), eq(connections.refreshClaim, claim)));
    throw new Error("ETSY_REAUTHORIZE");
  }
}
