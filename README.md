# GenzFile Backend API

High-performance, secure backend API for GenzFile — cloud storage, media management, folder organization, and direct integration with Supabase (PostgreSQL + Auth + Storage).

## Features

- **Supabase & Postgres Integration**: Direct Postgres pooler connections and Supabase client support.
- **Authentication**: JWT verification, Supabase Auth integration, and fallback demo/guest auth.
- **File Management**: Secure upload, chunked uploads, download streaming, and Supabase Storage bucket sync.
- **Folder Organization**: Hierarchical folder structures with parent/child relationships and cascaded queries.
- **Public & Protected Sharing**: Generate short links, access controls, expiration dates, and password protection.
- **Media Utilities**: Dynamic thumbnail generation, metadata extraction, and GIF processing.
- **Security & RLS**: Row Level Security (RLS) enforcement, input validation, rate limiting, and CORS configuration.

## Requirements

- Node.js >= 18.x
- PostgreSQL or Supabase project

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Copy `.env.example` to `.env` and fill in your Supabase and server configuration:
   ```bash
   cp .env.example .env
   ```

3. **Run database migrations**:
   ```bash
   node scripts/migrate.js
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Start production server**:
   ```bash
   npm start
   ```

## API Endpoints

- `GET /health` - Health check & server status
- `POST /api/auth/register` - Register a new account
- `POST /api/auth/login` - Login to account
- `GET /api/auth/me` - Current authenticated user
- `GET /api/files` - List user files (with folder and search filtering)
- `POST /api/files/upload` - Single file upload
- `GET /api/folders` - List and manage user folders
- `POST /api/folders` - Create a folder
- `POST /api/share` - Create public or password-protected share links
- `GET /api/admin/metrics` - Admin statistics and metrics
