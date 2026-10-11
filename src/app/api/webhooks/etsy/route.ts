import {database} from "@/db/client";
import {handleEtsyWebhook} from "@/modules/etsy/webhook-receiver";
import {acceptVerifiedWebhook} from "@/modules/etsy/webhook-intake";

export const runtime="nodejs";
export async function POST(request:Request) {
  return handleEtsyWebhook(request,{
    secret:process.env.ETSY_WEBHOOK_SIGNING_SECRET,
    accept:event=>acceptVerifiedWebhook(database(),event),
  });
}
