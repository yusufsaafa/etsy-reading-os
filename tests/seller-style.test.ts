import { it, expect } from "vitest";
import { emptyStyle, publishErrors, styleConfiguration, sellerIdentity, previousWork } from "../src/modules/seller-style/contracts";
it("generic style dimensions validate without tarot-specific or provider fields",()=>{
 const c=styleConfiguration.parse({...emptyStyle,tone:"NEUTRAL",detail:"BALANCED",approach:"STRUCTURED"});expect(publishErrors(c)).toEqual([]);expect(styleConfiguration.safeParse({...c,model:"fake"}).success).toBe(false);
});
it("incomplete drafts are structural data but cannot publish; custom style needs guidance",()=>{
 expect(styleConfiguration.safeParse(emptyStyle).success).toBe(true);expect(publishErrors(emptyStyle)).toHaveLength(3);expect(publishErrors({...emptyStyle,tone:"CUSTOM",detail:"CONCISE",approach:"CUSTOM"})).toHaveLength(1);
});
it("identity requires only a name; source examples remain optional and text is bounded",()=>{
 expect(sellerIdentity.parse({displayName:" Emily ",shortBio:""})).toEqual({displayName:"Emily",shortBio:""});expect(sellerIdentity.safeParse({displayName:" ",shortBio:""}).success).toBe(false);
 expect(previousWork.safeParse({title:"Example",text:"x".repeat(50001),commandKey:"3bbf1d53-08fa-45a4-9578-548325a734c4"}).success).toBe(false);
});
it("style arrays and instructions have explicit size and enum limits",()=>{
 expect(styleConfiguration.safeParse({...emptyStyle,preferredExpressions:Array(31).fill("A phrase")}).success).toBe(false);expect(styleConfiguration.safeParse({...emptyStyle,instructions:"x".repeat(4001)}).success).toBe(false);expect(styleConfiguration.safeParse({...emptyStyle,tone:"INVALID"}).success).toBe(false);
});
