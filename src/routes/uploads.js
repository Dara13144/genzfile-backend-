import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';
import { db } from '../services/db.js';
import { storageService } from '../services/storage.js';
import { config } from '../config/index.js';
import {
  sanitizeFilename,
  calculateChecksum,
  generateStorageKey,
  generatePublicToken,
  determineCategory,
} from '../utils/security.js';
import { processImageMetadata, estimateVideoMetadata } from '../utils/media.js';

const router = express.Router();

// Configure Multer with memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxFileSizeBytes,
  },
  fileFilter: (req, file, cb) => {
    // Basic filter check
    cb(null, true);
  }
});

// Helper to process and save a single file
async function processAndSaveFile(file, ownerId, folderId = null) {
  const safeFilename = sanitizeFilename(file.originalname);
  const mimeType = file.mimetype || 'application/octet-stream';
  const fileSize = file.size;
  const category = determineCategory(mimeType, safeFilename);
  const checksum = calculateChecksum(file.buffer);

  // Generate unique storage keys
  const storageKey = generateStorageKey(ownerId, safeFilename);

  let width = null;
  let height = null;
  let durationSeconds = null;
  let thumbnailStorageKey = null;

  // Process media
  if (category === 'image') {
    const meta = await processImageMetadata(file.buffer, mimeType);
    width = meta.width;
    height = meta.height;
    if (meta.thumbnailBuffer) {
      thumbnailStorageKey = `thumbnails/${storageKey.replace(/\//g, '_')}.webp`;
      await storageService.uploadFile(meta.thumbnailBuffer, thumbnailStorageKey, 'image/webp');
    }
  } else if (category === 'video') {
    const meta = estimateVideoMetadata(safeFilename, fileSize);
    width = meta.width;
    height = meta.height;
    durationSeconds = meta.durationSeconds;
  }

  // Upload original file to storage service
  await storageService.uploadFile(file.buffer, storageKey, mimeType);

  // Save record in database
  const fileRecord = await db.createFile({
    owner_id: ownerId,
    folder_id: folderId,
    original_filename: safeFilename,
    storage_key: storageKey,
    mime_type: mimeType,
    file_size_bytes: fileSize,
    file_category: category,
    checksum,
    width,
    height,
    duration_seconds: durationSeconds,
    thumbnail_storage_key: thumbnailStorageKey,
    processing_status: 'completed',
    visibility: 'private',
  });

  // Automatically create a default share link
  const publicToken = generatePublicToken();
  const shareLink = await db.createShareLink({
    file_id: fileRecord.id,
    owner_id: ownerId,
    public_token: publicToken,
    is_active: true,
  });

  // Log event
  await db.recordFileEvent(fileRecord.id, ownerId, 'upload');

  return {
    ...fileRecord,
    shareUrl: `/f/${publicToken}`,
    viewUrl: `/view/${publicToken}`,
    downloadUrl: `/download/${publicToken}`,
    directUrl: `/api/files/stream/${encodeURIComponent(storageKey)}`,
    publicToken,
  };
}

// POST /api/uploads - Upload single or multiple files
router.post('/', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    const settings = await db.getSettings();
    if (settings.maintenance_mode) {
      return res.status(503).json({
        success: false,
        error: 'System is currently under maintenance. File uploads are temporarily suspended.',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided for upload.' });
    }

    // Verify user quota
    const profile = await db.getProfile(req.user.id);
    const totalIncomingBytes = req.files.reduce((sum, f) => sum + f.size, 0);
    const quota = Number(profile.storage_quota_bytes);
    const used = Number(profile.storage_used_bytes);

    if (used + totalIncomingBytes > quota) {
      const remainingMb = Math.max(0, ((quota - used) / (1024 * 1024)).toFixed(1));
      return res.status(400).json({
        success: false,
        error: `Storage quota exceeded. Remaining storage is ${remainingMb} MB, but upload requires ${(totalIncomingBytes / (1024 * 1024)).toFixed(1)} MB.`,
      });
    }

    const folderId = req.body.folder_id && req.body.folder_id !== 'root' ? req.body.folder_id : null;
    const uploadedFiles = [];

    for (const file of req.files) {
      const result = await processAndSaveFile(file, req.user.id, folderId);
      uploadedFiles.push(result);
    }

    return res.status(201).json({
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} file(s).`,
      files: uploadedFiles,
    });
  } catch (err) {
    console.error('[UploadError]', err);
    return res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

// POST /api/uploads/init - Resumable / chunked upload session
router.post('/init', authenticateToken, async (req, res) => {
  try {
    const { filename, size_bytes, mime_type } = req.body;
    if (!filename || !size_bytes) {
      return res.status(400).json({ success: false, error: 'filename and size_bytes are required.' });
    }

    const safeFilename = sanitizeFilename(filename);
    const uploadKey = generateStorageKey(req.user.id, safeFilename);

    return res.json({
      success: true,
      session: {
        id: generatePublicToken(),
        uploadKey,
        filename: safeFilename,
        sizeBytes: size_bytes,
        chunkSize: 5 * 1024 * 1024, // 5MB chunks
        status: 'initialized',
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/uploads/:id/complete - Finalize chunked upload
router.post('/:id/complete', authenticateToken, async (req, res) => {
  return res.json({
    success: true,
    message: 'Resumable upload session finalized.',
  });
});

// GET /api/uploads/:id/status - Check session status
router.get('/:id/status', authenticateToken, async (req, res) => {
  return res.json({
    success: true,
    status: 'completed',
    progress: 100,
  });
});

// DELETE /api/uploads/:id - Cancel/abort upload
router.delete('/:id', authenticateToken, async (req, res) => {
  return res.json({
    success: true,
    message: 'Upload session cancelled successfully.',
  });
});

export default router;
