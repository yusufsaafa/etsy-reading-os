import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {openReadingReview,ReviewUnavailable} from "@/modules/review/service";
import {ReviewReading} from "@/components/review-reading";
export default async function ReviewPage({params}:{params:Promise<{id:string;readingId:string}>}) {
 const {id,readingId}=await params,scope=await currentScope();
 let reading;
 try{reading=await openReadingReview(database(),scope,id,readingId);}catch(error){if(error instanceof ReviewUnavailable)notFound();throw error;}
 return <><Link className="back-link" href={`/orders/${id}`}>← Order</Link><ReviewReading reading={reading}/></>;
}
