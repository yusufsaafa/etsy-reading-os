import {currentCoverage} from "../catalog/read";
import {validateCatalogEvidence} from "../catalog/evidence";
import type {SetupCatalog} from "../etsy/setup-catalog";
import type {ChoiceEvidence} from "./readiness";
export type SavedChoiceRow={listing:{externalId:string;state:string;sourceUpdatedAt:number};metadata:{shopId:string;setupCatalog:unknown;choicesSourceUpdatedAt:number|null;choicesError:string|null;choicesVerifiedAt:Date|null}|null};
/** Shared current saved evidence interpretation; no labels are used as identity. */
type Expected={listingId:string;key:string;label:string;paused:boolean;mapped:boolean};
export function savedChoiceObserver(rows:SavedChoiceRow[],shopId:string|null,etsy=true){
 const observations=new Map(rows.map(row=>{let catalog:SetupCatalog|undefined;try{catalog=row.metadata?.setupCatalog?validateCatalogEvidence(row.metadata.setupCatalog):undefined;}catch{}
 const coverage=currentCoverage(catalog??null,row.listing.sourceUpdatedAt,row.metadata?.choicesSourceUpdatedAt??null,row.metadata?.choicesError??null);
 const owned=!etsy||!!shopId&&row.metadata?.shopId===shopId;
 return [row.listing.externalId,{row,catalog,current:owned&&coverage.state==="VERIFIED"&&catalog?.listing.id===row.listing.externalId}] as const;
 }));
 return (expected:Expected[]):ChoiceEvidence[]=>[...new Map(expected.map(e=>[e.listingId+":"+e.key,e])).values()].map(e=>{const evidence=observations.get(e.listingId),row=evidence?.row,current=evidence?.current,catalog=evidence?.catalog,observed=current?catalog?.configurations.find(c=>c.key===e.key):undefined;
 const state=!e.mapped||row&&row.listing.state!=="active"||current&&!observed?"ACTION_REQUIRED":!row||!current||!e.key.startsWith("etsy-selection/1:")?"UNKNOWN":"PASS";
 return {...e,label:observed?.displaySelections.flatMap(d=>d.values.map(v=>v.label)).join(" · ")||e.label,state,explanation:!e.mapped?"No owned exact association exists for this version’s policy.":row&&row.listing.state!=="active"?"The saved listing is not active under existing publication rules.":current&&!observed?"The saved association is not present in verified current inventory.":state==="UNKNOWN"?"Inventory is unknown, stale, unsupported or belongs to a previous shop. Historical mappings are retained.":e.paused?"Exact choice verified against the saved revision. Mapping is paused; configuration validity does not remove this hold.":"Exact choice verified against the saved listing revision.",verifiedAt:row?.metadata?.choicesVerifiedAt?.toISOString()??null,catalog:current?catalog:undefined};
 });
}

export function savedChoiceEvidence(rows:SavedChoiceRow[],expected:Expected[],shopId:string|null,etsy=true){return savedChoiceObserver(rows,shopId,etsy)(expected);}
