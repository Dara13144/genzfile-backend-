import express from 'express';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { db } from '../services/db.js';
import { storageService, isSupabaseStorage } from '../services/storage.js';
import {
  generatePublicToken,
  hashPassword,
  verifyPassword,
  setSafeFileHeaders,
} from '../utils/security.js';

const router = express.Router();

// POST /api/files/:id/share - Create or regenerate shareable link
router.post('/files/:id/share', authenticateToken, validate(schemas.createShareLink), async (req, res) => {
  try {
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    if (file.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const { password, expires_in_hours, max_downloads } = req.body;
    const publicToken = generatePublicToken();
    let passwordHash = null;

    if (password) {
      passwordHash = await hashPassword(password);
    }

    let expiresAt = null;
    if (expires_in_hours) {
      expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000).toISOString();
    }

    const shareLink = await db.createShareLink({
      file_id: file.id,
      owner_id: req.user.id,
      public_token: publicToken,
      password_hash: passwordHash,
      expires_at: expiresAt,
      max_downloads: max_downloads || null,
    });

    await db.recordFileEvent(file.id, req.user.id, 'share_create');

    return res.status(201).json({
      success: true,
      message: 'Share link created successfully',
      shareLink: {
        ...shareLink,
        isPasswordProtected: Boolean(passwordHash),
        shareUrl: `/f/${publicToken}`,
        viewUrl: `/view/${publicToken}`,
        downloadUrl: `/download/${publicToken}`,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/share/:token - Public shared file view endpoint
router.get('/share/:token', optionalAuth, async (req, res) => {
  try {
    const shareLink = await db.getShareLinkByToken(req.params.token);
    if (!shareLink) {
      return res.status(404).json({ success: false, error: 'Share link not found or inactive.' });
    }

    // Check expiration
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'This share link has expired.' });
    }

    // Check max downloads
    if (shareLink.max_downloads && shareLink.download_count >= shareLink.max_downloads) {
      return res.status(410).json({ success: false, error: 'Download limit for this link has been reached.' });
    }

    const file = await db.getFileById(shareLink.file_id);
    if (!file || file.deleted_at !== null) {
      return res.status(404).json({ success: false, error: 'Shared file has been removed.' });
    }

    // Check if password required
    const isOwner = req.user && req.user.id === shareLink.owner_id;
    const isPasswordProtected = Boolean(shareLink.password_hash);

    // If protected and not owner, check header or query password token
    const clientProvidedToken = req.headers['x-share-auth'];
    const hasAccess = isOwner || !isPasswordProtected || (clientProvidedToken === `verified-${shareLink.public_token}`);

    if (!hasAccess) {
      return res.json({
        success: true,
        passwordRequired: true,
        file: {
          original_filename: file.original_filename,
          file_category: file.file_category,
          file_size_bytes: file.file_size_bytes,
        }
      });
    }

    // Record view event
    await db.recordFileEvent(file.id, req.user?.id || null, 'view', req.ip, req.headers['user-agent']);

    return res.json({
      success: true,
      passwordRequired: false,
      shareLink: {
        id: shareLink.id,
        publicToken: shareLink.public_token,
        downloadCount: shareLink.download_count,
        maxDownloads: shareLink.max_downloads,
        expiresAt: shareLink.expires_at,
        isPasswordProtected,
      },
      file: {
        id: file.id,
        original_filename: file.original_filename,
        mime_type: file.mime_type,
        file_size_bytes: file.file_size_bytes,
        file_category: file.file_category,
        description: file.description,
        width: file.width,
        height: file.height,
        duration_seconds: file.duration_seconds,
        checksum: file.checksum,
        created_at: file.created_at,
        directUrl: `/api/files/stream/${encodeURIComponent(file.storage_key)}`,
        thumbnailUrl: file.thumbnail_storage_key ? `/api/files/stream/${encodeURIComponent(file.thumbnail_storage_key)}` : null,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/share/:token/verify-password - Unlock password-protected link
router.post('/share/:token/verify-password', validate(schemas.verifySharePassword), async (req, res) => {
  try {
    const shareLink = await db.getShareLinkByToken(req.params.token);
    if (!shareLink) {
      return res.status(404).json({ success: false, error: 'Share link not found.' });
    }

    const isValid = await verifyPassword(req.body.password, shareLink.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }

    return res.json({
      success: true,
      message: 'Password verified',
      authCode: `verified-${shareLink.public_token}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/share/:id - Update link settings
router.patch('/share/:id', authenticateToken, async (req, res) => {
  try {
    const updated = await db.updateShareLink(req.params.id, req.user.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Share link not found.' });
    }
    return res.json({ success: true, message: 'Share link updated', shareLink: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/share/:id - Revoke share link
router.delete('/share/:id', authenticateToken, async (req, res) => {
  try {
    const success = await db.deleteShareLink(req.params.id, req.user.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Share link not found.' });
    }
    return res.json({ success: true, message: 'Share link revoked successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/share/:token/download - Public download endpoint
router.get('/share/:token/download', optionalAuth, async (req, res) => {
  try {
    const shareLink = await db.getShareLinkByToken(req.params.token);
    if (!shareLink) {
      return res.status(404).json({ success: false, error: 'Share link expired or not found.' });
    }

    // Expiry check
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Share link has expired.' });
    }

    // Download limit check
    if (shareLink.max_downloads && shareLink.download_count >= shareLink.max_downloads) {
      return res.status(410).json({ success: false, error: 'Download limit has been reached.' });
    }

    // Check password if required
    const isOwner = req.user && req.user.id === shareLink.owner_id;
    if (shareLink.password_hash && !isOwner) {
      const authHeader = req.headers['x-share-auth'] || req.query.auth;
      if (authHeader !== `verified-${shareLink.public_token}`) {
        return res.status(401).json({ success: false, error: 'Password required to download this file.' });
      }
    }

    const file = await db.getFileById(shareLink.file_id);
    if (!file || file.deleted_at !== null) {
      return res.status(404).json({ success: false, error: 'File is no longer available.' });
    }

    // Increment download count and record event
    await db.incrementShareDownload(shareLink.id);
    await db.recordFileEvent(file.id, req.user?.id || null, 'download', req.ip, req.headers['user-agent']);

    setSafeFileHeaders(res, file.mime_type, file.original_filename, false);

    if (isSupabaseStorage) {
      const signedUrl = await storageService.getSignedUrl(file.storage_key, 300, file.original_filename);
      return res.redirect(signedUrl);
    }

    const stream = storageService.createReadStream(file.storage_key);
    stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
