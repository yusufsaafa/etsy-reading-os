import {z} from "zod";
import {etsyId} from "../etsy/source-contract";
import {parseEtsyJson} from "../etsy/raw-normalizer";
import {receiptMoneySchema,type ExactMoney} from "./money";
const identity=z.union([etsyId,z.number().int().positive().safe().transform(String)]);
const timestamp=z.number().int().nonnegative().max(2147483647);
export type ReceiptFinanceEvidence={contract:"etsy-receipt-finance/v1";shopId:string;receiptId:string;sourceUpdatedAt:number|null;state:"VERIFIED"|"MISSING"|"INVALID"|"UNCERTAIN";total?:ExactMoney;refundPresent:boolean};
/** Finance is intentionally excluded from operational receipt/line normalization. */
export function receiptFinance(body:string,shopId:string,expectedReceiptId:string):ReceiptFinanceEvidence{
 const raw=z.object({receipt_id:identity}).passthrough().parse(parseEtsyJson(body));
 if(raw.receipt_id!==etsyId.parse(expectedReceiptId))throw new Error("FINANCE_RECEIPT_MISMATCH");
 const base={contract:"etsy-receipt-finance/v1" as const,shopId:etsyId.parse(shopId),receiptId:raw.receipt_id};
 const a=timestamp.safeParse(raw.updated_timestamp??raw.update_timestamp);
 const aliasesAgree=raw.updated_timestamp==null||raw.update_timestamp==null||raw.updated_timestamp===raw.update_timestamp;
 const refundPresent=Array.isArray(raw.refunds)&&raw.refunds.length>0||typeof raw.status==="string"&&/refund/i.test(raw.status);
 const metadata={...base,sourceUpdatedAt:a.success&&aliasesAgree?a.data:null,refundPresent};
 if(raw.grandtotal==null)return {...metadata,state:"MISSING"};
 const parsed=receiptMoneySchema.safeParse(raw.grandtotal);
 if(!parsed.success)return {...metadata,state:"INVALID"};
 // Unknown refund evidence, unsettled receipts and missing timestamps never prove original totals.
 if(metadata.sourceUpdatedAt===null||!Array.isArray(raw.refunds)||refundPresent||raw.is_paid!==true||typeof raw.status!=="string"||!["paid","completed"].includes(raw.status.toLowerCase()))return {...metadata,state:"UNCERTAIN"};
 return {...metadata,state:"VERIFIED",total:{amount:parsed.data.amount,divisor:parsed.data.divisor,currency:parsed.data.currency_code}};
}
