import {z} from "zod";
const exactInteger=z.union([z.number().int().nonnegative().safe().transform(String),z.string().regex(/^(?:0|[1-9]\d{0,18})$/)]).pipe(z.string().refine(v=>BigInt(v)<=9223372036854775807n));
export function divisorPrecision(value:string){
 if(typeof value!=="string"||!/^(?:0|[1-9]\d{0,18})$/.test(value))return null;
 let d=BigInt(value),twos=0,fives=0;if(d<1n||d>1000000000n)return null;
 while(d%2n===0n){d/=2n;twos++;}while(d%5n===0n){d/=5n;fives++;}
 return d===1n&&Math.max(twos,fives)<=9?Math.max(twos,fives):null;
}
export const receiptMoneySchema=z.object({amount:exactInteger,divisor:exactInteger.refine(v=>divisorPrecision(v)!==null),currency_code:z.string().regex(/^[A-Z]{3}$/)}).strict();
export type ExactMoney={amount:string;divisor:string;currency:string};
/** Format exact integer/rational source values without converting money to Number. */
export function formatReceiptMoney(money:ExactMoney,locale="en-US"){
 const checked=receiptMoneySchema.parse({amount:money.amount,divisor:money.divisor,currency_code:money.currency});
 const precision=divisorPrecision(checked.divisor)!,amount=BigInt(checked.amount),divisor=BigInt(checked.divisor);
 const number=new Intl.NumberFormat(locale,{maximumFractionDigits:0});
 const whole=number.format(amount/divisor);
 const fraction=((amount%divisor)*(10n**BigInt(precision)/divisor)).toString().padStart(precision,"0");
 const separator=new Intl.NumberFormat(locale).formatToParts(1.1).find(p=>p.type==="decimal")?.value??".";
 const localizedFraction=[...fraction].map(d=>new Intl.NumberFormat(locale,{useGrouping:false}).format(BigInt(d))).join("");
 return `${whole}${precision?separator+localizedFraction:""} ${checked.currency_code}`;
}
export type OrderFinanceView={state:"VERIFIED";total:ExactMoney}|{state:"UNAVAILABLE"};
