import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5050', 10),
  frontendUrl: process.env.FRONTEND_URL || 'https://genzfile123.vercel.app',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173,https://genzfile123.vercel.app')
    .split(',')
    .map(origin => origin.trim()),
  
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '',
    bucket: process.env.SUPABASE_STORAGE_BUCKET || 'medialink-files',
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    isConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)),
  },

  auth: {
    guestUserId: '00000000-0000-0000-0000-000000000002',
    adminUserId: '00000000-0000-0000-0000-000000000001',
  },

  uploads: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
    maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10) * 1024 * 1024,
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10),
    uploadMax: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '50', 10),
  },

  mimeCategories: {
    image: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'],
    video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/ogg'],
    document: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    archive: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip',
    ],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  },

  cutluy: {
    apiKey: process.env.CUTLUY_API_KEY || 'ck_live_8xJc4pQdNENZ9bKEZ0pPiqadh7IQDG4L',
    baseUrl: process.env.CUTLUY_BASE_URL || 'https://cutluy.com/v1',
    webhookSecret: process.env.CUTLUY_WEBHOOK_SECRET || '',
  },
};
