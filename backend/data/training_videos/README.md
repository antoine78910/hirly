# Training video uploads

Uploaded course videos are stored here. Video files are gitignored; only this README and `.gitkeep` files are tracked.

## Layout

```
training_videos/
  course_job_search_mastery/
    {module_id}/
      _module/          ← module-level video (no section)
        fr.mp4          ← French upload
        en.mp4          ← English upload
      {section_id}/     ← section-level video
        fr.mp4
        en.mp4
```

## Public URL (no file extension)

```
/api/training/media/course_job_search_mastery/{module_id}/{section_or__module}/{fr|en}
```

## Admin upload

App: `/admin/training` → pick slot → Upload (EN or FR).

API: `POST /admin/training/videos` with `course_id`, `module_id`, optional `section_id`, `lang`, and `file`.

## Recreate all slot folders

From `backend/`:

```bash
python -m training_media
```

## Content Bank example videos (`mod_content_bank`)

| Slot | Folder | URL |
|------|--------|-----|
| Swiping | `sec_cb_swiping` | `/api/training/media/.../mod_content_bank/sec_cb_swiping/fr` |
| History (short) | `sec_cb_history_short` | … |
| History (long) | `sec_cb_history_long` | … |
| CV (short) | `sec_cb_cv_short` | … |
| CV (long) | `sec_cb_cv_long` | … |
| Cover letter AI | `sec_cb_cover_letter_ai` | … |
| Green screen example | `sec_cb_green_screen` | … |
| Tablet example | `sec_cb_tablet_example` | … |
| Laptop example | `sec_cb_laptop_example` | … |

Slots are defined in `training_media.py` → `VIDEO_SLOTS`.
