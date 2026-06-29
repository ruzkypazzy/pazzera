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
import { randomUUID } from 'node:crypto';
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

export interface StorageService {
  put(opts: PutOptions): Promise<{ key: string; url: string }>;
  getUrl(key: string, opts?: GetUrlOptions): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
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

  private getPublicUrl(key: string): string {
    return `${this.publicBase}/${key.replace(/^\/+/, '')}`;
  }
}

class LocalService implements StorageService {
  private readonly root: string;
  private readonly publicBase: string;

  constructor() {
    this.root = path.resolve(process.cwd(), 'tmp', 'uploads');
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
  const id = randomUUID();
  return `${prefix}/${id}.${safeExt}`;
}