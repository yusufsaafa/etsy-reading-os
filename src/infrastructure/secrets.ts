import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface SecretVault { seal(value: string, context: string): string; open(envelope: string, context: string): string }
export class LocalEncryptedVault implements SecretVault {
  private readonly key: Buffer;
  constructor(key: string, private readonly keyId = "local-v1") {
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY must encode 32 bytes");
  }
  seal(value: string, context: string) {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`${this.keyId}:${context}`));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({ version: 1, keyId: this.keyId, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  }
  open(envelope: string, context: string) {
    const data = JSON.parse(envelope);
    if (data.version !== 1 || data.keyId !== this.keyId) throw new Error("Unsupported secret key");
    const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(data.nonce, "base64"));
    cipher.setAAD(Buffer.from(`${this.keyId}:${context}`)); cipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return Buffer.concat([cipher.update(Buffer.from(data.ciphertext, "base64")), cipher.final()]).toString("utf8");
  }
}
export function vault(): SecretVault {
  if (!process.env.SECRET_ENCRYPTION_KEY) throw new Error("Secret storage is not configured");
  return new LocalEncryptedVault(process.env.SECRET_ENCRYPTION_KEY, process.env.SECRET_KEY_ID);
}
