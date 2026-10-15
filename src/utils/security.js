import crypto from 'crypto';
import path from 'path';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

export function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'unnamed_file';
  }
  // Strip null bytes and control chars
  let cleaned = originalName.replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, '_');
  // Strip path traversal sequences
  cleaned = cleaned.replace(/\.\.+/g, '.');
  const parsed = path.parse(cleaned);
  let name = parsed.name.trim() || 'file';
  let ext = parsed.ext.toLowerCase();
  
  // Truncate to reasonable length (max 120 chars)
  if (name.length > 100) {
    name = name.substring(0, 100);
  }
  return `${name}${ext}`;
}

export function calculateChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function generateStorageKey(ownerId, originalFilename) {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalFilename).toLowerCase();
  return `${ownerId}/${timestamp}_${randomBytes}${ext}`;
}

export function generatePublicToken() {
  return crypto.randomBytes(12).toString('base64url');
}

export function determineCategory(mimeType, filename = '') {
  const ext = path.extname(filename).toLowerCase();

  for (const [category, mimeList] of Object.entries(config.mimeCategories)) {
    if (mimeList.includes(mimeType)) {
      return category;
    }
  }

  // Fallback by extension
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) {
    return 'image';
  }
  if (['.mp4', '.webm', '.mov', '.avi', '.mkv', '.wmv'].includes(ext)) {
    return 'video';
  }
  if (['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'].includes(ext)) {
    return 'document';
  }
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return 'archive';
  }
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(ext)) {
    return 'audio';
  }

  return 'other';
}

export async function hashPassword(plainPassword) {
  if (!plainPassword) return null;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

export async function verifyPassword(plainPassword, hash) {
  if (!hash) return true; // Link is not password protected
  if (!plainPassword) return false;
  return bcrypt.compare(plainPassword, hash);
}

export function setSafeFileHeaders(res, mimeType, filename, inline = false) {
  const isSvg = mimeType === 'image/svg+xml';
  const isHtml = mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
  
  if (isSvg || isHtml) {
    // Prevent execution of scripts inside uploaded SVGs or HTML files
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  const dispositionType = inline && !isHtml ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
}
