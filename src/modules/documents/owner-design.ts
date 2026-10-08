import {z} from "zod";
import {documentDesignSchema} from "./contracts";
/** Controlled owner choices; no client JSON, HTML, assets or executable templates. */
export const ownerDesignChoices=z.strictObject({name:z.string().trim().min(1).max(100),brandName:z.string().trim().min(1).max(120),template:z.enum(["minimal","classic"]),heading:z.enum(["inter","source-serif-4"]),body:z.enum(["inter","source-serif-4"]),footerText:z.string().max(500),approved:z.literal(true)});
export function approvedOwnerDesign(raw:unknown){
 const value=ownerDesignChoices.parse(raw);
 return {name:value.name,configuration:documentDesignSchema.parse({contractVersion:"document-design/v1",template:value.template,brand:{name:value.brandName,primaryColor:"#0F172A",accentColor:"#475569"},typography:{heading:value.heading,body:value.body},cover:"BRAND",display:{customerName:false,readingDate:true,sectionDividers:true,cardImagery:false,footer:!!value.footerText},footerText:value.footerText})};
}
