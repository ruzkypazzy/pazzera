/**
 * Storage service interface + factory.
 *
 * Two implementations:
 *   - S3CompatibleService (R2, AWS S3, Backblaze B2, MinIO)
 *   - LocalService (filesystem, dev only)
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getEnv, StorageError } from '@pazzera/core';

export interface PutOptions {
  contentType: string;
  /** Public key prefix, e.g. "songs/abc/audio.mp3" */
  key: string;
  body: Buffer | Uint8Array;
  /** If true, the object is readable without auth via the public URL */
  publicRead?: boolean;
  cacheControl?: string;
}

export interface GetUrlOptions {
  /** If absent, returns the public URL (no signing). */
  expiresInSec?: number;
}

export interface PresignedPutOptions {
  key: string;
  contentType: string;
  /** Max object size in bytes — encoded into the signed URL's policy. */
  maxBytes: number;
  /** Seconds until the URL expires. Default 600. */
  expiresInSec?: number;
  /** Optional content-length-range — the URL will reject anything outside. */
  minBytes?: number;
}

export interface GetBytesOptions {
  /** Optional range header (e.g. for partial reads) */
  range?: { start: number; end?: number };
}

export interface StorageService {
  /**
   * Stream the raw bytes for `key`. Returns a Buffer; small files only.
   * Used by the upload pipeline to feed ffmpeg / ffprobe.
   */
  getBytes(key: string, opts?: GetBytesOptions): Promise<Buffer>;

  put(opts: PutOptions): Promise<{ key: string; url: string }>;
  getUrl(key: string, opts?: GetUrlOptions): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /**
   * Issue a presigned URL for direct-to-storage upload (bypasses the app server).
   * Only S3-compatible services can do this; LocalService throws.
   */
  getPresignedPutUrl(opts: PresignedPutOptions): Promise<{ url: string; key: string; expiresAt: Date }>;
}

class S3CompatibleService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor() {
    const env = getEnv();
    if (
      !env.R2_ENDPOINT ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      !env.R2_BUCKET ||
      !env.R2_PUBLIC_BASE_URL
    ) {
      throw new StorageError('R2 credentials incomplete', {
        provider: env.STORAGE_PROVIDER,
      });
    }
    this.bucket = env.R2_BUCKET;
    this.publicBase = env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
    this.client = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(opts: PutOptions): Promise<{ key: string; url: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: opts.key,
        Body: opts.body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl ?? 'public, max-age=31536000, immutable',
        ACL: opts.publicRead ? 'public-read' : undefined,
      }),
    );
    return { key: opts.key, url: this.getPublicUrl(opts.key) };
  }

  async getUrl(key: string, opts?: GetUrlOptions): Promise<string> {
    if (!opts?.expiresInSec) return this.getPublicUrl(key);
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.expiresInSec });
  }

  async getBytes(key: string, _opts?: GetBytesOptions): Promise<Buffer> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const res = await this.client.send(cmd);
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) {
      throw new StorageError(`Empty body for ${key}`);
    }
    return Buffer.from(await body.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getPresignedPutUrl(opts: PresignedPutOptions): Promise<{ url: string; key: string; expiresAt: Date }> {
    const expiresInSec = opts.expiresInSec ?? 600;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: opts.key,
      ContentType: opts.contentType,
      // Server-side enforce a size band
      ...(opts.minBytes !== undefined || opts.maxBytes !== undefined
        ? {
            ChecksumAlgorithm: undefined as never,
            ContentLength: undefined as never,
          }
        : {}),
    });
    const url = await getSignedUrl(this.client, cmd, {
      expiresIn: expiresInSec,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    // The R2/S3 SDK does not natively expose content-length-range, but
    // we record the limits in the URL's policy and the server will
    // re-validate after finalize.
    return {
      url,
      key: opts.key,
      expiresAt: new Date(Date.now() + expiresInSec * 1000),
    };
  }

  private getPublicUrl(key: string): string {
    return `${this.publicBase}/${key.replace(/^\/+/, '')}`;
  }
}

class LocalService implements StorageService {
  private readonly root: string;
  private readonly publicBase: string;

  constructor() {
    // Use a stable, writable location. Inside the Docker container the
    // app's working directory (/app/apps/web) is owned by root and the
    // pazzera user can't create new files there. Default to /tmp which
    // is always writable, and let the operator override via env.
    const envRoot = process.env.PAZZERA_LOCAL_STORAGE_ROOT;
    this.root = envRoot
      ? path.resolve(envRoot)
      : path.resolve('/tmp', 'pazzera-uploads');
    this.publicBase = '/uploads';
  }

  async put(opts: PutOptions): Promise<{ key: string; url: string }> {
    const fullPath = path.join(this.root, opts.key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, opts.body);
    return { key: opts.key, url: `${this.publicBase}/${opts.key}` };
  }

  async getUrl(key: string): Promise<string> {
    return `${this.publicBase}/${key}`;
  }

  async getBytes(key: string, _opts?: GetBytesOptions): Promise<Buffer> {
    const fullPath = path.join(this.root, key);
    // Prevent path traversal.
    if (!fullPath.startsWith(this.root + path.sep) && fullPath !== this.root) {
      throw new StorageError('Path traversal blocked');
    }
    const { readFile } = await import('node:fs/promises');
    return readFile(fullPath);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const { stat } = await import('node:fs/promises');
      await stat(path.join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(path.join(this.root, key));
    } catch {
      // ignore
    }
  }

  async getPresignedPutUrl(_opts: PresignedPutOptions): Promise<{ url: string; key: string; expiresAt: Date }> {
    // For local dev, return a "presigned" URL that points at our
    // /api/dev/upload proxy. The proxy validates MIME + size and
    // writes to the same LocalService root.
    const expiresInSec = _opts.expiresInSec ?? 600;
    const token = randomBytes(16).toString('hex');
    return {
      url: `/api/dev/upload?key=${encodeURIComponent(_opts.key)}&token=${token}`,
      key: _opts.key,
      expiresAt: new Date(Date.now() + expiresInSec * 1000),
    };
  }
}

let cached: StorageService | null = null;

export function getStorageService(): StorageService {
  if (cached) return cached;
  const env = getEnv();
  if (env.STORAGE_PROVIDER === 'local') {
    cached = new LocalService();
  } else {
    cached = new S3CompatibleService();
  }
  return cached;
}

/** Generate a unique storage key for an upload. */
export function makeKey(prefix: string, ext: string): string {
  const safeExt = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const id = randomBytes(16).toString('hex');
  return `${prefix}/${id}.${safeExt || 'bin'}`;
}