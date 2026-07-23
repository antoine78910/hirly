# Training video filesystem-to-Supabase migration

## Scope and safety properties

This runbook migrates legacy **admin-uploaded** videos from the backend's old
filesystem layout into the private `training-videos` Supabase Storage bucket.
The migration command is dry-run by default, is idempotent, uploads an object
before it changes database metadata, and never deletes the filesystem source.

It applies the same stable private object path used for new uploads:

```
{course_id}/{module_id}/{section_id-or-_module}/{en|fr|de|es|it}
```

It does not migrate frontend deployment assets or unlabelled manual drop-ins.
There are no tracked video assets under `frontend/public/training-videos`; if
the deployed frontend has assets from an earlier deployment, recover their
original source files and upload them through `/admin/training` for the intended
slot and locale. Do not map an unlabelled file to a locale by guesswork.

## Prerequisites

1. Apply `supabase/migrations/20260723214754_training_video_storage_bucket.sql`
   to the production Supabase project. The bucket must remain private.
2. Pause admin training-video uploads for the migration window so a concurrent
   update cannot be overwritten by a legacy metadata write.
3. Ensure the Railway backend service has `SUPABASE_URL` and a server-only
   `SUPABASE_SECRET_KEY`. Never copy or expose this key in a shell transcript.

## 1. Recover the legacy Railway directory before redeploying

The legacy source location is normally
`/app/backend/data/training_videos`. Verify it on the currently running
backend first:

```bash
railway ssh -p <project> -e <environment> -s <backend-service> -- \
  'find /app -type d -path "*/backend/data/training_videos" -print'
```

If the directory is not on a Railway Volume, treat the current deployment as
the only copy: a redeploy can discard it. From the repository root, stream a
compressed backup to your local machine (replace the source path if the prior
command returned a different one):

```bash
railway ssh -p <project> -e <environment> -s <backend-service> -- \
  'tar -C /app/backend/data -czf - training_videos' \
  > training-videos-legacy.tgz

mkdir -p recovery
tar -xzf training-videos-legacy.tgz -C recovery
```

Confirm the archive contains the expected files and keep it until production
verification is complete:

```bash
tar -tzf training-videos-legacy.tgz
```

If the directory is already absent and was not mounted on a Volume, the
application cannot reconstruct the videos; restore a Railway Volume backup or
the original source files instead.

## 2. Inspect the migration plan locally

The expected legacy layout is the prior admin-upload layout:

```
training_videos/
  course_job_search_mastery/
    {module_id}/
      _module|{section_id}/
        en.mp4|fr.mp4|de.mp4|es.mp4|it.mp4
```

Run the command without `--apply`. It does not require production credentials
and does not contact Supabase or the database:

```bash
python backend/scripts/migrate_training_videos_to_supabase.py \
  --source-root ./recovery/training_videos
```

Resolve every `SKIP` line before applying. In particular, rename a manually
dropped-in file to its known locale only after confirming its intended lesson
and language. Do not use a generic file as a substitute for translated videos.

## 3. Apply using Railway service variables

Run the copier locally with the selected Railway backend's production variables
injected. The videos remain local in `./recovery`; only the private Storage
objects and module metadata are written remotely:

```bash
railway run -p <project> -e <environment> -s <backend-service> -- \
  python backend/scripts/migrate_training_videos_to_supabase.py \
    --source-root "$PWD/recovery/training_videos" --apply
```

The final JSON must have an empty `failed` list and the expected `migrated`
count. It is safe to re-run this exact command: it upserts the same object
paths, then rewrites the same localized metadata.

If the legacy directory is on a persistent Railway Volume and the migration
script has already been deployed, the command may instead run remotely:

```bash
railway ssh -p <project> -e <environment> -s <backend-service> -- \
  'cd /app && python backend/scripts/migrate_training_videos_to_supabase.py \
    --source-root /app/backend/data/training_videos --apply'
```

Do not use the remote option for an ephemeral directory after it has been
replaced by a new deployment; restore the archive first.

## 4. Verify and retire the fallback

1. In `/admin/training`, confirm each migrated locale shows its video.
2. As an authorized learner, open the matching lesson in each migrated locale
   and confirm the signed video URL plays.
3. Retain `training-videos-legacy.tgz` through at least one successful
   post-deployment verification window. The migration never deletes it.

The legacy `/api/training/media/...` fallback can be retired only in a separate,
verified change after the archive and Supabase objects have been checked.
