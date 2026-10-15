import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

class SupabaseStorageAdapter {
  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    });
    this.bucket = config.supabase.bucket;
  }

  async uploadFile(buffer, storageKey, mimeType) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
    return { path: data.path, storageKey };
  }

  async getSignedUrl(storageKey, expiresInSeconds = 3600, downloadFilename = null) {
    const options = { expiresIn: expiresInSeconds };
    if (downloadFilename) {
      options.download = downloadFilename;
    }
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, expiresInSeconds, options);

    if (error) {
      throw new Error(`Supabase signed URL failed: ${error.message}`);
    }
    return data.signedUrl;
  }

  async deleteFile(storageKey) {
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([storageKey]);

    if (error) {
      console.warn(`[SupabaseStorage] Delete warning for ${storageKey}:`, error.message);
    }
    return true;
  }

  async getStream(storageKey) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(storageKey);

    if (error) {
      throw new Error(`Supabase download failed: ${error.message}`);
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

class LocalStorageAdapter {
  constructor() {
    this.baseDir = path.resolve(config.uploads.uploadDir);
    this.thumbnailsDir = path.resolve(this.baseDir, 'thumbnails');

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }
  }

  _resolvePath(storageKey) {
    // Sanitize to prevent path traversal
    const safeKey = storageKey.replace(/\\/g, '/').split('/').filter(Boolean).join(path.sep);
    return path.join(this.baseDir, safeKey);
  }

  async uploadFile(buffer, storageKey, mimeType) {
    const filePath = this._resolvePath(storageKey);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(filePath, buffer);
    return { path: filePath, storageKey };
  }

  async getSignedUrl(storageKey, expiresInSeconds = 3600, downloadFilename = null) {
    // Return direct application streaming URL
    const query = new URLSearchParams();
    if (downloadFilename) query.set('filename', downloadFilename);
    return `/api/files/stream/${encodeURIComponent(storageKey)}?${query.toString()}`;
  }

  async deleteFile(storageKey) {
    try {
      const filePath = this._resolvePath(storageKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      console.warn(`[LocalStorage] Delete error for ${storageKey}:`, err.message);
    }
    return true;
  }

  async getStream(storageKey) {
    const filePath = this._resolvePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on storage');
    }
    return fs.promises.readFile(filePath);
  }

  createReadStream(storageKey) {
    const filePath = this._resolvePath(storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on storage');
    }
    return fs.createReadStream(filePath);
  }
}

// Select active storage adapter
export const storageService = config.supabase.isConfigured
  ? new SupabaseStorageAdapter()
  : new LocalStorageAdapter();

export const isSupabaseStorage = config.supabase.isConfigured;
