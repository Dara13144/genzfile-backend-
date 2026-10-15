import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { db } from '../services/db.js';

const router = express.Router();

// POST /api/reports - Submit abuse / DMCA report
router.post('/', optionalAuth, validate(schemas.reportAbuse), async (req, res) => {
  try {
    const { file_id, reason } = req.body;
    const file = await db.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    const report = await db.createAbuseReport(file_id, req.user?.id || null, reason);
    return res.status(201).json({
      success: true,
      message: 'Abuse report submitted. Our trust & safety team will review it shortly.',
      reportId: report.id,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
