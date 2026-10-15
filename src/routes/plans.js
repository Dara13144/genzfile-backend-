import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { db } from '../services/db.js';

const router = express.Router();

export const AVAILABLE_PLANS = [
  {
    id: '1month',
    name: '1 Month Plan',
    price: '$2.99',
    priceNumber: 2.99,
    billingCycle: '1 Month',
    durationDays: 30,
    storageQuotaGb: 500,
    storageQuotaBytes: 500 * 1024 * 1024 * 1024, // 500 GB
    badge: null,
    highlighted: false,
    description: '500 GB High-Speed Secure Cloud Storage for 1 Month',
    features: [
      '500 GB High-Speed Cloud Storage',
      'Instant fast sharing links',
      'Up to 10 GB per file upload',
      'Zero ads & no download wait times',
      'Password protection on shared links',
      '24/7 Standard Support',
    ],
  },
  {
    id: '3months',
    name: '3 Month Plan',
    price: '$5.99',
    priceNumber: 5.99,
    billingCycle: '3 Months',
    durationDays: 90,
    storageQuotaGb: 1000,
    storageQuotaBytes: 1000 * 1024 * 1024 * 1024, // 1 TB
    badge: 'Most Popular',
    highlighted: true,
    description: '1 TB (1,000 GB) Ultra Storage with Multi-Month Savings',
    features: [
      '1 TB (1,000 GB) Ultra Cloud Storage',
      'Save over 33% compared to monthly',
      'Up to 25 GB per file upload',
      'High-speed global CDN delivery',
      'Custom expiration timers on links',
      'Priority media streaming & conversion',
      '24/7 Priority Support',
    ],
  },
  {
    id: '1year',
    name: '1 Year Plan',
    price: '$9.99',
    priceNumber: 9.99,
    billingCycle: '1 Year',
    durationDays: 365,
    storageQuotaGb: 2000,
    storageQuotaBytes: 2000 * 1024 * 1024 * 1024, // 2 TB
    badge: 'Best Value',
    highlighted: false,
    description: '2 TB (2,000 GB) Maximum Storage — Best Value for 1 Full Year',
    features: [
      '2 TB (2,000 GB) Maximum Cloud Vault',
      'Only $9.99 for an entire year (Unbeatable value)',
      'Up to 50 GB per file upload',
      'Full speed uncapped bandwidth',
      'Team sub-accounts & audit logs',
      'Permanent file preservation guarantee',
      '24/7 Dedicated VIP Support',
    ],
  },
];

function formatQuotaString(bytes) {
  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' TB';
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' GB';
}

function formatUsedString(bytes) {
  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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
    planName: profile.plan_name || 'Standard Plan',
    planPrice: profile.plan_price || '$0',
    planActivatedAt: profile.plan_activated_at || null,
    planExpiresAt: profile.plan_expires_at || null,
    storageQuotaBytes: quotaBytes,
    storageUsedBytes: usedBytes,
    storageQuotaFormatted: formatQuotaString(quotaBytes),
    storageUsedFormatted: formatUsedString(usedBytes),
    usagePercentage: quotaBytes > 0 
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
      : 0,
    createdAt: profile.created_at,
  };
}

// GET /api/plans - List all available subscription plans
router.get('/', (req, res) => {
  res.json({
    success: true,
    plans: AVAILABLE_PLANS,
  });
});

// POST /api/plans/subscribe - Subscribe to or upgrade a plan
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { planId, paymentMethod = 'card' } = req.body;
    const plan = AVAILABLE_PLANS.find(p => p.id === planId);

    if (!plan) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan specified. Valid options: ${AVAILABLE_PLANS.map(p => p.id).join(', ')}`,
      });
    }

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

    return res.json({
      success: true,
      message: `🎉 Successfully subscribed to ${plan.name}! Your storage quota has been upgraded to ${plan.storageQuotaGb} GB.`,
      plan,
      user: formatProfile(updatedProfile),
      transaction: {
        id: `TXN-${Date.now()}-${Math.floor(Math.random() * 90000 + 10000)}`,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        billingCycle: plan.billingCycle,
        paymentMethod,
        status: 'completed',
        date: activatedAt,
        expiresAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
