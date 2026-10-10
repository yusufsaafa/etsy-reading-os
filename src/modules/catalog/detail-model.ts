import type {CatalogItem} from "./detail";
export function listingMetrics(item:CatalogItem){
 const verified=item.configuration.state==="VERIFIED"&&!item.operationsLimited;
 const products=new Set(item.configuration.choices.flatMap(c=>c.productId?[c.productId]:[]));
 const pdf=item.pdfAppearance;
 return {options:verified?item.configuration.total:null,configured:verified?item.configuration.configured:null,products:verified?products.size:null,designs:verified&&pdf.state!=="UNKNOWN"&&pdf.products.every(p=>p.state==="RESOLVED")?new Set(pdf.products.map(p=>p.designId)).size:null};
}
export function choiceStatus(choice:CatalogItem["configuration"]["choices"][number]){
 if(choice.state==="CONFIGURED")return choice.paused?"Configured · Paused":"Configured";
 if(choice.association==="INVALID"||choice.hasPublished)return "Needs attention";
 return choice.state==="DRAFT"?"Draft in progress":"Setup required";
}

/** Missing display labels do not turn a varied exact selection into a default. */
export function choiceDimensions(choice:CatalogItem["configuration"]["choices"][number]){
 return choice.purchaseSelections.map(selection=>{
  const display=choice.displaySelections.find(d=>d.propertyId===selection.propertyId);
  return {id:selection.propertyId,label:display?.label||`Property ${selection.propertyId}`,values:selection.valueIds.map(id=>display?.values.find(v=>v.valueId===id)?.label||`Value ${id}`)};
 });
}
