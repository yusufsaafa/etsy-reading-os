import { createHash } from "node:crypto";

export function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export class RenderResourceError extends Error {
 constructor(readonly code: string, cause?: unknown) { super(code, { cause }); }
}
/** Typed arrays cannot be deeply frozen. Never expose the retained backing buffer. */
export type VerifiedBytes = Readonly<{ copyBytes(): Uint8Array }>;
export function retainedBytes(input: Uint8Array): VerifiedBytes {
 const privateBytes = Uint8Array.from(input);
 return Object.freeze({ copyBytes: () => Uint8Array.from(privateBytes) });
}
export const RESOURCE_LIMITS = Object.freeze({
 fontBytes: 2 * 1024 * 1024, imageBytes: 25 * 1024 * 1024,
 imageDimension: 8192, imagePixels: 16000000, aggregatePixels: 32000000,
 aggregateBytes: 64 * 1024 * 1024, fonts: 6, images: 10,
});
