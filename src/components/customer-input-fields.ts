import type { Answer } from "../modules/intake/contracts";
export type CustomerField = {key?:string;label:string;type:string;required:boolean;helpText:string};
export function matchesCustomerField(label:string,field:CustomerField) {
 return label.normalize("NFC")===field.label.normalize("NFC") || label.normalize("NFC")===field.key;
}
// Do not add a blank duplicate when Etsy already supplied the configured key.
export function customerInputFields(initial:Answer[],definitions:CustomerField[],fallbackLabel:string):Answer[] {
 if(!initial.length&&!definitions.length)return [{label:fallbackLabel,value:"",kind:"text"}];
 return [...initial,...definitions.filter(field=>!initial.some(answer=>matchesCustomerField(answer.label,field))).map(field=>({label:field.label,value:"",kind:"text" as const}))].slice(0,20);
}
