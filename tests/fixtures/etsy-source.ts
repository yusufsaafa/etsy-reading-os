import type { EtsyProductPolicy, EtsySourceEvidence } from "../../src/modules/etsy/source-contract";
export const value = <T>(v:T)=>({presence:"value" as const,value:v});
export const absent = ()=>({presence:"absent" as const});
export const nil = ()=>({presence:"null" as const});
// Synthetic structures only. No real IDs, customer answers or upload URLs.
export function source():EtsySourceEvidence {
 return {contractVersion:"etsy-purchased-line/v1",receipt:{receiptId:"900",shopId:"77",observedAt:1700000000,createdTimestamp:value(1700000000),updatedTimestamp:absent(),isPaid:value(true),status:value("Completed"),cancellation:{state:"NOT_CANCELED",basis:"STATUS"},refunds:value([]),refundAssessment:"NONE_REPORTED"},transaction:{transactionId:"901",receiptId:value("900"),listingId:value("101"),quantity:1,sku:nil(),isDigital:value(false),listingType:value("physical"),listingTypeProvenance:"CURRENT_LISTING_OBSERVATION"},purchaseSelections:[{sourceOrder:0,propertyId:"513",valueIds:value(["11"]),formattedName:value("Turnaround"),formattedValues:value(["Hour Same"])},{sourceOrder:1,propertyId:"514",valueIds:value(["22"]),formattedName:value("Reading Type"),formattedValues:value(["Extra"])}],buyerInputs:[{sourceOrder:2,propertyId:value("54"),questionId:value("31"),valueId:nil(),sourceType:absent(),encoding:"TEXT",formattedName:value("Custom question"),value:value("Synthetic context")}],buyerFiles:[],unsupported:[]};
}
export function policy():EtsyProductPolicy {return {contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:[{propertyId:"513",valueIds:["11"]},{propertyId:"514",valueIds:["22"]}],inputMappings:[{questionId:"31",propertyId:"54",sourceType:"text_input",inputKey:"question"}]};}
