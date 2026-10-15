import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'db_store.json');

// In-memory / persistent fallback store for instant local operation and testing
class MemoryDB {
  constructor() {
    this.profiles = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Admin User',
        email: 'admin@medialink.pro',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        role: 'admin',
        storage_quota_bytes: 10 * 1024 * 1024 * 1024 * 1024, // 10 TB
        storage_used_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        display_name: 'Alex Rivera',
        email: 'user@medialink.pro',
        avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
        role: 'user',
        storage_quota_bytes: 50 * 1024 * 1024 * 1024, // 50 GB
        storage_used_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: '00000000-0000-0000-0000-000000000003',
        display_name: 'GenzFile',
        email: 'genzfile@gmail.com',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        role: 'admin',
        storage_quota_bytes: 10 * 1024 * 1024 * 1024 * 1024, // 10 TB
        storage_used_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ];

    this.folders = [
      {
        id: 'fld-01',
        owner_id: '00000000-0000-0000-0000-00000001',
        parent_id: null,
        folder_name: 'Work Documents',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        id: 'fld-02',
        owner_id: '00000000-0000-0000-0000-00000001',
        parent_id: null,
        folder_name: 'Creative Assets',
        created_at: new Date(Date.now() - 86400000).toISOString(),
      }
    ];

    this.files = [];
    this.share_links = [];
    this.upload_sessions = [];
    this.file_events = [];
    this.abuse_reports = [];
    this.admin_audit_logs = [];
    this.system_settings = {
      max_file_size_mb: 500,
      default_user_quota_mb: 51200, // 50 GB in MB
      allowed_file_types: [
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
        'video/mp4', 'video/webm', 'video/quicktime',
        'application/pdf', 'text/plain', 'application/zip'
      ],
      maintenance_mode: false,
      rate_limit_uploads_per_hour: 50,
    };

