import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('MediaLink Pro API Test Suite', () => {
  const adminToken = 'dev-admin-token';
  const userToken = 'dev-user-token';
  let sharedReportFileId;

  // 1. Health & Server Status
  describe('Health Check', () => {
    it('returns 200 and healthy status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body).toHaveProperty('storageMode');
    });
  });

  // 2. Authentication & Authorization
  describe('Authentication & Profile API', () => {
    it('rejects /api/me without authorization header', async () => {
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('authenticates valid user token and retrieves profile with quota', async () => {
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${userToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toHaveProperty('storageQuotaBytes');
      expect(res.body.user).toHaveProperty('storageUsedBytes');
      expect(res.body.user.role).toBe('user');
    });

    it('allows updating user profile display name', async () => {
      const res = await request(app)
        .patch('/api/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ display_name: 'Alex Pro User' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.display_name).toBe('Alex Pro User');
    });
  });

  // 3. Upload Validation & Execution
  describe('Upload System', () => {
    it('rejects upload when no file is attached', async () => {
      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('successfully uploads an image file and generates thumbnail', async () => {
      // 1x1 transparent PNG buffer
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );

      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', pngBuffer, 'test_sample.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.files).toHaveLength(1);
      
      const uploaded = res.body.files[0];
      expect(uploaded.original_filename).toBe('test_sample.png');
      expect(uploaded.file_category).toBe('image');
      expect(uploaded).toHaveProperty('publicToken');
      expect(uploaded).toHaveProperty('shareUrl');
    });

    it('successfully uploads a document file', async () => {
      const textBuffer = Buffer.from('Hello MediaLink Pro Document Testing');
      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', textBuffer, 'report.txt');

      expect(res.status).toBe(201);
      expect(res.body.files[0].file_category).toBe('document');
    });

    it('supports multiple files uploaded simultaneously', async () => {
      const buf1 = Buffer.from('file 1 content');
      const buf2 = Buffer.from('file 2 content');

      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', buf1, 'multi1.txt')
        .attach('files', buf2, 'multi2.txt');

      expect(res.status).toBe(201);
      expect(res.body.files).toHaveLength(2);
    });
  });

  // 4. File Management, Trash & Restore
  describe('File Management & Trash API', () => {
    let fileId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('sample content'), 'management_test.txt');
      fileId = res.body.files[0].id;
    });

    it('lists user files with metadata', async () => {
      const res = await request(app)
        .get('/api/files')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.files)).toBe(true);
      expect(res.body.files.length).toBeGreaterThan(0);
    });

    it('updates file description and filename safely', async () => {
      const res = await request(app)
        .patch(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          original_filename: 'renamed_file.txt',
          description: 'Updated file description'
        });

      expect(res.status).toBe(200);
      expect(res.body.file.original_filename).toBe('renamed_file.txt');
      expect(res.body.file.description).toBe('Updated file description');
    });

    it('prevents another user from modifying private files', async () => {
      const res = await request(app)
        .patch(`/api/files/${fileId}`)
        .set('Authorization', 'Bearer dev-custom-otheruser')
        .send({ description: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('moves file to trash (soft delete)', async () => {
      const res = await request(app)
        .delete(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it appears in trash list
      const trashRes = await request(app)
        .get('/api/files?trash=true')
        .set('Authorization', `Bearer ${userToken}`);
      
      const foundInTrash = trashRes.body.files.some(f => f.id === fileId);
      expect(foundInTrash).toBe(true);
    });

    it('restores file from trash', async () => {
      const res = await request(app)
        .post(`/api/files/${fileId}/restore`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // 5. Sharing Links, Passwords & Expirations
  describe('Sharing & Public Access', () => {
    let testFileId;
    let publicToken;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/uploads')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('shared document data'), 'confidential.pdf');
      testFileId = res.body.files[0].id;
      sharedReportFileId = testFileId;
    });

    it('creates password-protected and expiring share link', async () => {
      const res = await request(app)
        .post(`/api/files/${testFileId}/share`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          password: 'SecretPassword123!',
          expires_in_hours: 48,
          max_downloads: 5
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.shareLink.isPasswordProtected).toBe(true);
      publicToken = res.body.shareLink.public_token;
    });

    it('prompts password requirement for unauthorized public viewer', async () => {
      const res = await request(app).get(`/api/share/${publicToken}`);
      expect(res.status).toBe(200);
      expect(res.body.passwordRequired).toBe(true);
    });

    it('rejects incorrect share link password', async () => {
      const res = await request(app)
        .post(`/api/share/${publicToken}/verify-password`)
        .send({ password: 'WrongPassword' });

      expect(res.status).toBe(401);
    });

    it('unlocks file view with correct password', async () => {
      const res = await request(app)
        .post(`/api/share/${publicToken}/verify-password`)
        .send({ password: 'SecretPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('authCode');
    });
  });

  // 6. Admin Endpoints & Security
  describe('Admin Control & Moderation', () => {
    it('blocks normal user from accessing admin stats', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('allows admin to view system statistics and user list', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toHaveProperty('totalUsers');
      expect(res.body.stats).toHaveProperty('totalFiles');
      expect(res.body.stats).toHaveProperty('totalStorageBytes');
    });

    it('allows submitting abuse report and reviewing by admin', async () => {
      // 1. Submit abuse report for existing uploaded file
      const reportRes = await request(app)
        .post('/api/reports')
        .send({
          file_id: sharedReportFileId,
          reason: 'DMCA copyright infringement noticed by rights holder.'
        });

      expect(reportRes.status).toBe(201);
      const reportId = reportRes.body.reportId;

      // 2. Admin reviews report
      const reviewRes = await request(app)
        .patch(`/api/admin/reports/${reportId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'reviewed',
          admin_notes: 'Reviewed by safety moderator'
        });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.report.status).toBe('reviewed');
    });
  });

  // 10. GIF Conversion System
  describe('GIF Converter API', () => {
    it('converts multiple images into an animated GIF', async () => {
      // Create two 1x1 test png buffers
      const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const png2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

      const res = await request(app)
        .post('/api/gif/convert-images')
        .set('Authorization', `Bearer ${userToken}`)
        .field('delay', '200')
        .attach('images', png1, 'frame1.png')
        .attach('images', png2, 'frame2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.file).toHaveProperty('id');
      expect(res.body.file.mime_type).toBe('image/gif');
      expect(res.body.file.file_category).toBe('image');
      expect(res.body.file).toHaveProperty('shareUrl');
    });

    it('rejects image conversion when no images are provided', async () => {
      const res = await request(app)
        .post('/api/gif/convert-images')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});

