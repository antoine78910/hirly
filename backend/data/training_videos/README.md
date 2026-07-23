# Training video storage

**New training-video uploads are stored in the private Supabase Storage bucket
`training-videos`, not in this repository or on the application filesystem.**

The application stores a stable object path per course/module/section/language,
for example:

```
course_job_search_mastery/mod_warm_up/sec_wu_sop/fr
```

When an authorized learner opens a course, the backend creates a short-lived
signed URL for that private object. The Supabase secret key stays on the backend;
the bucket has no anonymous or authenticated-object policies.

## Admin upload

App: `/admin/training` → **Course videos** → pick the lesson slot and language
→ choose the video → **Upload video**.

The uploader accepts MP4, WebM, MOV, or M4V files up to 500 MB. It replaces only
the selected slot and language, preserving other language versions.

API: `POST /admin/training/videos` with `course_id`, `module_id`, optional
`section_id`, `lang`, and `file`.

Required backend environment variables:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<server-only-secret-key>
```

Apply `supabase/migrations/20260723214754_training_video_storage_bucket.sql`
to create the private bucket before uploading videos.

## Legacy local files

This directory and the legacy `/api/training/media/...` route remain only to
serve records uploaded before the Storage migration. They are not used for new
uploads and must not be relied on for durable production media.

Canonical upload slots are defined in `backend/training_media.py` →
`VIDEO_SLOTS`.