    this._ensurePersistence();
  }

  _ensurePersistence() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.profiles && Array.isArray(parsed.profiles)) {
          const defaultIds = new Set(this.profiles.map(p => p.id));
          const savedCustom = parsed.profiles.filter(p => !defaultIds.has(p.id));
          this.profiles = [...this.profiles, ...savedCustom];
          parsed.profiles.forEach(sp => {
            const match = this.profiles.find(p => p.id === sp.id || (p.email && sp.email && p.email.toLowerCase() === sp.email.toLowerCase()));
            if (match) {
              if (sp.password_hash) match.password_hash = sp.password_hash;
              if (sp.display_name) match.display_name = sp.display_name;
              if (sp.storage_used_bytes !== undefined) match.storage_used_bytes = sp.storage_used_bytes;
              if (sp.plan_id) match.plan_id = sp.plan_id;
              if (sp.plan_name) match.plan_name = sp.plan_name;
              if (sp.plan_price) match.plan_price = sp.plan_price;
              if (sp.plan_activated_at) match.plan_activated_at = sp.plan_activated_at;
              if (sp.plan_expires_at) match.plan_expires_at = sp.plan_expires_at;
              if (sp.storage_quota_bytes !== undefined) {
                if (sp.storage_quota_bytes === 1024 * 1024 * 1024 * 1024 && !sp.plan_id) {
                  match.storage_quota_bytes = 50 * 1024 * 1024 * 1024;
                } else {
                  match.storage_quota_bytes = sp.storage_quota_bytes;
                }
              }
            }
          });
          this.profiles.forEach(p => {
            if (p.storage_quota_bytes === 1024 * 1024 * 1024 * 1024 && !p.plan_id) {
              p.storage_quota_bytes = 50 * 1024 * 1024 * 1024;
            }
          });
        }
        if (parsed.folders && Array.isArray(parsed.folders)) {
          this.folders = parsed.folders;
        }
        if (parsed.files && Array.isArray(parsed.files)) {
          this.files = parsed.files;
        }
        if (parsed.share_links && Array.isArray(parsed.share_links)) {
          this.share_links = parsed.share_links;
        }
        if (parsed.system_settings) {
          this.system_settings = { ...this.system_settings, ...parsed.system_settings };
        }
      } else {
        this._saveToDisk();
      }
    } catch (err) {
      console.warn('[DBPersistence] Load warning:', err.message);
    }
  }

  _saveToDisk() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        profiles: this.profiles,
        folders: this.folders,
        files: this.files,
        share_links: this.share_links,
        system_settings: this.system_settings,
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DBPersistence] Save warning:', err.message);
    }
  }

  // --- Profiles ---
  async getProfile(userId) {
    let p = this.profiles.find(u => u.id === userId);
    if (!p) {
      p = {
        id: userId,
        display_name: 'New User',
        email: 'user@medialink.pro',
        avatar_url: null,
        role: 'user',
        storage_quota_bytes: 50 * 1024 * 1024 * 1024, // 50 GB
        storage_used_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.profiles.push(p);
      this._saveToDisk();
    }
    return p;
  }

  async updateProfile(userId, data) {
    const p = await this.getProfile(userId);
    if (data.display_name !== undefined) p.display_name = data.display_name;
    if (data.avatar_url !== undefined) p.avatar_url = data.avatar_url;
    if (data.storage_quota_bytes !== undefined) p.storage_quota_bytes = data.storage_quota_bytes;
    if (data.role !== undefined) p.role = data.role;
    if (data.password_hash !== undefined) p.password_hash = data.password_hash;
    if (data.plan_id !== undefined) p.plan_id = data.plan_id;
    if (data.plan_name !== undefined) p.plan_name = data.plan_name;
    if (data.plan_price !== undefined) p.plan_price = data.plan_price;
    if (data.plan_activated_at !== undefined) p.plan_activated_at = data.plan_activated_at;
    if (data.plan_expires_at !== undefined) p.plan_expires_at = data.plan_expires_at;
    p.updated_at = new Date().toISOString();
    this._saveToDisk();
    return p;
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    return this.profiles.find(p => p.email && p.email.toLowerCase() === normalized) || null;
  }

  async createUser({ email, passwordHash, displayName, role = 'user', avatarUrl = null }) {
    const id = uuidv4();
    const newUser = {
      id,
      display_name: displayName || email.split('@')[0],
      email: email.trim().toLowerCase(),
      password_hash: passwordHash,
      avatar_url: avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${id}`,
      role,
      storage_quota_bytes: 50 * 1024 * 1024 * 1024, // 50 GB
      storage_used_bytes: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.profiles.push(newUser);
    this._saveToDisk();
    return newUser;
  }

  async listProfiles({ search = '', page = 1, limit = 20 }) {
    let list = this.profiles;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u => u.display_name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)));
    }
    const total = list.length;
    const start = (page - 1) * limit;
    return { users: list.slice(start, start + limit), total };
  }

  async deleteUser(userId) {
    const idx = this.profiles.findIndex(u => u.id === userId);
    if (idx !== -1) {
      this.profiles.splice(idx, 1);
    }
    this.files = this.files.filter(f => f.owner_id !== userId);
    this.folders = this.folders.filter(fld => fld.owner_id !== userId);
    this.share_links = this.share_links.filter(sl => sl.owner_id !== userId);
    this._saveToDisk();
    return true;
  }

  // --- Files ---
  async createFile(fileData) {
    const record = {
      id: uuidv4(),
      owner_id: fileData.owner_id,
      folder_id: fileData.folder_id || null,
      original_filename: fileData.original_filename,
      storage_key: fileData.storage_key,
      mime_type: fileData.mime_type,
      file_size_bytes: fileData.file_size_bytes,
      file_category: fileData.file_category,
      checksum: fileData.checksum || null,
      width: fileData.width || null,
      height: fileData.height || null,
      duration_seconds: fileData.duration_seconds || null,
      thumbnail_storage_key: fileData.thumbnail_storage_key || null,
      processing_status: fileData.processing_status || 'completed',
      visibility: fileData.visibility || 'private',
      description: fileData.description || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    this.files.push(record);
    this.recalculateQuota(fileData.owner_id);
    this._saveToDisk();
    return record;
  }

  async getFileById(fileId) {
    return this.files.find(f => f.id === fileId) || null;
  }

  async listUserFiles(ownerId, { folderId, category, search, sort = 'date_desc', isTrash = false, page = 1, limit = 50 }) {
    let list = this.files.filter(f => f.owner_id === ownerId);

    if (isTrash) {
      list = list.filter(f => f.deleted_at !== null);
    } else {
      list = list.filter(f => f.deleted_at === null);
      if (folderId !== undefined) {
        list = list.filter(f => (folderId === 'root' || folderId === null) ? !f.folder_id : f.folder_id === folderId);
      }
    }

    if (category && category !== 'all') {
      list = list.filter(f => f.file_category === category);
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(f => f.original_filename.toLowerCase().includes(q) || (f.description && f.description.toLowerCase().includes(q)));
    }

    // Sort
    list.sort((a, b) => {
      if (sort === 'name_asc') return a.original_filename.localeCompare(b.original_filename);
      if (sort === 'name_desc') return b.original_filename.localeCompare(a.original_filename);
      if (sort === 'size_asc') return a.file_size_bytes - b.file_size_bytes;
      if (sort === 'size_desc') return b.file_size_bytes - a.file_size_bytes;
      if (sort === 'date_asc') return new Date(a.created_at) - new Date(b.created_at);
      return new Date(b.created_at) - new Date(a.created_at); // default date_desc
    });

    const total = list.length;
    const start = (page - 1) * limit;
    return { files: list.slice(start, start + limit), total };
  }

  async updateFile(fileId, data) {
    const f = this.files.find(item => item.id === fileId);
    if (!f) return null;
    if (data.original_filename !== undefined) f.original_filename = data.original_filename;
    if (data.description !== undefined) f.description = data.description;
    if (data.folder_id !== undefined) f.folder_id = data.folder_id;
    if (data.visibility !== undefined) f.visibility = data.visibility;
    if (data.processing_status !== undefined) f.processing_status = data.processing_status;
    f.updated_at = new Date().toISOString();
    this._saveToDisk();
    return f;
  }

  async softDeleteFile(fileId, ownerId) {
    const f = this.files.find(item => item.id === fileId && item.owner_id === ownerId);
    if (!f) return false;
    f.deleted_at = new Date().toISOString();
    this.recalculateQuota(ownerId);
    this._saveToDisk();
    return true;
  }

  async restoreFile(fileId, ownerId) {
    const f = this.files.find(item => item.id === fileId && item.owner_id === ownerId);
    if (!f) return false;
    f.deleted_at = null;
    this.recalculateQuota(ownerId);
    this._saveToDisk();
    return true;
  }

  async permanentDeleteFile(fileId, ownerId = null) {
    const idx = this.files.findIndex(item => item.id === fileId && (!ownerId || item.owner_id === ownerId));
    if (idx === -1) return null;
    const [deleted] = this.files.splice(idx, 1);
    this.share_links = this.share_links.filter(sl => sl.file_id !== fileId);
    this.recalculateQuota(deleted.owner_id);
    this._saveToDisk();
    return deleted;
  }

  async bulkDeleteFiles(fileIds, ownerId) {
    let deletedCount = 0;
    for (const id of fileIds) {
      const ok = await this.softDeleteFile(id, ownerId);
      if (ok) deletedCount++;
    }
    return deletedCount;
  }

  async emptyTrash(ownerId) {
    const trashedFiles = this.files.filter(f => f.owner_id === ownerId && f.deleted_at !== null);
    this.files = this.files.filter(f => !(f.owner_id === ownerId && f.deleted_at !== null));
    this.recalculateQuota(ownerId);
    this._saveToDisk();
    return trashedFiles;
  }

  recalculateQuota(ownerId) {
    const totalBytes = this.files
      .filter(f => f.owner_id === ownerId && f.deleted_at === null)
      .reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);
    const p = this.profiles.find(u => u.id === ownerId);
    if (p) {
      p.storage_used_bytes = totalBytes;
    }
    return totalBytes;
  }

  // --- Share Links ---
  async createShareLink(data) {
    // Revoke previous links if requested, or add new
    const link = {
      id: uuidv4(),
      file_id: data.file_id,
      owner_id: data.owner_id,
      public_token: data.public_token,
      password_hash: data.password_hash || null,
      expires_at: data.expires_at || null,
      max_downloads: data.max_downloads || null,
      download_count: 0,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    this.share_links.push(link);
    this._saveToDisk();
    return link;
  }

  async getShareLinkByToken(token) {
    return this.share_links.find(sl => sl.public_token === token && sl.is_active) || null;
  }

  async getShareLinksByFile(fileId, ownerId) {
    return this.share_links.filter(sl => sl.file_id === fileId && sl.owner_id === ownerId);
  }

  async updateShareLink(id, ownerId, data) {
    const link = this.share_links.find(sl => sl.id === id && sl.owner_id === ownerId);
    if (!link) return null;
    if (data.is_active !== undefined) link.is_active = data.is_active;
    if (data.expires_at !== undefined) link.expires_at = data.expires_at;
    if (data.max_downloads !== undefined) link.max_downloads = data.max_downloads;
    if (data.password_hash !== undefined) link.password_hash = data.password_hash;
    return link;
  }

  async deleteShareLink(id, ownerId) {
    const idx = this.share_links.findIndex(sl => sl.id === id && (sl.owner_id === ownerId || !ownerId));
    if (idx === -1) return false;
    this.share_links.splice(idx, 1);
    return true;
  }

  async incrementShareDownload(shareLinkId) {
    const link = this.share_links.find(sl => sl.id === shareLinkId);
    if (link) {
      link.download_count = (link.download_count || 0) + 1;
    }
  }

  // --- Folders ---
  async listFolders(ownerId) {
    return this.folders.filter(fld => fld.owner_id === ownerId);
  }

  async createFolder(ownerId, folderName, parentId = null) {
    const folder = {
      id: uuidv4(),
      owner_id: ownerId,
      parent_id: parentId,
      folder_name: folderName.trim(),
      created_at: new Date().toISOString(),
    };
    this.folders.push(folder);
    this._saveToDisk();
    return folder;
  }

  async updateFolder(folderId, ownerId, folderName) {
    const fld = this.folders.find(f => f.id === folderId && f.owner_id === ownerId);
    if (!fld) return null;
    fld.folder_name = folderName.trim();
    this._saveToDisk();
    return fld;
  }

  async deleteFolder(folderId, ownerId) {
    const idx = this.folders.findIndex(f => f.id === folderId && f.owner_id === ownerId);
    if (idx === -1) return false;
    this.folders.splice(idx, 1);
    // Move all files in this folder to root
    for (const f of this.files) {
      if (f.folder_id === folderId) f.folder_id = null;
    }
    this._saveToDisk();
    return true;
  }

  // --- File Events ---
  async recordFileEvent(fileId, actorId, eventType, ip = null, userAgent = null) {
    const evt = {
      id: uuidv4(),
      file_id: fileId,
      actor_id: actorId,
      event_type: eventType,
      ip_address: ip,
      user_agent: userAgent,
      created_at: new Date().toISOString(),
    };
    this.file_events.push(evt);
    return evt;
  }

  // --- Abuse Reports ---
  async createAbuseReport(fileId, reporterId, reason) {
    const report = {
      id: uuidv4(),
      file_id: fileId,
      reporter_id: reporterId || null,
      reason,
      status: 'pending',
      reviewed_by: null,
      admin_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.abuse_reports.push(report);
    return report;
  }

  async listAbuseReports({ status = 'all' }) {
    let list = this.abuse_reports;
    if (status !== 'all') {
      list = list.filter(r => r.status === status);
    }
    // Enrich with file info
    return list.map(r => {
      const file = this.files.find(f => f.id === r.file_id);
      return { ...r, file: file || null };
    });
  }

  async updateAbuseReport(reportId, status, reviewedBy, adminNotes = null) {
    const rep = this.abuse_reports.find(r => r.id === reportId);
    if (!rep) return null;
    rep.status = status;
    rep.reviewed_by = reviewedBy;
    if (adminNotes) rep.admin_notes = adminNotes;
    rep.updated_at = new Date().toISOString();
    return rep;
  }

  // --- Admin Audit Logs & Stats ---
  async recordAuditLog(adminId, action, targetType, targetId, details = null) {
    const log = {
      id: uuidv4(),
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      created_at: new Date().toISOString(),
    };
    this.admin_audit_logs.unshift(log);
    if (this.admin_audit_logs.length > 500) {
      this.admin_audit_logs.pop();
    }
    return log;
  }

  async getAuditLogs(limit = 50) {
    return this.admin_audit_logs.slice(0, limit);
  }

  async getAdminStats() {
    const totalUsers = this.profiles.length;
    const activeFiles = this.files.filter(f => f.deleted_at === null);
    const totalFiles = activeFiles.length;
    const totalStorageBytes = activeFiles.reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);

    const categories = {
      image: activeFiles.filter(f => f.file_category === 'image').length,
      video: activeFiles.filter(f => f.file_category === 'video').length,
      document: activeFiles.filter(f => f.file_category === 'document').length,
      archive: activeFiles.filter(f => f.file_category === 'archive').length,
      other: activeFiles.filter(f => !['image', 'video', 'document', 'archive'].includes(f.file_category)).length,
    };

    const pendingReports = this.abuse_reports.filter(r => r.status === 'pending').length;

    return {
      totalUsers,
      totalFiles,
      totalStorageBytes,
      categories,
      pendingReports,
      recentUploadsCount: activeFiles.filter(f => new Date(f.created_at) > new Date(Date.now() - 86400000)).length,
    };
  }

  async getSettings() {
    return this.system_settings;
  }

  async updateSettings(settings, updatedBy) {
    this.system_settings = { ...this.system_settings, ...settings };
    await this.recordAuditLog(updatedBy, 'update_settings', 'system_settings', 'main', settings);
    return this.system_settings;
  }
}

// Supabase Database Wrapper
class SupabaseDB {
  constructor() {
    this.client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    // Memory store fallback for mock/offline resilience
    this.fallback = new MemoryDB();
  }

  async getProfile(userId) {
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return this.fallback.getProfile(userId);
      return data;
    } catch {
      return this.fallback.getProfile(userId);
    }
  }

  async updateProfile(userId, updates) {
    try {
      const { data, error } = await this.client
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.updateProfile(userId, updates);
    }
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .ilike('email', normalized)
        .maybeSingle();
      if (error || !data) return this.fallback.findUserByEmail(email);
      return data;
    } catch {
      return this.fallback.findUserByEmail(email);
    }
  }

  async createUser(params) {
    const id = uuidv4();
    const newUser = {
      id,
      display_name: params.displayName || params.email.split('@')[0],
      email: params.email.trim().toLowerCase(),
      password_hash: params.passwordHash,
      avatar_url: params.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${id}`,
      role: params.role || 'user',
      storage_quota_bytes: 50 * 1024 * 1024 * 1024,
      storage_used_bytes: 0,
    };
    try {
      const { data, error } = await this.client.from('profiles').insert([newUser]).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('Supabase createUser warning:', e.message);
      return this.fallback.createUser(params);
    }
  }

  async listProfiles(params) {
    try {
      let query = this.client.from('profiles').select('*', { count: 'exact' });
      if (params.search) {
        query = query.ilike('display_name', `%${params.search}%`);
      }
      const page = params.page || 1;
      const limit = params.limit || 20;
      const from = (page - 1) * limit;
      const { data, count, error } = await query.range(from, from + limit - 1);
      if (error) throw error;
      return { users: data, total: count };
    } catch {
      return this.fallback.listProfiles(params);
    }
  }

  async createFile(fileData) {
    try {
      const { data, error } = await this.client
        .from('files')
        .insert([fileData])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.createFile(fileData);
    }
  }

  async getFileById(fileId) {
    try {
      const { data, error } = await this.client
        .from('files')
        .select('*')
        .eq('id', fileId)
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.getFileById(fileId);
    }
  }

  async listUserFiles(ownerId, options) {
    try {
      let query = this.client.from('files').select('*', { count: 'exact' }).eq('owner_id', ownerId);
      if (options.isTrash) {
        query = query.not('deleted_at', 'is', null);
      } else {
        query = query.is('deleted_at', null);
        if (options.folderId !== undefined) {
          if (options.folderId === 'root' || options.folderId === null) {
            query = query.is('folder_id', null);
          } else {
            query = query.eq('folder_id', options.folderId);
          }
        }
      }
      if (options.category && options.category !== 'all') {
        query = query.eq('file_category', options.category);
      }
      if (options.search) {
        query = query.ilike('original_filename', `%${options.search}%`);
      }

      const page = options.page || 1;
      const limit = options.limit || 50;
      const from = (page - 1) * limit;
      const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, from + limit - 1);
      if (error) throw error;
      return { files: data, total: count };
    } catch {
      return this.fallback.listUserFiles(ownerId, options);
    }
  }

  async updateFile(fileId, data) {
    try {
      const { data: updated, error } = await this.client
        .from('files')
        .update(data)
        .eq('id', fileId)
        .select()
        .single();
      if (error) throw error;
      return updated;
    } catch {
      return this.fallback.updateFile(fileId, data);
    }
  }

  async softDeleteFile(fileId, ownerId) {
    try {
      const { error } = await this.client
        .from('files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', fileId)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return true;
    } catch {
      return this.fallback.softDeleteFile(fileId, ownerId);
    }
  }

  async restoreFile(fileId, ownerId) {
    try {
      const { error } = await this.client
        .from('files')
        .update({ deleted_at: null })
        .eq('id', fileId)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return true;
    } catch {
      return this.fallback.restoreFile(fileId, ownerId);
    }
  }

  async permanentDeleteFile(fileId, ownerId = null) {
    try {
      let query = this.client.from('files').delete().eq('id', fileId);
      if (ownerId) query = query.eq('owner_id', ownerId);
      const { data, error } = await query.select().single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.permanentDeleteFile(fileId, ownerId);
    }
  }

  async bulkDeleteFiles(fileIds, ownerId) {
    try {
      const { error } = await this.client
        .from('files')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', fileIds)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return fileIds.length;
    } catch {
      return this.fallback.bulkDeleteFiles(fileIds, ownerId);
    }
  }

  async emptyTrash(ownerId) {
    try {
      const { data: trashed, error: selectErr } = await this.client
        .from('files')
        .select('*')
        .eq('owner_id', ownerId)
        .not('deleted_at', 'is', null);
      if (selectErr) throw selectErr;

      const { error: delErr } = await this.client
        .from('files')
        .delete()
        .eq('owner_id', ownerId)
        .not('deleted_at', 'is', null);
      if (delErr) throw delErr;
      return trashed || [];
    } catch {
      return this.fallback.emptyTrash(ownerId);
    }
  }

  async createShareLink(data) {
    try {
      const { data: link, error } = await this.client
        .from('share_links')
        .insert([data])
        .select()
        .single();
      if (error) throw error;
      return link;
    } catch {
      return this.fallback.createShareLink(data);
    }
  }

  async getShareLinkByToken(token) {
    try {
      const { data, error } = await this.client
        .from('share_links')
        .select('*')
        .eq('public_token', token)
        .eq('is_active', true)
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.getShareLinkByToken(token);
    }
  }

  async getShareLinksByFile(fileId, ownerId) {
    try {
      const { data, error } = await this.client
        .from('share_links')
        .select('*')
        .eq('file_id', fileId)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.getShareLinksByFile(fileId, ownerId);
    }
  }

  async updateShareLink(id, ownerId, data) {
    try {
      const { data: updated, error } = await this.client
        .from('share_links')
        .update(data)
        .eq('id', id)
        .eq('owner_id', ownerId)
        .select()
        .single();
      if (error) throw error;
      return updated;
    } catch {
      return this.fallback.updateShareLink(id, ownerId, data);
    }
  }

  async deleteShareLink(id, ownerId) {
    try {
      const { error } = await this.client
        .from('share_links')
        .delete()
        .eq('id', id)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return true;
    } catch {
      return this.fallback.deleteShareLink(id, ownerId);
    }
  }

  async incrementShareDownload(shareLinkId) {
    try {
      await this.client.rpc('increment_share_download', { link_id: shareLinkId });
    } catch {
      this.fallback.incrementShareDownload(shareLinkId);
    }
  }

  async listFolders(ownerId) {
    try {
      const { data, error } = await this.client
        .from('folders')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.listFolders(ownerId);
    }
  }

  async createFolder(ownerId, folderName, parentId = null) {
    try {
      const { data, error } = await this.client
        .from('folders')
        .insert([{ owner_id: ownerId, folder_name: folderName, parent_id: parentId }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.createFolder(ownerId, folderName, parentId);
    }
  }

  async updateFolder(folderId, ownerId, folderName) {
    try {
      const { data, error } = await this.client
        .from('folders')
        .update({ folder_name: folderName })
        .eq('id', folderId)
        .eq('owner_id', ownerId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.updateFolder(folderId, ownerId, folderName);
    }
  }

  async deleteFolder(folderId, ownerId) {
    try {
      const { error } = await this.client
        .from('folders')
        .delete()
        .eq('id', folderId)
        .eq('owner_id', ownerId);
      if (error) throw error;
      return true;
    } catch {
      return this.fallback.deleteFolder(folderId, ownerId);
    }
  }

  async recordFileEvent(fileId, actorId, eventType, ip = null, userAgent = null) {
    try {
      const { data, error } = await this.client
        .from('file_events')
        .insert([{ file_id: fileId, actor_id: actorId, event_type: eventType, ip_address: ip, user_agent: userAgent }]);
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.recordFileEvent(fileId, actorId, eventType, ip, userAgent);
    }
  }

  async createAbuseReport(fileId, reporterId, reason) {
    try {
      const { data, error } = await this.client
        .from('abuse_reports')
        .insert([{ file_id: fileId, reporter_id: reporterId || null, reason, status: 'pending' }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.createAbuseReport(fileId, reporterId, reason);
    }
  }

  async listAbuseReports(options = {}) {
    try {
      let query = this.client
        .from('abuse_reports')
        .select('*, file:files(*)')
        .order('created_at', { ascending: false });
      if (options.status && options.status !== 'all') {
        query = query.eq('status', options.status);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.listAbuseReports(options);
    }
  }

  async updateAbuseReport(reportId, status, reviewedBy, notes = null) {
    try {
      const updates = { status, reviewed_by: reviewedBy, updated_at: new Date().toISOString() };
      if (notes !== null) updates.admin_notes = notes;
      const { data, error } = await this.client
        .from('abuse_reports')
        .update(updates)
        .eq('id', reportId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.updateAbuseReport(reportId, status, reviewedBy, notes);
    }
  }

  async recordAuditLog(adminId, action, targetType, targetId, details = null) {
    try {
      const { data, error } = await this.client
        .from('admin_audit_logs')
        .insert([{ admin_id: adminId, action, target_type: targetType, target_id: targetId, details }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.recordAuditLog(adminId, action, targetType, targetId, details);
    }
  }

  async getAuditLogs(limit = 50) {
    try {
      const { data, error } = await this.client
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    } catch {
      return this.fallback.getAuditLogs(limit);
    }
  }

  async getAdminStats() {
    try {
      const [usersRes, filesRes, pendingReportsRes] = await Promise.all([
        this.client.from('profiles').select('id', { count: 'exact', head: true }),
        this.client.from('files').select('file_category, file_size_bytes, created_at').is('deleted_at', null),
        this.client.from('abuse_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);

      const totalUsers = usersRes.count || 0;
      const activeFiles = filesRes.data || [];
      const totalFiles = activeFiles.length;
      const totalStorageBytes = activeFiles.reduce((sum, f) => sum + Number(f.file_size_bytes || 0), 0);

      const categories = {
        image: activeFiles.filter(f => f.file_category === 'image').length,
        video: activeFiles.filter(f => f.file_category === 'video').length,
        document: activeFiles.filter(f => f.file_category === 'document').length,
        archive: activeFiles.filter(f => f.file_category === 'archive').length,
        other: activeFiles.filter(f => !['image', 'video', 'document', 'archive'].includes(f.file_category)).length,
      };

      const pendingReports = pendingReportsRes.count || 0;
      const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
      const recentUploadsCount = activeFiles.filter(f => f.created_at > oneDayAgo).length;

      return {
        totalUsers,
        totalFiles,
        totalStorageBytes,
        categories,
        pendingReports,
        recentUploadsCount,
      };
    } catch {
      return this.fallback.getAdminStats();
    }
  }

  async getSettings() {
    try {
      const { data, error } = await this.client
        .from('system_settings')
        .select('*');
      if (error) throw error;
      const obj = {};
      (data || []).forEach(row => {
        obj[row.key] = row.value;
      });
      return { ...this.fallback.system_settings, ...obj };
    } catch {
      return this.fallback.getSettings();
    }
  }

  async updateSettings(settings, updatedBy) {
    try {
      const entries = Object.entries(settings);
      for (const [key, val] of entries) {
        await this.client
          .from('system_settings')
          .upsert({
            key,
            value: typeof val === 'object' ? val : JSON.stringify(val),
            updated_at: new Date().toISOString(),
            updated_by: updatedBy,
          });
      }
      await this.recordAuditLog(updatedBy, 'update_settings', 'system_settings', 'main', settings);
      return this.getSettings();
    } catch {
      return this.fallback.updateSettings(settings, updatedBy);
    }
  }

  async deleteUser(userId) {
    try {
      await this.client.from('profiles').delete().eq('id', userId);
    } catch {}
    return this.fallback.deleteUser(userId);
  }
}

export const db = config.supabase.isConfigured ? new SupabaseDB() : new MemoryDB();
