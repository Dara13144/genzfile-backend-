import express from 'express';
import fs from 'fs';
import path from 'path';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { db } from '../services/db.js';
import { storageService, isSupabaseStorage } from '../services/storage.js';
import { setSafeFileHeaders, sanitizeFilename } from '../utils/security.js';
import { config } from '../config/index.js';

const router = express.Router();

// GET /api/files - List authenticated user's files
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      folder_id,
      category,
      search,
      sort,
      trash,
      page = 1,
      limit = 50,
    } = req.query;

    const isTrash = trash === 'true' || trash === '1';
    const result = await db.listUserFiles(req.user.id, {
      folderId: folder_id,
      category,
      search,
      sort,
      isTrash,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

    // Enrich files with share link tokens
    const enriched = await Promise.all(
      result.files.map(async (file) => {
        const shareLinks = await db.getShareLinksByFile(file.id, req.user.id);
        const activeLink = shareLinks.find(l => l.is_active);
        return {
          ...file,
          shareToken: activeLink ? activeLink.public_token : null,
          shareUrl: activeLink ? `/f/${activeLink.public_token}` : null,
          viewUrl: activeLink ? `/view/${activeLink.public_token}` : null,
          downloadUrl: activeLink ? `/download/${activeLink.public_token}` : null,
          directUrl: `/api/files/stream/${encodeURIComponent(file.storage_key)}`,
          thumbnailUrl: file.thumbnail_storage_key ? `/api/files/stream/${encodeURIComponent(file.thumbnail_storage_key)}` : null,
        };
      })
    );

    return res.json({
      success: true,
      files: enriched,
      total: result.total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/:id - Get single file details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    if (file.owner_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Access denied to this file.' });
    }

    const shareLinks = await db.getShareLinksByFile(file.id, file.owner_id);
    const activeLink = shareLinks.find(l => l.is_active);

    return res.json({
      success: true,
      file: {
        ...file,
        shareLinks,
        activeShareToken: activeLink ? activeLink.public_token : null,
        shareUrl: activeLink ? `/f/${activeLink.public_token}` : null,
        viewUrl: activeLink ? `/view/${activeLink.public_token}` : null,
        downloadUrl: activeLink ? `/download/${activeLink.public_token}` : null,
        directUrl: `/api/files/stream/${encodeURIComponent(file.storage_key)}`,
        thumbnailUrl: file.thumbnail_storage_key ? `/api/files/stream/${encodeURIComponent(file.thumbnail_storage_key)}` : null,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/files/:id - Update file (rename, edit description, move folder, change visibility)
router.patch('/:id', authenticateToken, validate(schemas.updateFile), async (req, res) => {
  try {
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    if (file.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const updates = {};
    if (req.body.original_filename) {
      updates.original_filename = sanitizeFilename(req.body.original_filename);
    }
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.folder_id !== undefined) {
      updates.folder_id = req.body.folder_id === 'root' ? null : req.body.folder_id;
    }
    if (req.body.visibility !== undefined) updates.visibility = req.body.visibility;

    const updated = await db.updateFile(file.id, updates);
    return res.json({
      success: true,
      message: 'File updated successfully',
      file: updated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/files/trash/empty - Empty all trashed files and purge from storage
router.delete('/trash/empty', optionalAuth, async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const trashedFiles = await db.emptyTrash(ownerId);

    // Purge physical files from storage
    for (const file of trashedFiles) {
      try {
        if (file.storage_key) await storageService.deleteFile(file.storage_key);
        if (file.thumbnail_storage_key) await storageService.deleteFile(file.thumbnail_storage_key);
      } catch (err) {
        console.warn(`[EmptyTrash] Failed to delete storage for ${file.id}:`, err.message);
      }
    }

    return res.json({
      success: true,
      message: `Trash emptied. ${trashedFiles.length} file(s) permanently removed.`,
      count: trashedFiles.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/files/:id - Soft-delete (move to trash)
router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    const isOwner = file.owner_id === ownerId || (req.user && req.user.role === 'admin');
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Permission denied.' });
    }

    const success = await db.softDeleteFile(req.params.id, file.owner_id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'File not found or permission denied.' });
    }
    await db.recordFileEvent(req.params.id, ownerId, 'delete');
    return res.json({ success: true, message: 'File moved to trash.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/bulk-delete - Bulk soft-delete
router.post('/bulk-delete', optionalAuth, validate(schemas.bulkDelete), async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const count = await db.bulkDeleteFiles(req.body.file_ids, ownerId);
    return res.json({
      success: true,
      message: `${count} file(s) moved to trash.`,
      count,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/:id/restore - Restore file from trash
router.post('/:id/restore', optionalAuth, async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const success = await db.restoreFile(req.params.id, ownerId);
    if (!success) {
      return res.status(404).json({ success: false, error: 'File not found in trash.' });
    }
    await db.recordFileEvent(req.params.id, ownerId, 'restore');
    return res.json({ success: true, message: 'File restored successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/files/:id/permanent - Permanently delete file and purge from storage
router.delete('/:id/permanent', optionalAuth, async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    const isOwner = file.owner_id === ownerId || (req.user && req.user.role === 'admin');
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Permission denied.' });
    }

    // Delete from storage
    if (file.storage_key) await storageService.deleteFile(file.storage_key);
    if (file.thumbnail_storage_key) {
      await storageService.deleteFile(file.thumbnail_storage_key);
    }

    // Delete record from DB
    await db.permanentDeleteFile(file.id, file.owner_id);

    return res.json({ success: true, message: 'File permanently deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/:id/download - Direct download for owner
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }
    if (file.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

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

// GET /api/files/stream/:storageKey - Safe streaming with Range support for video seeking
router.get('/stream/:storageKey', async (req, res) => {
  try {
    const storageKey = decodeURIComponent(req.params.storageKey);
    // Sanitize path
    if (storageKey.includes('..')) {
      return res.status(400).send('Invalid key');
    }

    if (isSupabaseStorage) {
      const signedUrl = await storageService.getSignedUrl(storageKey, 3600);
      return res.redirect(signedUrl);
    }

    const filePath = path.join(path.resolve(config.uploads.uploadDir), storageKey.replace(/\\/g, '/').split('/').filter(Boolean).join(path.sep));
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Determine mime type
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (['.jpg', '.jpeg'].includes(ext)) mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.svg') mimeType = 'image/svg+xml';
    else if (ext === '.mp4') mimeType = 'video/mp4';
    else if (ext === '.webm') mimeType = 'video/webm';
    else if (ext === '.pdf') mimeType = 'application/pdf';

    setSafeFileHeaders(res, mimeType, path.basename(filePath), true);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    return res.status(500).send('Error streaming media: ' + err.message);
  }
});

export default router;
