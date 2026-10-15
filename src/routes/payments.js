import express from 'express';
import crypto from 'crypto';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { AVAILABLE_PLANS } from './plans.js';
import { db } from '../services/db.js';
import { config } from '../config/index.js';

const router = express.Router();

// In-memory & persistent payment session tracking
export const paymentSessions = new Map();

// Initial sample records so admin payments tab has immediate demo data
if (paymentSessions.size === 0) {
  paymentSessions.set('genz_pay_101', {
    paymentId: 'genz_pay_101',
    referenceId: 'genz_ref_101',
    planId: 'plan_1month',
    planName: '1 Month Plan (500 GB)',
    amount: 2.99,
    currency: 'USD',
    userId: '00000000-0000-0000-0000-000000000002',
    userEmail: 'user@medialink.pro',
    userName: 'Alex Rivera',
    status: 'paid',
    fulfilled: true,
    paymentMethod: 'ABA KHQR',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    paidAt: new Date(Date.now() - 3600000 * 23).toISOString(),
  });
  paymentSessions.set('genz_pay_102', {
    paymentId: 'genz_pay_102',
    referenceId: 'genz_ref_102',
    planId: 'plan_3month',
    planName: '3 Months Plan (1 TB)',
    amount: 5.99,
    currency: 'USD',
    userId: '00000000-0000-0000-0000-000000000002',
    userEmail: 'user@medialink.pro',
    userName: 'Alex Rivera',
    status: 'pending',
    fulfilled: false,
    paymentMethod: 'ABA KHQR',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  });
}

function formatQuotaString(bytes) {
  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' TB';
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' GB';
}

function formatProfile(profile) {
  const quotaBytes = Number(profile.storage_quota_bytes || 50 * 1024 * 1024 * 1024);
  const usedBytes = Number(profile.storage_used_bytes || 0);

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    role: profile.role || 'user',
    planId: profile.plan_id || 'free',
    planName: profile.plan_name || 'Standard Tier',
    planPrice: profile.plan_price || '$0',
    planActivatedAt: profile.plan_activated_at || null,
    planExpiresAt: profile.plan_expires_at || null,
    storageQuotaBytes: quotaBytes,
    storageUsedBytes: usedBytes,
    storageQuotaFormatted: formatQuotaString(quotaBytes),
    storageUsedFormatted: (usedBytes / (1024 * 1024)).toFixed(2) + ' MB',
    usagePercentage: quotaBytes > 0 
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
      : 0,
    createdAt: profile.created_at,
  };
}

