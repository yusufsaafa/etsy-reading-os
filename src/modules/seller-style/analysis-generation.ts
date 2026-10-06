import { and, desc, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { styleVersions, styleProfiles, styleAnalysisVersions } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere } from "../intake/service";
import { AccessDenied } from "../identity/service";
import { pinnedStyleIntelligence } from "./analysis-contracts";

// Trusted admission reader only: caller has verified authority and holds the Store lock.
// Resolve the stable profile from the admitted published version, never client analysis IDs.
// Do not call from eligibility, execution, replay or retry paths.
export async function pinStyleIntelligenceInTransaction(tx: DbExecutor, scope: Pick<Scope,"organizationId"|"storeId">, styleVersionId: string) {
 const [style] = await tx.select({ profileId: styleProfiles.id }).from(styleVersions)
  .innerJoin(styleProfiles, and(eq(styleVersions.styleProfileId,styleProfiles.id),eq(styleVersions.organizationId,styleProfiles.organizationId),eq(styleVersions.storeId,styleProfiles.storeId)))
  .where(and(tenantWhere(styleVersions,scope),tenantWhere(styleProfiles,scope),eq(styleVersions.id,styleVersionId),ne(styleVersions.status,"DRAFT")));
 if (!style) throw new AccessDenied();
 const [analysis] = await tx.select({analysisVersionId:styleAnalysisVersions.id,versionNumber:styleAnalysisVersions.versionNumber,contractVersion:styleAnalysisVersions.contractVersion,payload:styleAnalysisVersions.payload})
  .from(styleAnalysisVersions).where(and(tenantWhere(styleAnalysisVersions,scope),eq(styleAnalysisVersions.styleProfileId,style.profileId),eq(styleAnalysisVersions.status,"READY")))
  .orderBy(desc(styleAnalysisVersions.versionNumber)).limit(1);
 return analysis ? pinnedStyleIntelligence.parse(analysis) : undefined;
}
