import { it, expect } from "vitest";
import { DOCUMENT_TEMPLATES, documentDesignSchema, designWriteSchema, immutableResolvedDesign, configurationHash } from "../src/modules/documents/contracts";
import { randomUUID } from "node:crypto";
export const config = () => ({contractVersion:"document-design/v1" as const,template:"classic" as const,brand:{name:"Studio",primaryColor:"#1f2937",accentColor:"#abcdef"},typography:{heading:"source-serif-4" as const,body:"inter" as const},cover:"BRAND" as const,display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:"Thank you"});
it("valid controlled templates and fonts normalize safe colors",()=>{
 for(const template of Object.keys(DOCUMENT_TEMPLATES)) expect(documentDesignSchema.safeParse({...config(),template}).success).toBe(true);
 expect(documentDesignSchema.parse(config()).brand.primaryColor).toBe("#1F2937");
 expect(documentDesignSchema.safeParse({...config(),template:"minimal",display:{...config().display,cardImagery:true}}).success).toBe(false);
});
it("rejects unknown configuration, HTML, CSS, templates, fonts and unsafe colors",()=>{
 for(const value of [{...config(),sections:[]},{...config(),html:"<script>"},{...config(),template:"custom"},{...config(),brand:{...config().brand,name:"<b>Studio</b>"}},{...config(),brand:{...config().brand,primaryColor:"var(--color)"}},{...config(),typography:{heading:"url(font)",body:"inter"}},{...config(),cover:"PRODUCT_IMAGE"}]) expect(documentDesignSchema.safeParse(value).success).toBe(false);
});
it("bounds design name, brand and footer; rejects missing and arbitrary options",()=>{
 expect(designWriteSchema.safeParse({name:"x".repeat(101),configuration:config()}).success).toBe(false);
 expect(designWriteSchema.safeParse({name:" ",configuration:config()}).success).toBe(false);
 for(const value of [{...config(),brand:{...config().brand,name:"x".repeat(121)}},{...config(),footerText:"x".repeat(501)},{...config(),display:{...config().display,extra:true}}]) expect(documentDesignSchema.safeParse(value).success).toBe(false);
});
it("resolved values detach, recursively freeze and verify deterministic configuration hashes",()=>{
 const configuration=documentDesignSchema.parse(config());const input={contractVersion:"resolved-document-design/v1",organizationId:randomUUID(),storeId:randomUUID(),productId:randomUUID(),designId:randomUUID(),revision:0,name:"Main",source:"PRODUCT",templateVersion:1,configuration,configurationHash:configurationHash(configuration)};
 const result=immutableResolvedDesign(input);configuration.brand.name="Changed";
 expect(result.configuration.brand.name).toBe("Studio");expect(Object.isFrozen(result.configuration.brand)).toBe(true);
 expect(()=>immutableResolvedDesign(input)).toThrow();expect(configurationHash(documentDesignSchema.parse(config()))).toBe(result.configurationHash);
 expect(Object.keys(result)).not.toContain("sections");expect(Object.keys(result)).not.toContain("provider");
});