// POST /api/payments/create - Create an auto-payment with CutLuy
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = AVAILABLE_PLANS.find(p => p.id === planId);

    if (!plan) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan specified. Valid options: ${AVAILABLE_PLANS.map(p => p.id).join(', ')}`,
      });
    }

    const referenceId = `genz_${req.user.id.substring(0, 8)}_${Date.now()}`;
    const cutluyApiKey = config.cutluy.apiKey;

    // Call CutLuy Live Payment API
    const cutluyRes = await fetch(`${config.cutluy.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cutluyApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: plan.priceNumber,
        reference_id: referenceId,
      }),
    });

    const paymentData = await cutluyRes.json();

    if (!cutluyRes.ok || !paymentData.id) {
      console.error('[CutLuy API Error]', paymentData);
      return res.status(cutluyRes.status || 500).json({
        success: false,
        error: paymentData.message || paymentData.error || 'Failed to initialize payment gateway',
      });
    }

    // Generate direct QR SVG URL from CutLuy render endpoint
    const qrSvgUrl = `https://cutluy.com/api/render/khqr/${encodeURIComponent(paymentData.qr_string)}.svg`;

    // Extract official merchant name from EMVCo tag 59
    let merchantName = 'MAO DARA imsara CO STORE';
    try {
      if (paymentData.qr_string) {
        const idx = paymentData.qr_string.indexOf('59');
        if (idx !== -1) {
          const len = parseInt(paymentData.qr_string.substring(idx + 2, idx + 4), 10);
          if (!isNaN(len) && len > 0) {
            merchantName = paymentData.qr_string.substring(idx + 4, idx + 4 + len);
          }
        }
      }
    } catch {}

    // Save session linking paymentId to user and plan
    paymentSessions.set(paymentData.id, {
      paymentId: paymentData.id,
      userId: req.user.id,
      userEmail: req.user.email,
      planId: plan.id,
      planName: plan.name,
      amount: plan.priceNumber,
      currency: paymentData.currency || 'USD',
      referenceId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: paymentData.expires_at,
      fulfilled: false,
    });

    return res.json({
      success: true,
      payment: {
        id: paymentData.id,
        status: paymentData.status || 'pending',
        amount: paymentData.amount || plan.priceNumber.toFixed(2),
        currency: paymentData.currency || 'USD',
        merchant_name: merchantName,
        reference_id: referenceId,
        qr_string: paymentData.qr_string,
        qr_svg_url: qrSvgUrl,
        checkout_url: paymentData.checkout_url,
        expires_at: paymentData.expires_at,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        storageQuotaGb: plan.storageQuotaGb,
        billingCycle: plan.billingCycle,
      },
    });
  } catch (err) {
    console.error('[PaymentCreateError]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/payments/status/:paymentId - Check payment status from CutLuy & auto-fulfill
router.get('/status/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const session = paymentSessions.get(paymentId);

    // Query CutLuy status directly
    const cutluyApiKey = config.cutluy.apiKey;
    const cutluyRes = await fetch(`${config.cutluy.baseUrl}/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${cutluyApiKey}`,
      },
    });

    const paymentData = await cutluyRes.json();

    if (!cutluyRes.ok) {
      return res.status(cutluyRes.status).json({
        success: false,
        error: paymentData.message || 'Payment not found',
      });
    }

    const currentStatus = paymentData.status; // 'pending' | 'scanned' | 'paid' | 'expired' | 'failed'

    // If paid and not yet fulfilled, activate the subscription immediately
    if (currentStatus === 'paid' && session && !session.fulfilled) {
      const plan = AVAILABLE_PLANS.find(p => p.id === session.planId);
      if (plan) {
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

        return res.json({
          success: true,
          status: 'paid',
          fulfilled: true,
          message: `🎉 Payment verified! Your ${plan.name} has been activated (${plan.storageQuotaGb} GB).`,
          plan,
          user: formatProfile(updatedProfile),
        });
      }
    }

    return res.json({
      success: true,
      status: currentStatus,
      fulfilled: session?.fulfilled || false,
      payment: paymentData,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/payments/simulate-success/:paymentId - Instant test verification helper for developer testing
router.post('/simulate-success/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    let session = paymentSessions.get(paymentId);

    if (!session) {
      // Create fallback session if not in memory
      session = {
        userId: req.user.id,
        planId: req.body.planId || '1month',
        fulfilled: false,
      };
      paymentSessions.set(paymentId, session);
    }

    const plan = AVAILABLE_PLANS.find(p => p.id === (session.planId || req.body.planId || '1month')) || AVAILABLE_PLANS[0];
    const activatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();

    const updatedProfile = await db.updateProfile(req.user.id, {
      storage_quota_bytes: plan.storageQuotaBytes,
      plan_id: plan.id,
      plan_name: plan.name,
      plan_price: plan.price,
      plan_activated_at: activatedAt,
      plan_expires_at: expiresAt,
    });

    session.fulfilled = true;
    session.status = 'paid';

    return res.json({
      success: true,
      status: 'paid',
      fulfilled: true,
      message: `🎉 Payment confirmed! Your account is upgraded to ${plan.name} (${plan.storageQuotaGb} GB).`,
      plan,
      user: formatProfile(updatedProfile),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/webhooks/cutluy - Webhook handler with signature verification
router.post('/webhooks/cutluy', async (req, res) => {
  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.get('X-CutLuy-Signature') || '';

    // If webhook secret configured, verify signature
    if (config.cutluy.webhookSecret && signature) {
      const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=')));
      const expected = crypto
        .createHmac('sha256', config.cutluy.webhookSecret)
        .update(`${parts.t}.${rawBody}`)
        .digest('hex');

      const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
      const valid = parts.v1 && fresh && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));

      if (!valid) {
        return res.status(400).send('invalid signature');
      }
    }

    const event = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);

    if (event.type === 'payment.completed' && event.data?.payment) {
      const payment = event.data.payment;
      const session = paymentSessions.get(payment.id);

      if (session && !session.fulfilled) {
        const plan = AVAILABLE_PLANS.find(p => p.id === session.planId);
        if (plan) {
          const activatedAt = new Date().toISOString();
          const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();

          await db.updateProfile(session.userId, {
            storage_quota_bytes: plan.storageQuotaBytes,
            plan_id: plan.id,
            plan_name: plan.name,
            plan_price: plan.price,
            plan_activated_at: activatedAt,
            plan_expires_at: expiresAt,
          });

          session.fulfilled = true;
          session.status = 'paid';
          console.log(`[CutLuy Webhook] Fulfilled plan ${plan.name} for user ${session.userId}`);
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('[CutLuy Webhook Error]', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
