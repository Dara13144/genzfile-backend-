import pg from 'pg';

async function migrate() {
  const client = new pg.Client({
    host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.vbneyejnjigmvalvdeaa',
    password: '4PjudEMRvtz67b46',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL!');

  const sql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('guest', 'user', 'moderator', 'admin');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
        CREATE TYPE file_visibility AS ENUM ('private', 'unlisted', 'public');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
        CREATE TYPE processing_status_type AS ENUM ('pending', 'processing', 'completed', 'failed');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
        CREATE TYPE abuse_status_type AS ENUM ('pending', 'reviewed', 'dismissed', 'actioned');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        password_hash TEXT,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        role user_role DEFAULT 'user' NOT NULL,
        plan_id TEXT DEFAULT 'free',
        plan_name TEXT DEFAULT 'Standard Tier',
        plan_price TEXT DEFAULT '$0',
        plan_activated_at TIMESTAMPTZ,
        plan_expires_at TIMESTAMPTZ,
        storage_quota_bytes BIGINT DEFAULT 1099511627776 NOT NULL,
        storage_used_bytes BIGINT DEFAULT 0 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
        folder_name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
        original_filename TEXT NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        file_size_bytes BIGINT NOT NULL,
        file_category TEXT NOT NULL,
        checksum TEXT,
        width INTEGER,
        height INTEGER,
        duration_seconds NUMERIC(10, 2),
        thumbnail_storage_key TEXT,
        processing_status processing_status_type DEFAULT 'completed' NOT NULL,
        visibility file_visibility DEFAULT 'private' NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        deleted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.share_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        public_token TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        expires_at TIMESTAMPTZ,
        max_downloads INTEGER,
        download_count INTEGER DEFAULT 0 NOT NULL,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.abuse_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
        reporter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        status abuse_status_type DEFAULT 'pending' NOT NULL,
        reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS public.file_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
        actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_owner ON public.files(owner_id);
    CREATE INDEX IF NOT EXISTS idx_files_folder ON public.files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_files_category ON public.files(file_category);
    CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON public.files(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_share_links_token ON public.share_links(public_token);
    CREATE INDEX IF NOT EXISTS idx_file_events_file ON public.file_events(file_id);

    INSERT INTO public.system_settings (key, value, description)
    VALUES 
        ('max_file_size_mb', '500'::jsonb, 'Maximum upload file size limit in Megabytes'),
        ('default_user_quota_mb', '51200'::jsonb, 'Default storage quota allocated to new users in Megabytes (50 GB)'),
        ('maintenance_mode', 'false'::jsonb, 'Put the entire platform into read-only maintenance mode')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO public.profiles (id, email, display_name, role, storage_quota_bytes, storage_used_bytes)
    VALUES 
      ('00000000-0000-0000-0000-000000000001', 'admin@medialink.pro', 'Admin User', 'admin', 10995116277760, 0),
      ('00000000-0000-0000-0000-000000000002', 'user@medialink.pro', 'Alex Rivera', 'user', 53687091200, 0),
      ('00000000-0000-0000-0000-000000000003', 'genzfile@gmail.com', 'GenzFile', 'admin', 10995116277760, 0)
    ON CONFLICT (id) DO UPDATE 
    SET email = EXCLUDED.email, role = EXCLUDED.role;
  `;

  await client.query(sql);
  console.log('Database tables & default admin accounts migrated successfully!');
  await client.end();
}

migrate().catch(console.error);
