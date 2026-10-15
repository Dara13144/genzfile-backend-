import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { db } from '../services/db.js';
import { storageService } from '../services/storage.js';
import { paymentSessions } from './payments.js';
import { AVAILABLE_PLANS } from './plans.js';

const router = express.Router();

// Apply auth + admin/moderator check to all admin routes
router.use(authenticateToken);
router.use(requireRole(['admin', 'moderator']));

// GET /api/admin/stats - High-level metrics
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getAdminStats();
    return res.json({ success: true, stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/users - List users with quota and role
router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const result = await db.listProfiles({ search, page: parseInt(page, 10), limit: parseInt(limit, 10) });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/users - Admin create user with specified plan
router.post('/users', requireRole(['admin']), async (req, res) => {
  try {
    const { email, displayName, password = 'User12345!', role = 'user', planId = 'free', durationDays = 30 } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    let targetPlan = AVAILABLE_PLANS.find(p => p.id === planId);
    let planName = targetPlan?.name || 'Standard Tier';
    let quotaBytes = targetPlan ? targetPlan.storageQuotaBytes : 50 * 1024 * 1024 * 1024;
    let price = targetPlan?.price || '$0';

    const activatedAt = new Date().toISOString();
    const days = Number(durationDays) || 30;
    const expiresAt = days > 3650 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const newUser = await db.createUser({
      email,
      displayName: displayName || email.split('@')[0],
      passwordHash: password,
      role,
    });

    const updatedProfile = await db.updateProfile(newUser.id, {
      plan_id: planId,
      plan_name: planName,
      plan_price: price,
      storage_quota_bytes: quotaBytes,
      plan_activated_at: activatedAt,
      plan_expires_at: expiresAt,
    });

    await db.recordAuditLog(req.user.id, 'admin_create_user', 'user', newUser.id, { email, planName, role, quotaBytes });

    return res.json({
      success: true,
      message: `User ${email} created successfully with ${planName}.`,
      user: updatedProfile,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/users/:id/plan - Admin assign or upgrade user subscription plan
router.post('/users/:id/plan', requireRole(['admin']), async (req, res) => {
  try {
    const { planId, durationDays = 30, customQuotaGb, notes } = req.body;
    let targetPlan = AVAILABLE_PLANS.find(p => p.id === planId);
    let planName = targetPlan?.name || 'Standard Tier';
    let quotaBytes = targetPlan ? targetPlan.storageQuotaBytes : 50 * 1024 * 1024 * 1024;
    let price = targetPlan?.price || '$0';

    if (planId === 'free' || planId === 'standard') {
      planName = 'Standard Tier';
      quotaBytes = 50 * 1024 * 1024 * 1024;
      price = '$0';
    } else if (planId === 'custom' && customQuotaGb) {
      planName = `Custom VIP (${customQuotaGb} GB)`;
      quotaBytes = Number(customQuotaGb) * 1024 * 1024 * 1024;
      price = 'Admin Granted';
    }

    const activatedAt = new Date().toISOString();
    const days = Number(durationDays) || 30;
    const expiresAt = days >= 3650 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const updates = {
      plan_id: planId,
      plan_name: planName,
      plan_price: price,
      storage_quota_bytes: quotaBytes,
      plan_activated_at: activatedAt,
      plan_expires_at: expiresAt,
    };

    const updatedProfile = await db.updateProfile(req.params.id, updates);
    await db.recordAuditLog(req.user.id, 'admin_assign_plan', 'user', req.params.id, {
      planName,
      quotaBytes,
      durationDays: days,
      notes: notes || 'Assigned by administrator',
    });

    return res.json({
      success: true,
      message: `Successfully applied ${planName} (${(quotaBytes / (1024 * 1024 * 1024)).toFixed(0)} GB) to ${updatedProfile.email || updatedProfile.display_name}.`,
      user: updatedProfile,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/users/:id - Update user quota, plan or role (Admin only)
router.patch('/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { role, storage_quota_bytes, plan_id, plan_name, plan_price, plan_expires_at } = req.body;
    const updates = {};
    if (role) updates.role = role;
    if (storage_quota_bytes !== undefined) updates.storage_quota_bytes = Number(storage_quota_bytes);
    if (plan_id !== undefined) updates.plan_id = plan_id;
    if (plan_name !== undefined) updates.plan_name = plan_name;
    if (plan_price !== undefined) updates.plan_price = plan_price;
    if (plan_expires_at !== undefined) updates.plan_expires_at = plan_expires_at;

    const updated = await db.updateProfile(req.params.id, updates);
    await db.recordAuditLog(req.user.id, 'update_user', 'user', req.params.id, updates);

    return res.json({ success: true, user: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/files - List files for moderation
router.get('/files', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 50 } = req.query;
    // Admins can list all files
    const result = await db.listUserFiles(null, {
      category,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10)
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/files/:id - Admin moderation file removal
router.delete('/files/:id', async (req, res) => {
  try {
    const file = await db.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found.' });
    }

    // Purge from storage
    await storageService.deleteFile(file.storage_key);
    if (file.thumbnail_storage_key) {
      await storageService.deleteFile(file.thumbnail_storage_key);
    }
    await db.permanentDeleteFile(file.id);

    await db.recordAuditLog(req.user.id, 'moderate_delete_file', 'file', file.id, {
      filename: file.original_filename,
      owner_id: file.owner_id
    });

    return res.json({ success: true, message: 'File permanently removed by administrator.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/reports - View abuse reports
router.get('/reports', async (req, res) => {
  try {
    const { status = 'all' } = req.query;
    const reports = await db.listAbuseReports({ status });
    return res.json({ success: true, reports });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/reports/:id - Review and resolve report
router.patch('/reports/:id', validate(schemas.updateReport), async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const updated = await db.updateAbuseReport(req.params.id, status, req.user.id, admin_notes);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Report not found.' });
    }

    await db.recordAuditLog(req.user.id, 'review_report', 'report', req.params.id, { status, admin_notes });
    return res.json({ success: true, report: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/audit-logs - View audit logs (Admin only)
router.get('/audit-logs', requireRole(['admin']), async (req, res) => {
  try {
    const logs = await db.getAuditLogs(100);
    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/settings - View system settings (Admin only)
router.get('/settings', requireRole(['admin']), async (req, res) => {
  try {
    const settings = await db.getSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/settings - Update system settings (Admin only)
router.patch('/settings', requireRole(['admin']), validate(schemas.updateSettings), async (req, res) => {
  try {
    const updated = await db.updateSettings(req.body, req.user.id);
    return res.json({ success: true, settings: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/payments - List all payment orders & CutLuy sessions
router.get('/payments', async (req, res) => {
  try {
    const paymentsList = [];
    for (const [id, session] of paymentSessions.entries()) {
      paymentsList.push(session);
    }
    // Sort newest first
    paymentsList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, payments: paymentsList });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/payments/:id/fulfill - Manually activate/fulfill order
router.post('/payments/:id/fulfill', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const session = paymentSessions.get(id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Payment order session not found.' });
    }

    const plan = AVAILABLE_PLANS.find(p => p.id === session.planId) || AVAILABLE_PLANS[0];
    const activatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();

    const updatedProfile = await db.updateProfile(session.userId, {
      storage_quota_bytes: plan.storageQuotaBytes,
      plan_id: plan.id,
      plan_name: plan.name,
      plan_price: plan.price,
      plan_activated_at: activatedAt,
      plan_expires_at: expiresAt,
    });

    session.fulfilled = true;
    session.status = 'paid';
    await db.recordAuditLog(req.user.id, 'manual_fulfill_payment', 'payment', id, { planName: plan.name, userId: session.userId });

    return res.json({
      success: true,
      message: `Manually activated ${plan.name} (${plan.storageQuotaGb} GB) for ${session.userEmail || session.userId}`,
      user: updatedProfile,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/users/:id - Delete user account (Admin only)
router.delete('/users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own active administrator account.' });
    }

    await db.deleteUser(targetId);
    await db.recordAuditLog(req.user.id, 'delete_user', 'user', targetId);

    return res.json({ success: true, message: 'User account removed.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
