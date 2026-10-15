import { app } from './app.js';
import { config } from './config/index.js';

const server = app.listen(config.port, () => {
  console.log(`=================================================`);
  console.log(`🚀 GenZ File API Server running on port ${config.port}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 Storage Adapter: ${config.supabase.isConfigured ? 'Supabase Storage' : 'Local Disk Adapter'}`);
  console.log(`🛡️ CORS Origins: ${config.allowedOrigins.join(', ')}`);
  console.log(`=================================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
