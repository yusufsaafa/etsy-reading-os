import { it, expect } from "vitest";
import { activationErrors, emptyConfiguration } from "../src/modules/products/contracts";
import { customerInputFields } from "../src/components/customer-input-fields";
import { validateInputs } from "../src/modules/intake/contracts";
it("generic fields match exact NFC labels or keys without interpreting free text",()=>{
 const rule={label:"Prénom",key:"recipient",type:"TEXT" as const,required:true,minimumLength:1};
 expect(validateInputs([{label:"Pre\u0301nom",value:"Çağla 山田",kind:"text"}],[rule])).toEqual([]);
 expect(validateInputs([{label:"recipient",value:"Sam",kind:"text"}],[rule])).toEqual([]);
 expect(validateInputs([{label:"Personalization",value:"My name is Sam",kind:"text"}],[rule])).toEqual(["missing_input"]);
});
it("optional absence is valid while duplicate answers and invalid calendar dates stay unresolved",()=>{
 const rule={label:"Date",minimumLength:1,type:"DATE" as const,required:false};
 expect(validateInputs([],[rule])).toEqual([]);expect(validateInputs([{label:"Date",value:"2024-02-29",kind:"text"}],[rule])).toEqual([]);
 for(const value of ["2026-02-29","2026-02-30","05/10/2026","not a date"])expect(validateInputs([{label:"Date",value,kind:"text"}],[rule])).toContain("unusable_input");
 expect(validateInputs([{label:"Date",value:"2026-10-05",kind:"text"},{label:"Date",value:"2026-10-06",kind:"text"}],[rule])).toContain("unusable_input");
});
it("draft shape may be incomplete but publishing needs named sections and explicit output",()=>{
 expect(activationErrors("",emptyConfiguration)).toEqual(expect.arrayContaining(["Enter a product name.","Add at least one named content section.","Choose an output format."]));
 expect(activationErrors("Letter",{...emptyConfiguration,sections:[{id:"intro",title:"Introduction",instruction:"",sortOrder:0}],output:"PDF"})).toEqual([]);
});

it("ambiguous field label/key aliases cannot publish",()=>{
 const field={id:"first",key:"recipient",label:"Occasion",type:"TEXT" as const,required:true,helpText:"",sortOrder:0};
 expect(activationErrors("Letter",{inputs:[field,{...field,id:"second",key:"occasion",label:"recipient",sortOrder:1}],sections:[{id:"section",title:"Message",instruction:"",sortOrder:0}],output:"TEXT",workflow:"ASSISTED"})).toContain("Customer field labels cannot match another field key.");
});

it("customer correction preserves existing key/NFC answers instead of adding ambiguous blanks",()=>{
 const defs=[{key:"recipient",label:"Prénom",type:"TEXT",required:true,helpText:""},{key:"occasion",label:"Occasion",type:"TEXT",required:true,helpText:""}];
 for(const label of ["recipient","Pre\u0301nom"]){const answers=customerInputFields([{label,value:"Sam 山田",kind:"text"}],defs,"Information");expect(answers).toHaveLength(2);expect(answers[0].value).toBe("Sam 山田");expect(answers[1].label).toBe("Occasion");}
});
