import {z} from "zod";
import {selectionIdentitySchema,selectionKey,etsyId} from "../etsy/source-contract";
import type {SetupCatalog} from "../etsy/setup-catalog";
const text=z.string().max(500),integer=z.number().int().nonnegative().safe();
const schema=z.object({contractVersion:z.literal("etsy-setup-catalog/v1"),observedAt:integer,listing:z.object({id:etsyId,title:z.string().min(1).max(1000),state:z.enum(["active","inactive","draft","sold_out","expired"]),updatedAt:integer.optional(),thumbnailUrl:z.string().max(2048).nullable()}),
 questions:z.array(z.object({questionId:etsyId.nullable(),sourceType:text,label:text,required:z.boolean(),instructions:z.string().max(10000).nullish(),maxCharacters:integer.nullish(),support:z.enum(["TEXT","UNSUPPORTED"])})).max(5),
 configurations:z.array(z.object({key:z.string().max(2000),purchaseSelections:z.array(selectionIdentitySchema).max(3),displaySelections:z.array(z.object({propertyId:etsyId,label:text.nullable(),values:z.array(z.object({valueId:etsyId,label:text})).max(30)})).max(3)})).max(100),state:z.enum(["READY","BLOCKED"]),reasons:z.array(z.enum(["INVALID_STRUCTURE","INCOMPLETE_IDENTITIES","UNSUPPORTED_SCALE","UNSUPPORTED_QUESTION","NO_AVAILABLE_CONFIGURATION","LISTING_UNAVAILABLE"])).max(6)});
export function validateCatalogEvidence(raw:unknown):SetupCatalog{
 const value=schema.parse(raw);
 if(Buffer.byteLength(JSON.stringify(value))>262144||new Set(value.configurations.map(c=>c.key)).size!==value.configurations.length||value.configurations.some(c=>selectionKey(c.purchaseSelections)!==c.key))throw new Error("INVALID_CATALOG_EVIDENCE");
 return value;
}
