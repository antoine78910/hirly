#!/usr/bin/env python3
# stack-policy: python-exception=one-off recovery tool must run beside the legacy Railway filesystem and reuse the existing Python training database boundary
"""Copy legacy local training videos to private Supabase Storage.

The command is intentionally dry-run by default and never deletes its local
source files. It is idempotent: re-running --apply upserts the same object path
and persists the same localized metadata.

Examples:
  python backend/scripts/migrate_training_videos_to_supabase.py \
    --source-root ./recovery/training_videos
  railway run --project <id> --environment <id> --service <id> -- \
    python backend/scripts/migrate_training_videos_to_supabase.py \
      --source-root ./recovery/training_videos --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from db import create_database_adapter  # noqa: E402
from training_media import (  # noqa: E402
    ALLOWED_VIDEO_EXTENSIONS,
    ALLOWED_VIDEO_MIMES,
    MAX_VIDEO_BYTES,
    MEDIA_ROOT,
    apply_upload_metadata,
    normalize_training_video_locale,
    store_training_video_object,
    training_video_storage_path,
)


@dataclass(frozen=True)
class LegacyTrainingVideo:
    source_path: Path
    course_id: str
    module_id: str
    section_id: Optional[str]
    locale: str
    content_type: str

    @property
    def storage_path(self) -> str:
        return training_video_storage_path(
            self.course_id,
            self.module_id,
            self.section_id,
            self.locale,
        )


def _content_type(path: Path) -> str:
    guessed = mimetypes.guess_type(path.name)[0]
    fallback = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".m4v": "video/x-m4v",
    }
    return (guessed or fallback[path.suffix.lower()]).lower()


def discover_legacy_training_videos(root: Path) -> tuple[list[LegacyTrainingVideo], list[str]]:
    """Map canonical legacy file paths to immutable private Storage paths."""
    videos: list[LegacyTrainingVideo] = []
    skipped: list[str] = []
    if not root.is_dir():
        return videos, [f"source directory does not exist: {root}"]

    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink() or path.suffix.lower() not in ALLOWED_VIDEO_EXTENSIONS:
            continue
        relative = path.relative_to(root)
        if len(relative.parts) != 4:
            skipped.append(f"unsupported legacy layout: {relative}")
            continue

        course_id, module_id, section_part, filename = relative.parts
        try:
            locale = normalize_training_video_locale(Path(filename).stem)
            content_type = _content_type(path)
        except (KeyError, ValueError) as exc:
            skipped.append(f"invalid video metadata for {relative}: {exc}")
            continue
        except Exception as exc:  # normalize_training_video_locale raises HTTPException
            skipped.append(f"unsupported locale filename for {relative}: {exc}")
            continue

        if content_type not in ALLOWED_VIDEO_MIMES:
            skipped.append(f"unsupported video MIME for {relative}: {content_type}")
            continue
        videos.append(
            LegacyTrainingVideo(
                source_path=path,
                course_id=course_id,
                module_id=module_id,
                section_id=None if section_part == "_module" else section_part,
                locale=locale,
                content_type=content_type,
            )
        )
    return videos, skipped


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _persist_storage_metadata(db, video: LegacyTrainingVideo) -> None:
    module = await db.training_modules.find_one(
        {"module_id": video.module_id, "course_id": video.course_id},
        {"_id": 0},
    )
    if not module:
        raise RuntimeError(
            f"training module not found for {video.course_id}/{video.module_id}; metadata was not updated"
        )

    i18n = apply_upload_metadata(
        module.get("i18n") or {},
        video.section_id,
        video.locale,
        video.storage_path,
        video.source_path.name,
    )
    updates: dict[str, Any] = {"i18n": i18n, "updated_at": _now()}
    if video.locale == "en":
        english = i18n["en"]
        updates.update({
            "video_url": english.get("video_url", ""),
            "video_storage_path": english.get("video_storage_path", ""),
            "sections": english.get("sections") or [],
        })

    await db.training_modules.update_one(
        {"module_id": video.module_id, "course_id": video.course_id},
        {"$set": updates},
    )


async def migrate_legacy_training_videos(
    videos: Iterable[LegacyTrainingVideo],
    *,
    apply: bool,
) -> dict[str, Any]:
    """Upload each object first, then point its localized metadata at that object."""
    summary: dict[str, Any] = {"discovered": 0, "migrated": 0, "planned": 0, "failed": []}
    db = create_database_adapter() if apply else None
    try:
        for video in videos:
            summary["discovered"] += 1
            size = video.source_path.stat().st_size
            if size <= 0 or size > MAX_VIDEO_BYTES:
                summary["failed"].append({
                    "source": str(video.source_path),
                    "error": f"file size must be between 1 and {MAX_VIDEO_BYTES} bytes",
                })
                continue

            if not apply:
                summary["planned"] += 1
                print(f"PLAN {video.source_path} -> {video.storage_path}")
                continue

            try:
                await store_training_video_object(
                    video.storage_path,
                    video.source_path.read_bytes(),
                    video.content_type,
                )
                await _persist_storage_metadata(db, video)
                summary["migrated"] += 1
                print(f"MIGRATED {video.source_path} -> {video.storage_path}")
            except Exception as exc:
                summary["failed"].append({"source": str(video.source_path), "error": str(exc)})
    finally:
        if db is not None:
            await db.close()
    return summary


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        type=Path,
        default=MEDIA_ROOT,
        help="legacy training_videos directory (default: backend/data/training_videos)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform uploads and metadata writes; omit for a read-only migration plan",
    )
    args = parser.parse_args()

    source_root = args.source_root.expanduser().resolve()
    videos, skipped = discover_legacy_training_videos(source_root)
    for reason in skipped:
        print(f"SKIP {reason}", file=sys.stderr)
    if args.apply and skipped:
        summary = {
            "discovered": len(videos),
            "migrated": 0,
            "planned": 0,
            "failed": [{
                "source": str(source_root),
                "error": "--apply refused because discovery reported skipped files",
            }],
            "source_root": str(source_root),
            "skipped": skipped,
        }
        print(json.dumps(summary, sort_keys=True))
        return 1

    summary = await migrate_legacy_training_videos(videos, apply=args.apply)
    summary["source_root"] = str(source_root)
    summary["skipped"] = skipped
    print(json.dumps(summary, sort_keys=True))
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
