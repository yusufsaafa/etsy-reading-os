// No object-store implementation is necessary for intake. Domains depend on this port later.
export interface PrivateObjectStorage {
  put(input: { organizationId: string; key: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  get(input: { organizationId: string; key: string }): Promise<Uint8Array>;
  remove(input: { organizationId: string; key: string }): Promise<void>;
}

/** Platform namespace in the same S3-compatible storage architecture. No tenant fiction,
 * URL resolution, upload flow or provider implementation. Implementations read exact keys. */
export interface PlatformAssetStorage {
  /** Adapter must stop reading once maxBytes is exceeded, before buffering an unbounded object. */
  read(input: Readonly<{ objectKey: string; maxBytes: number }>): Promise<Uint8Array>;
}

/** Same private object-store architecture, stronger capability for production evidence.
 * Adapters MUST use atomic conditional creation, never HEAD followed by overwriting PUT.
 * Ambiguous writes may be retried with identical evidence. Conflicts must fail closed.
 */
export interface ImmutableArtifactStorage {
  putImmutable(input: Readonly<{organizationId:string; objectKey:string; bytes:Uint8Array;
    contentType:"application/pdf"; sha256:string; byteLength:number}>): Promise<void>;
  /** Enforce maxBytes while reading, before buffering. Return exact key/MIME evidence. */
  read(input: Readonly<{organizationId:string; objectKey:string; maxBytes:number}>):
    Promise<Readonly<{objectKey:string; contentType:string; bytes:Uint8Array}>>;
}
export class ArtifactStorageError extends Error {
  constructor(readonly code:"UNAVAILABLE"|"MISSING"|"CONFLICT"|"INTEGRITY"|"LIMIT"){super(code);}
}
