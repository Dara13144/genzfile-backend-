import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { db } from '../services/db.js';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

export const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || 'genz-file-super-secret-jwt-key-2026';

let supabaseAuthClient = null;
if (config.supabase.isConfigured) {
  supabaseAuthClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket }
  });
}

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Missing or malformed Bearer token.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Dev / Mock test tokens
    if (token === 'dev-admin-token' || token === 'admin-token') {
      const profile = await db.getProfile('00000000-0000-0000-0000-000000000001');
      req.user = {
        id: profile.id,
        email: profile.email || 'admin@medialink.pro',
        role: 'admin',
        display_name: profile.display_name,
      };
      return next();
    }

    if (token === 'dev-user-token' || token === 'user-token') {
      const profile = await db.getProfile('00000000-0000-0000-0000-000000000002');
      req.user = {
        id: profile.id,
        email: profile.email || 'user@medialink.pro',
        role: 'user',
        display_name: profile.display_name,
      };
      return next();
    }

    // 2. Local JWT Token verification for real registered/logged-in users
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.id) {
        const profile = await db.getProfile(decoded.id);
        if (profile) {
          req.user = {
            id: profile.id,
            email: profile.email || decoded.email,
            role: profile.role || decoded.role || 'user',
            display_name: profile.display_name,
          };
          return next();
        }
      }
    } catch {
      // not a local JWT or expired, continue to Supabase / custom checks
    }

    // 3. Supabase token verification
    if (supabaseAuthClient) {
      const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session token.',
        });
      }

      const profile = await db.getProfile(user.id);
      req.user = {
        id: user.id,
        email: user.email,
        role: profile?.role || 'user',
        display_name: profile?.display_name || user.email?.split('@')[0],
      };
      return next();
    }

    // 3. Fallback for custom dev tokens (format: custom-userid-email)
    if (token.startsWith('dev-custom-')) {
      const parts = token.split('-');
      const userId = parts[2] || '00000000-0000-0000-0000-000000000002';
      const profile = await db.getProfile(userId);
      req.user = {
        id: userId,
        email: profile.email,
        role: profile.role,
        display_name: profile.display_name,
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid token signature.',
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed: ' + err.message,
    });
  }
}

export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    if (token === 'dev-admin-token') {
      const profile = await db.getProfile('00000000-0000-0000-0000-000000000001');
      req.user = { id: profile.id, role: 'admin', display_name: profile.display_name };
    } else if (token === 'dev-user-token') {
      const profile = await db.getProfile('00000000-0000-0000-0000-000000000002');
      req.user = { id: profile.id, role: 'user', display_name: profile.display_name };
    } else {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) {
          const profile = await db.getProfile(decoded.id);
          if (profile) {
            req.user = { id: profile.id, role: profile.role || 'user', display_name: profile.display_name };
          }
        }
      } catch {
        if (supabaseAuthClient) {
          const { data: { user } } = await supabaseAuthClient.auth.getUser(token);
          if (user) {
            const profile = await db.getProfile(user.id);
            req.user = { id: user.id, role: profile?.role || 'user', display_name: profile?.display_name };
          }
        }
      }
    }
  } catch {
    req.user = null;
  }
  next();
}

export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: requires one of the following roles: [${allowedRoles.join(', ')}]`,
      });
    }
    next();
  };
}
