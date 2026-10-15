import express from 'express';
import multer from 'multer';
import { optionalAuth } from '../middleware/auth.js';
import { db } from '../services/db.js';
import { storageService } from '../services/storage.js';
import { config } from '../config/index.js';
import {
  sanitizeFilename,
  calculateChecksum,
  generateStorageKey,
  generatePublicToken,
} from '../utils/security.js';
import { processImageMetadata } from '../utils/media.js';
import { convertVideoToGif, convertImagesToGif } from '../services/gifConverter.js';

const router = express.Router();

// Multer memory storage configuration (handles up to 100MB for video to gif)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 50,                   // up to 50 image frames
  },
});

// Helper to persist the converted GIF into storage & database
async function saveConvertedGif(gifResult, ownerId, originalName = 'converted.gif', folderId = null) {
  const safeFilename = sanitizeFilename(originalName.replace(/\.[^.]+$/, '') + '.gif');
  const storageKey = generateStorageKey(ownerId, safeFilename);
  const checksum = calculateChecksum(gifResult.buffer);

  // Generate WebP thumbnail from GIF first frame
  let thumbnailStorageKey = null;
  let width = null;
  let height = null;
  try {
    const meta = await processImageMetadata(gifResult.buffer, 'image/gif');
    width = meta.width;
    height = meta.height;
    if (meta.thumbnailBuffer) {
      thumbnailStorageKey = `thumbnails/${storageKey.replace(/\//g, '_')}.webp`;
      await storageService.uploadFile(meta.thumbnailBuffer, thumbnailStorageKey, 'image/webp');
    }
  } catch (thumbErr) {
    console.warn('[GifRoute] Thumbnail generation error:', thumbErr.message);
  }

  // Upload GIF to active storage driver (Local Disk or Supabase)
  await storageService.uploadFile(gifResult.buffer, storageKey, 'image/gif');

  // Create database file record
  const fileRecord = await db.createFile({
    owner_id: ownerId,
    folder_id: folderId,
    original_filename: safeFilename,
    storage_key: storageKey,
    mime_type: 'image/gif',
    file_size_bytes: gifResult.size,
    file_category: 'image',
    checksum,
    width,
    height,
    thumbnail_storage_key: thumbnailStorageKey,
    processing_status: 'completed',
    visibility: 'private',
  });

  // Create default public share link
  const publicToken = generatePublicToken();
  await db.createShareLink({
    file_id: fileRecord.id,
    owner_id: ownerId,
    public_token: publicToken,
    is_active: true,
  });

  // Record audit log
  await db.recordFileEvent(fileRecord.id, ownerId, 'convert_gif');

  return {
    ...fileRecord,
    publicToken,
    shareUrl: `/f/${publicToken}`,
    viewUrl: `/view/${publicToken}`,
    downloadUrl: `/download/${publicToken}`,
    directUrl: `/api/files/stream/${encodeURIComponent(storageKey)}`,
  };
}

/**
 * POST /api/gif/convert-video
 * Upload a video file or provide existing fileId to generate animated GIF
 */
router.post(
  '/convert-video',
  optionalAuth,
  upload.single('video'),
  async (req, res, next) => {
    try {
      const ownerId = req.user ? req.user.id : config.auth.guestUserId;
      const {
        startTime = 0,
        duration = 6,
        fps = 12,
        width = 480,
        fileId,
        folderId = null,
      } = req.body;

      let videoBuffer = null;
      let originalFilename = 'video_clip.gif';

      if (req.file) {
        videoBuffer = req.file.buffer;
        originalFilename = req.file.originalname;
      } else if (fileId) {
        const existingFile = await db.getFileById(fileId, ownerId);
        if (!existingFile) {
          return res.status(404).json({ success: false, error: 'Video file not found' });
        }
        videoBuffer = await storageService.getStream(existingFile.storage_key);
        originalFilename = existingFile.original_filename;
      } else {
        return res.status(400).json({ success: false, error: 'No video file or fileId provided' });
      }

      // Convert video to GIF via FFmpeg
      const gifResult = await convertVideoToGif(videoBuffer, {
        startTime: parseFloat(startTime) || 0,
        duration: parseFloat(duration) || 6,
        fps: parseInt(fps, 10) || 12,
        width: width === 'original' ? 'original' : parseInt(width, 10) || 480,
      });

      // Save output GIF to library
      const savedFile = await saveConvertedGif(
        gifResult,
        ownerId,
        `gif_${originalFilename}`,
        folderId !== 'root' ? folderId : null
      );

      res.status(201).json({
        success: true,
        message: 'Video successfully converted to GIF',
        file: savedFile,
      });
    } catch (err) {
      console.error('[GifRoute] Video to GIF conversion failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to convert video to GIF',
      });
    }
  }
);

