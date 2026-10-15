import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { db } from '../services/db.js';

const router = express.Router();

// GET /api/folders - List all folders for current user (or empty array for guests)
router.get('/', async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ success: true, folders: [] });
  }
  return authenticateToken(req, res, async () => {
    try {
      const folders = await db.listFolders(req.user.id);
      return res.json({ success: true, folders });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
});

// POST /api/folders - Create new folder
router.post('/', authenticateToken, validate(schemas.createFolder), async (req, res) => {
  try {
    const folder = await db.createFolder(req.user.id, req.body.folder_name, req.body.parent_id);
    return res.status(201).json({ success: true, folder });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/folders/:id - Rename folder
router.patch('/:id', authenticateToken, validate(schemas.updateFolder), async (req, res) => {
  try {
    const updated = await db.updateFolder(req.params.id, req.user.id, req.body.folder_name);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }
    return res.json({ success: true, folder: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/folders/:id - Delete folder
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const success = await db.deleteFolder(req.params.id, req.user.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Folder not found.' });
    }
    return res.json({ success: true, message: 'Folder deleted and files moved to root.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
