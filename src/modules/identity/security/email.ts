export type EmailMessage = { to: string; code: string; purpose: "verify" | "reset"; identity: string };
export interface EmailTransport { send(message: EmailMessage): Promise<void> }
export function transactionalEmail(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const key = env.RESEND_API_KEY, from = env.EMAIL_FROM;
  if (env.EMAIL_PROVIDER !== "resend" || !key || !from || /[\r\n]/.test(from)) throw new Error("EMAIL_UNAVAILABLE");
  return { async send(message) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": message.identity },
      body: JSON.stringify({ from, to: [message.to], subject: message.purpose === "verify" ? "Verify your Reading OS email" : "Reset your Reading OS password", text: `Your Reading OS ${message.purpose === "verify" ? "verification" : "password reset"} code is ${message.code}. It expires in 10 minutes. If you did not request this, ignore this email.` }),
    });
    if (!response.ok) throw new Error("EMAIL_UNAVAILABLE");
    await response.body?.cancel();
  } };
}
