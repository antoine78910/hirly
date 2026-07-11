import pytest
import asyncio

import record_tools_service
from record_tools_service import create_interview_template, list_interview_templates, transcribe_segments


class FakeCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, doc):
        self.rows.append(doc)

    def find(self, *_args, **_kwargs):
        return self

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)

    async def find_one(self, query, *_args, **_kwargs):
        for row in self.rows:
            if row.get("template_id") == query.get("template_id"):
                return row
        return None


class FakeDb:
    def __init__(self):
        self.interview_simulator_templates = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


def test_create_and_list_interview_template(tmp_path, monkeypatch):
    monkeypatch.setattr("record_tools_service.TEMPLATES_DIR", tmp_path)
    db = FakeDb()

    async def run():
        payload = await create_interview_template(
            db,
            user_id="user_1",
            user_name="Alex",
            name="Mock interview",
            segments=[{"id": "seg-1", "label": "Step 1", "start": 0, "end": 2.5}],
            split_settings={"thresholdDb": -42},
            original_filename="questions.mp3",
            audio_bytes=b"fake-mp3-bytes",
            audio_mime="audio/mpeg",
            duration_seconds=12.3,
        )
        assert payload["name"] == "Mock interview"
        assert payload["segment_count"] == 1
        assert payload["segments"][0]["end"] == 2.5

        listed = await list_interview_templates(db)
        assert len(listed) == 1
        assert listed[0]["template_id"] == payload["template_id"]

        audio_file = tmp_path / f"{payload['template_id']}.mp3"
        assert audio_file.exists()
        return payload

    asyncio.run(run())


def test_transcribe_segments_aligns_whisper_output_to_steps(monkeypatch):
    async def fake_transcribe_audio_bytes(_content, filename="audio.mp3"):
        return {
            "text": "Tell me about yourself. What is your biggest weakness?",
            "segments": [
                {"start": 0.0, "end": 2.4, "text": "Tell me about yourself."},
                {"start": 5.0, "end": 7.5, "text": "What is your biggest weakness?"},
            ],
        }

    monkeypatch.setattr(
        "record_tools_service.llm_client.transcribe_audio_bytes",
        fake_transcribe_audio_bytes,
    )

    segments = [
        {"id": "seg-1", "label": "Step 1", "start": 0.0, "end": 3.0},
        {"id": "seg-2", "label": "Step 2", "start": 4.8, "end": 8.0},
    ]

    async def run():
        return await transcribe_segments(
            audio_bytes=b"fake-bytes",
            original_filename="questions.mp3",
            segments=segments,
        )

    transcripts = asyncio.run(run())
    assert transcripts == {
        "seg-1": "Tell me about yourself.",
        "seg-2": "What is your biggest weakness?",
    }


def test_transcribe_segments_requires_audio():
    async def run():
        with pytest.raises(ValueError):
            await transcribe_segments(audio_bytes=b"", original_filename="a.mp3", segments=[{"id": "seg-1"}])

    asyncio.run(run())
