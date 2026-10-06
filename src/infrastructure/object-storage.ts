// No object-store implementation is necessary for intake. Domains depend on this port later.
export interface PrivateObjectStorage {
  put(input: { organizationId: string; key: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  get(input: { organizationId: string; key: string }): Promise<Uint8Array>;
  remove(input: { organizationId: string; key: string }): Promise<void>;
}

/** Platform namespace in the same S3-compatible storage architecture. No tenant fiction,
 * URL resolution, upload flow or provider implementation. Implementations read exact keys. */
export interface PlatformAssetStorage {
  read(input: Readonly<{ objectKey: string }>): Promise<Uint8Array>;
}
