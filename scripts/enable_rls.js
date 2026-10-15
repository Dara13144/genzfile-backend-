import pg from 'pg';

async function enableRLS() {
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
    -- 1. Ensure upload_sessions table exists
    CREATE TABLE IF NOT EXISTS public.upload_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        upload_key TEXT NOT NULL UNIQUE,
        expected_size_bytes BIGINT NOT NULL,
        uploaded_size_bytes BIGINT DEFAULT 0 NOT NULL,
        status processing_status_type DEFAULT 'pending' NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- 2. Enable Row Level Security (RLS) on all tables (Removes UNRESTRICTED warning in Supabase UI)
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.upload_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.file_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

    -- 3. Helper functions for Role-Based Access Control
    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS BOOLEAN AS $$
    BEGIN
        RETURN EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_moderator_or_admin()
    RETURNS BOOLEAN AS $$
    BEGIN
        RETURN EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'moderator' OR role = 'admin')
        );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    -- 4. Clean up any existing policies to avoid duplicates
    DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update their own display name and avatar" ON public.profiles;
    DROP POLICY IF EXISTS "Allow service role or triggers to insert profiles" ON public.profiles;
    DROP POLICY IF EXISTS "Users can manage their own folders" ON public.folders;
    DROP POLICY IF EXISTS "Owners can view their own files" ON public.files;
    DROP POLICY IF EXISTS "Owners can insert their own files" ON public.files;
    DROP POLICY IF EXISTS "Owners can update their own files" ON public.files;
    DROP POLICY IF EXISTS "Owners can delete their own files" ON public.files;
    DROP POLICY IF EXISTS "Anyone can view files shared with active link or public" ON public.files;
    DROP POLICY IF EXISTS "Owners can manage share links" ON public.share_links;
    DROP POLICY IF EXISTS "Anyone can read active share links by token" ON public.share_links;
    DROP POLICY IF EXISTS "Users can manage their own upload sessions" ON public.upload_sessions;
    DROP POLICY IF EXISTS "Authenticated users or guests can submit reports" ON public.abuse_reports;
    DROP POLICY IF EXISTS "Moderators and admins can view and update reports" ON public.abuse_reports;
    DROP POLICY IF EXISTS "Only admins can view audit logs" ON public.admin_audit_logs;
    DROP POLICY IF EXISTS "Only admins can insert audit logs" ON public.admin_audit_logs;
    DROP POLICY IF EXISTS "Public can read non-sensitive system settings" ON public.system_settings;
    DROP POLICY IF EXISTS "Admins can update system settings" ON public.system_settings;

    -- 5. Create Secure Row Level Security Policies
    -- PROFILES
    CREATE POLICY "Users can read their own profile"
        ON public.profiles FOR SELECT
        USING (auth.uid() = id OR public.is_admin());

    CREATE POLICY "Users can update their own display name and avatar"
        ON public.profiles FOR UPDATE
        USING (auth.uid() = id OR public.is_admin())
        WITH CHECK (auth.uid() = id OR public.is_admin());

    CREATE POLICY "Allow service role or triggers to insert profiles"
        ON public.profiles FOR INSERT
        WITH CHECK (TRUE);

    -- FOLDERS
    CREATE POLICY "Users can manage their own folders"
        ON public.folders FOR ALL
        USING (auth.uid() = owner_id);

    -- FILES
    CREATE POLICY "Owners can view their own files"
        ON public.files FOR SELECT
        USING (auth.uid() = owner_id OR public.is_moderator_or_admin());

    CREATE POLICY "Owners can insert their own files"
        ON public.files FOR INSERT
        WITH CHECK (auth.uid() = owner_id);

    CREATE POLICY "Owners can update their own files"
        ON public.files FOR UPDATE
        USING (auth.uid() = owner_id OR public.is_admin());

    CREATE POLICY "Owners can delete their own files"
        ON public.files FOR DELETE
        USING (auth.uid() = owner_id OR public.is_admin());

    CREATE POLICY "Anyone can view files shared with active link or public"
        ON public.files FOR SELECT
        USING (
            deleted_at IS NULL AND (
                visibility = 'public' OR
                EXISTS (
                    SELECT 1 FROM public.share_links sl
                    WHERE sl.file_id = public.files.id
                    AND sl.is_active = TRUE
                    AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
                    AND (sl.max_downloads IS NULL OR sl.download_count < sl.max_downloads)
                )
            )
        );

    -- SHARE LINKS
    CREATE POLICY "Owners can manage share links"
        ON public.share_links FOR ALL
        USING (auth.uid() = owner_id OR public.is_admin());

    CREATE POLICY "Anyone can read active share links by token"
        ON public.share_links FOR SELECT
        USING (
            is_active = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (max_downloads IS NULL OR download_count < max_downloads)
        );

    -- UPLOAD SESSIONS
    CREATE POLICY "Users can manage their own upload sessions"
        ON public.upload_sessions FOR ALL
        USING (auth.uid() = owner_id);

    -- ABUSE REPORTS
    CREATE POLICY "Authenticated users or guests can submit reports"
        ON public.abuse_reports FOR INSERT
        WITH CHECK (TRUE);

    CREATE POLICY "Moderators and admins can view and update reports"
        ON public.abuse_reports FOR ALL
        USING (public.is_moderator_or_admin());

    -- ADMIN AUDIT LOGS
    CREATE POLICY "Only admins can view audit logs"
        ON public.admin_audit_logs FOR SELECT
        USING (public.is_admin());

    CREATE POLICY "Only admins can insert audit logs"
        ON public.admin_audit_logs FOR INSERT
        WITH CHECK (public.is_admin());

    -- SYSTEM SETTINGS
    CREATE POLICY "Public can read non-sensitive system settings"
        ON public.system_settings FOR SELECT
        USING (TRUE);

    CREATE POLICY "Admins can update system settings"
        ON public.system_settings FOR ALL
        USING (public.is_admin());

    -- FILE EVENTS
    CREATE POLICY "Allow inserting file events"
        ON public.file_events FOR INSERT
        WITH CHECK (TRUE);

    CREATE POLICY "Only admins and owners can view file events"
        ON public.file_events FOR SELECT
        USING (auth.uid() = actor_id OR public.is_admin());

    -- 6. Ensure Service Role retains full bypass permissions
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
  `;

  await client.query(sql);
  console.log('Row Level Security (RLS) successfully enabled on all Supabase tables!');
  await client.end();
}

enableRLS().catch(console.error);
