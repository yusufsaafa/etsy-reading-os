import type {ProductReadiness} from "../products/readiness";
export type SetupState="READY"|"ACTION_REQUIRED"|"UNKNOWN"|"NOT_CONNECTED";
export type SetupProgress={contractVersion:"catalog-setup-progress/v1";state:SetupState;ready:number|null;total:number|null;paused:number;choices:{key:string;state:SetupState;paused:boolean}[];limited:boolean};
/** Projection only: Product readiness remains authoritative; catalog coverage is independent. */
export function setupProgress(listingId:string,verified:boolean,total:number|null,choices:{key:string;productId:string|null;association:string;paused:boolean}[],assessments:Map<string,ProductReadiness>,limited=false):SetupProgress{
 const projected=choices.map(choice=>{const assessment=choice.productId?assessments.get(choice.productId):undefined;
 const exact=assessment?.published.choices.find(c=>c.key===choice.key&&c.listingId===listingId);
 const state:SetupState=!verified?"UNKNOWN":choice.association==="INVALID"?"ACTION_REQUIRED":!choice.productId?"NOT_CONNECTED":!assessment||assessment.evidence.limited?"UNKNOWN":assessment.published.status==="ACTION_REQUIRED"||exact?.status==="ACTION_REQUIRED"?"ACTION_REQUIRED":assessment.published.status==="READY"&&exact?.status==="PASS"?"READY":"UNKNOWN";
 return {key:choice.key,state,paused:choice.paused};});
 const reliable=verified&&!limited&&total!==null&&choices.length===total;
 const ready=reliable?projected.filter(c=>c.state==="READY").length:null;
 const state:SetupState=!reliable?"UNKNOWN":projected.every(c=>c.state==="NOT_CONNECTED")?"NOT_CONNECTED":projected.some(c=>c.state==="ACTION_REQUIRED"||c.state==="NOT_CONNECTED")?"ACTION_REQUIRED":projected.some(c=>c.state==="UNKNOWN")?"UNKNOWN":"READY";
 return {contractVersion:"catalog-setup-progress/v1",state,ready,total:reliable?total:null,paused:projected.filter(c=>c.paused).length,choices:projected,limited};
}
export function setupProgressLabel(p:SetupProgress){return p.state==="UNKNOWN"?"Verification needed":p.state==="NOT_CONNECTED"?"Not connected":p.total!==null&&p.ready!==null?`${p.ready}/${p.total} Ready`:p.state==="ACTION_REQUIRED"?"Setup required":"Verification needed";}
