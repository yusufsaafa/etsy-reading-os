import { z } from "zod";
export const sellerIdentity = z.object({ displayName:z.string().trim().min(1).max(100), shortBio:z.string().trim().max(1000) }).strict();
export const styleConfiguration = z.object({
  tone:z.enum(["WARM","DIRECT","REASSURING","NEUTRAL","CUSTOM"]).nullable(),
  detail:z.enum(["CONCISE","BALANCED","DETAILED"]).nullable(),
  approach:z.enum(["CONVERSATIONAL","STRUCTURED","REFLECTIVE","CUSTOM"]).nullable(),
  preferredExpressions:z.array(z.string().trim().min(1).max(300)).max(30),
  avoidExpressions:z.array(z.string().trim().min(1).max(300)).max(30),
  instructions:z.string().trim().max(4000),
}).strict();
export type StyleConfiguration = z.infer<typeof styleConfiguration>;
export const emptyStyle:StyleConfiguration={tone:null,detail:null,approach:null,preferredExpressions:[],avoidExpressions:[],instructions:""};
export function publishErrors(configuration:StyleConfiguration) {
  const errors:string[]=[];
  if(!configuration.tone) errors.push("Choose a tone.");
  if(!configuration.detail) errors.push("Choose a level of detail.");
  if(!configuration.approach) errors.push("Choose a writing approach.");
  if((configuration.tone==="CUSTOM"||configuration.approach==="CUSTOM")&&!configuration.instructions) errors.push("Describe your custom style in Additional guidance.");
  return errors;
}
// Private text only. HTML is data, never executable markup; source text is never analyzed here.
export const previousWork=z.object({title:z.string().trim().min(1).max(150),text:z.string().trim().min(1).max(50000),commandKey:z.string().uuid()}).strict();
