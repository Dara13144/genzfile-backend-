import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config/index.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import fileRoutes from './routes/files.js';
import sharingRoutes from './routes/sharing.js';
import folderRoutes from './routes/folders.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import gifRoutes from './routes/gif.js';
import planRoutes from './routes/plans.js';
import paymentRoutes from './routes/payments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');

export const app = express();

// Trust proxy for rate limiting behind reverse proxies (Render, Vercel, Nginx)
app.set('trust proxy', 1);

// Security Headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Managed per route for safe downloads & streaming
}));

// CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'x-share-auth'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
}));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests * 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || req.path === '/health',
  message: { success: false, error: 'Too many requests. Please try again later.' },
});
app.use('/api/', apiLimiter);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend static assets if dist exists
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    storageMode: config.supabase.isConfigured ? 'supabase' : 'local-resilient',
  });
});

// Root landing & metadata endpoint
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    if (config.frontendUrl && process.env.NODE_ENV !== 'production') {
      return res.redirect(config.frontendUrl);
    }
    const distIndex = path.join(frontendDistPath, 'index.html');
    if (fs.existsSync(distIndex)) {
      return res.sendFile(distIndex);
    }
  }

  res.json({
    success: true,
    name: 'GenZ File Cloud Storage API Server',
    status: 'online',
    version: '1.0.0',
    frontend: config.frontendUrl || 'http://localhost:3000',
    endpoints: {
      health: '/api/health',
      uploads: '/api/uploads',
      files: '/api/files',
      auth: '/api/login',
      plans: '/api/plans',
    },
  });
});

// Mount Routes
app.use('/api', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/files', fileRoutes);
app.use('/api', sharingRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gif', gifRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/payments', paymentRoutes);

// Chrome DevTools & Browser metadata endpoints (prevents 404 & CSP warning in Chrome DevTools)
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.json({ workspace: { root: null } });
});

app.get('/.well-known/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.status(204).end();
});

// Universal 404 Route handler (handles SPA navigation & prevents finalhandler default-src 'none' CSP)
app.use((req, res, next) => {
  // If a browser visits any non-API route, redirect or serve frontend SPA
  if (req.accepts('html') && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
    if (config.frontendUrl && process.env.NODE_ENV !== 'production') {
      return res.redirect(`${config.frontendUrl}${req.originalUrl}`);
    }
    const distIndex = path.join(frontendDistPath, 'index.html');
    if (fs.existsSync(distIndex)) {
      return res.sendFile(distIndex);
    }
  }

  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: `File is too large. Maximum allowed size is ${config.uploads.maxFileSizeMb} MB.`,
    });
  }

  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ success: false, error: err.message });
  }

  console.error('[UnhandledError]', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});
