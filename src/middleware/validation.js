import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      req.validated = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      return res.status(400).json({ success: false, error: 'Invalid request data' });
    }
  };
}

// Schemas
export const schemas = {
  updateProfile: z.object({
    body: z.object({
      display_name: z.string().min(2).max(60).optional(),
      avatar_url: z.string().url().or(z.literal('')).nullable().optional(),
    }),
  }),

  updateFile: z.object({
    body: z.object({
      original_filename: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).optional(),
      folder_id: z.string().uuid().or(z.literal('root')).nullable().optional(),
      visibility: z.enum(['private', 'unlisted', 'public']).optional(),
    }),
  }),

  createShareLink: z.object({
    body: z.object({
      password: z.string().min(4).max(100).optional().nullable(),
      expires_in_hours: z.number().int().positive().optional().nullable(),
      max_downloads: z.number().int().positive().optional().nullable(),
    }),
  }),

  verifySharePassword: z.object({
    body: z.object({
      password: z.string().min(1),
    }),
  }),

  createFolder: z.object({
    body: z.object({
      folder_name: z.string().min(1).max(100),
      parent_id: z.string().uuid().nullable().optional(),
    }),
  }),

  updateFolder: z.object({
    body: z.object({
      folder_name: z.string().min(1).max(100),
    }),
  }),

  reportAbuse: z.object({
    body: z.object({
      file_id: z.string().min(1),
      reason: z.string().min(5).max(1000),
    }),
  }),

  updateReport: z.object({
    body: z.object({
      status: z.enum(['pending', 'reviewed', 'dismissed', 'actioned']),
      admin_notes: z.string().max(1000).optional(),
    }),
  }),

  updateSettings: z.object({
    body: z.object({
      max_file_size_mb: z.number().min(1).max(10240).optional(),
      default_user_quota_mb: z.number().min(50).max(102400).optional(),
      allowed_file_types: z.array(z.string()).optional(),
      maintenance_mode: z.boolean().optional(),
      rate_limit_uploads_per_hour: z.number().min(1).max(1000).optional(),
    }),
  }),

  bulkDelete: z.object({
    body: z.object({
      file_ids: z.array(z.string().min(1)).min(1),
    }),
  })
};