/**
 * POST /api/gif/convert-images
 * Upload image files or provide existing image fileIds to generate animated GIF
 */
router.post(
  '/convert-images',
  optionalAuth,
  upload.array('images', 50),
  async (req, res, next) => {
    try {
      const ownerId = req.user ? req.user.id : config.auth.guestUserId;
      const {
        delay = 300,
        width = 480,
        fileIds,
        folderId = null,
      } = req.body;

      const imageBuffers = [];
      let baseFilename = 'image_sequence.gif';

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          imageBuffers.push(file.buffer);
        }
        baseFilename = req.files[0].originalname;
      } else if (fileIds) {
        const ids = Array.isArray(fileIds) ? fileIds : JSON.parse(fileIds);
        for (const id of ids) {
          const existingFile = await db.getFileById(id, ownerId);
          if (existingFile) {
            const buf = await storageService.getStream(existingFile.storage_key);
            imageBuffers.push(buf);
            baseFilename = existingFile.original_filename;
          }
        }
      }

      if (imageBuffers.length === 0) {
        return res.status(400).json({ success: false, error: 'No images provided for GIF creation' });
      }

      // Convert images to GIF
      const gifResult = await convertImagesToGif(imageBuffers, {
        delay: parseInt(delay, 10) || 300,
        width: parseInt(width, 10) || 480,
      });

      // Save output GIF to library
      const savedFile = await saveConvertedGif(
        gifResult,
        ownerId,
        `animated_${baseFilename}`,
        folderId !== 'root' ? folderId : null
      );

      res.status(201).json({
        success: true,
        message: 'Images successfully converted to animated GIF',
        file: savedFile,
      });
    } catch (err) {
      console.error('[GifRoute] Images to GIF conversion failed:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to convert images to GIF',
      });
    }
  }
);

/**
 * POST /api/gif/convert-file/:id
 * Quick convert any existing video or image file to GIF
 */
router.post('/convert-file/:id', optionalAuth, async (req, res) => {
  try {
    const ownerId = req.user ? req.user.id : config.auth.guestUserId;
    const fileId = req.params.id;
    const { startTime = 0, duration = 6, fps = 12, width = 480, delay = 300 } = req.body;

    const file = await db.getFileById(fileId, ownerId);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const fileBuffer = await storageService.getStream(file.storage_key);
    let gifResult = null;

    if (file.file_category === 'video') {
      gifResult = await convertVideoToGif(fileBuffer, {
        startTime: parseFloat(startTime) || 0,
        duration: parseFloat(duration) || 6,
        fps: parseInt(fps, 10) || 12,
        width: parseInt(width, 10) || 480,
      });
    } else if (file.file_category === 'image') {
      gifResult = await convertImagesToGif([fileBuffer], {
        delay: parseInt(delay, 10) || 300,
        width: parseInt(width, 10) || 480,
      });
    } else {
      return res.status(400).json({ success: false, error: 'Only video and image files can be converted to GIF' });
    }

    const savedFile = await saveConvertedGif(
      gifResult,
      ownerId,
      `gif_${file.original_filename}`,
      file.folder_id
    );

    res.status(201).json({
      success: true,
      message: 'File converted to GIF successfully',
      file: savedFile,
    });
  } catch (err) {
    console.error('[GifRoute] File to GIF failed:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Conversion failed',
    });
  }
});

export default router;
