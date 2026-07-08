import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Loader2, Mic, MicOff, Play, RotateCcw, Save, Square, Upload, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  fetchInterviewTemplate,
  fetchInterviewTemplateAudioBlob,
  fetchInterviewTemplates,
  saveInterviewTemplate,
} from "../../lib/interviewSimulatorTemplates";

function useMicrophoneSilenceDetector({ onSilence, threshold = 0.02, silenceMs = 1200 } = {}) {
  const onSilenceRef = useRef(onSilence);
  onSilenceRef.current = onSilence;

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);

  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);

  const speakingRef = useRef(false);
  const lastLoudAtRef = useRef(0);
  const silenceTriggeredRef = useRef(false);

  const stopAll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    try {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
      }
    } catch (_) {}
    streamRef.current = null;

    try {
      if (audioCtxRef.current) audioCtxRef.current.close();
    } catch (_) {}
    audioCtxRef.current = null;

    analyserRef.current = null;
    dataRef.current = null;
    speakingRef.current = false;
    lastLoudAtRef.current = 0;
    silenceTriggeredRef.current = false;

    setListening(false);
  };

  const start = async () => {
    setError(null);
    stopAll();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextCtor();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      analyserRef.current = analyser;
      dataRef.current = data;

      speakingRef.current = false;
      lastLoudAtRef.current = 0;
      silenceTriggeredRef.current = false;

      setListening(true);
      const tick = () => {
        const a = analyserRef.current;
        const d = dataRef.current;
        if (!a || !d) return;

        a.getByteTimeDomainData(d);

        let sumSq = 0;
        for (let i = 0; i < d.length; i += 1) {
          const v = (d[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / d.length);
        setLevel(rms);

        const now = Date.now();
        if (rms > threshold) {
          speakingRef.current = true;
          lastLoudAtRef.current = now;
          silenceTriggeredRef.current = false;
        } else {
          const isSilence =
            speakingRef.current &&
            !silenceTriggeredRef.current &&
            now - lastLoudAtRef.current >= silenceMs;

          if (isSilence) {
            silenceTriggeredRef.current = true;
            onSilenceRef.current?.(rms);
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e?.message || "Could not start microphone.");
    }
  };

  const stop = () => stopAll();

  useEffect(() => () => stopAll(), []);

  return { start, stop, listening, level, error };
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "0:00.0";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

function InterviewTurnIndicator({ status, currentIndex, totalSteps, micLevel, previewIndex }) {
  if (previewIndex != null) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-sky-200/40 blur-2xl" />
        <div className="relative flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-200">
            <Headphones className="h-8 w-8" />
          </div>
          <p className="mt-4 text-lg font-bold text-zinc-900">Previewing step {previewIndex + 1}</p>
          <p className="mt-1 text-sm text-zinc-600">Listen only — this does not start the dialogue.</p>
          <div className="mt-5 flex h-10 items-end justify-center gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-sky-500 animate-pulse"
                style={{
                  height: `${12 + ((i * 5 + previewIndex * 3) % 24)}px`,
                  animationDelay: `${i * 0.08}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === "playing") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-100 via-white to-fuchsia-50 p-6 shadow-sm">
        <div className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-violet-300/30 blur-2xl" />
        <div className="relative flex flex-col items-center text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-violet-600 text-white shadow-xl shadow-violet-200">
            <Volume2 className="h-9 w-9" />
            <span className="absolute inset-0 rounded-full border-2 border-violet-400/60 animate-ping" />
          </div>
          <p className="mt-4 text-xl font-bold text-zinc-900">Interviewer is speaking</p>
          <p className="mt-1 text-sm text-zinc-600">
            Step {currentIndex + 1} of {totalSteps}
          </p>
          <div className="mt-5 flex h-12 items-end justify-center gap-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className="w-2 animate-bounce rounded-full bg-violet-500"
                style={{
                  height: `${16 + (i % 3) * 10}px`,
                  animationDelay: `${i * 0.07}s`,
                  animationDuration: "0.55s",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === "waiting") {
    const levelPct = Math.min(100, Math.round(micLevel * 400));
    return (
      <div className="relative overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 shadow-sm">
        <div className="absolute -right-10 -bottom-10 h-36 w-36 rounded-full bg-emerald-300/30 blur-2xl" />
        <div className="relative flex flex-col items-center text-center">
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xl shadow-emerald-200 transition-transform"
            style={{ transform: `scale(${1 + micLevel * 0.8})` }}
          >
            <Mic className="h-9 w-9" />
            <span
              className="absolute inset-0 rounded-full border-2 border-emerald-400/70"
              style={{ transform: `scale(${1 + levelPct / 100})`, opacity: 0.35 + micLevel * 2 }}
            />
          </div>
          <p className="mt-4 text-xl font-bold text-zinc-900">Your turn to speak</p>
          <p className="mt-1 text-sm text-zinc-600">
            Answer the question — we advance when you stop talking.
          </p>
          <div className="mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-75"
              style={{ width: `${Math.max(8, levelPct)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6 text-center">
        <p className="text-lg font-bold text-zinc-900">Session complete</p>
        <p className="mt-1 text-sm text-zinc-600">Hit Play this template to run it again.</p>
      </div>
    );
  }

  return null;
}

function splitAudioBufferBySilence(audioBuffer, {
  thresholdDb = -42,
  minSilenceMs = 900,
  paddingMs = 180,
  minSegmentMs = 600,
} = {}) {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  const windowMs = 20;
  const hopMs = 10;
  const windowSize = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const hopSize = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));

  const frames = [];
  for (let i = 0; i + windowSize <= channel.length; i += hopSize) {
    let sumSq = 0;
    for (let j = i; j < i + windowSize; j += 1) {
      const v = channel[j] || 0;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    const db = 20 * Math.log10(rms + 1e-8); // avoid -Infinity
    frames.push({ i, rms, db, silent: db < thresholdDb });
  }

  const minSilenceFrames = Math.max(1, Math.floor(minSilenceMs / hopMs));

  // Build contiguous speech segments from frames.
  const rawSegments = [];
  let currentStart = null;
  for (let idx = 0; idx < frames.length; idx += 1) {
    const f = frames[idx];
    if (!f.silent) {
      if (currentStart === null) currentStart = idx;
    } else if (currentStart !== null) {
      // Speech ended at previous frame.
      const startFrame = currentStart;
      const endFrame = idx - 1;
      rawSegments.push({ startFrame, endFrame });
      currentStart = null;
    }
  }
  if (currentStart !== null) {
    rawSegments.push({ startFrame: currentStart, endFrame: frames.length - 1 });
  }

  // Convert to seconds and merge segments separated by short silences.
  const padSec = paddingMs / 1000;
  const minSegSec = minSegmentMs / 1000;

  const toSeg = (seg) => {
    const startSample = frames[seg.startFrame]?.i ?? 0;
    const endFrame = frames[seg.endFrame] || frames[frames.length - 1];
    const endSample = (endFrame.i ?? 0) + windowSize;
    return {
      start: Math.max(0, startSample / sampleRate - padSec),
      end: Math.min(duration, endSample / sampleRate + padSec),
    };
  };

  const raw = rawSegments.map(toSeg).filter((s) => s.end - s.start >= minSegSec);
  if (raw.length <= 1) return raw;

  const merged = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(seg);
      continue;
    }

    const gap = seg.start - prev.end;
    const gapFrames = gap <= 0 ? 0 : Math.floor((gap * 1000) / hopMs);
    const shouldMerge = gapFrames < minSilenceFrames;
    if (shouldMerge) {
      prev.end = Math.max(prev.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

export default function Mp3InterviewSimulator() {
  const [mp3File, setMp3File] = useState(null);
  const [mp3FileName, setMp3FileName] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [segments, setSegments] = useState([]);

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState(null);
  const [activeTemplateId, setActiveTemplateId] = useState(null);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [thresholdDb, setThresholdDb] = useState(-42);
  const [minSilenceMs, setMinSilenceMs] = useState(900);
  const [paddingMs, setPaddingMs] = useState(180);
  const [minSegmentMs, setMinSegmentMs] = useState(600);

  const [status, setStatus] = useState("setup"); // setup | playing | waiting | done
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [micError, setMicError] = useState(null);

  const audioRef = useRef(null);
  const stopTimerRef = useRef(null);
  const segmentsRef = useRef([]);
  const currentIndexRef = useRef(0);
  const statusRef = useRef(status);
  const playNextSessionSegmentRef = useRef(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const stopAudio = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      audioRef.current?.pause();
    } catch (_) {}
  }, []);

  const { start: startMic, stop: stopMic, listening: micListening, level: micLevel, error: micDetectError } = useMicrophoneSilenceDetector({
    threshold: 0.02,
    silenceMs: 1200,
    onSilence: () => {
      if (statusRef.current !== "waiting") return;

      // User stopped speaking -> next interviewer step.
      stopMic();
      setMicError(null);

      const nextIdx = currentIndexRef.current + 1;
      playNextSessionSegmentRef.current?.(nextIdx);
    },
  });

  useEffect(() => {
    if (micDetectError) setMicError(micDetectError);
  }, [micDetectError]);

  const analyze = useCallback(async (file, { applySegments = true } = {}) => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    if (applySegments) setSegments([]);
    setAudioBuffer(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextCtor();
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      setAudioBuffer(buffer);
      ctx.close?.();

      if (!applySegments) return buffer;

      const segs = splitAudioBufferBySilence(buffer, {
        thresholdDb,
        minSilenceMs,
        paddingMs,
        minSegmentMs,
      });

      const named = segs.map((s, idx) => ({
        id: `seg-${idx + 1}`,
        label: `Step ${idx + 1}`,
        start: s.start,
        end: s.end,
      }));
      setSegments(named);
      return buffer;
    } catch (e) {
      setAnalysisError(e?.message || "Could not analyze audio.");
      return null;
    } finally {
      setAnalysisLoading(false);
    }
  }, [minSegmentMs, minSilenceMs, paddingMs, thresholdDb]);

  const refreshTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const rows = await fetchInterviewTemplates();
      setTemplates(rows);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopAudio();
      stopMic();
    };
  }, [stopAudio, stopMic]);

  const playAudioRange = useCallback((start, end, onEnd) => {
    if (!audioRef.current) return;

    stopAudio();

    const startAt = Math.max(0, start + 0.01);
    const endAt = Math.max(startAt + 0.05, end);

    try {
      audioRef.current.currentTime = startAt;
    } catch (e) {
      // If currentTime assignment fails, playback will also fail.
      toast.error(e?.message || "Could not seek audio.");
      return;
    }

    audioRef.current.play().catch((e) => {
      // Autoplay restrictions often throw NotAllowedError if play() isn't triggered by a user gesture.
      console.error("Audio play() failed:", e);
      toast.error("Audio couldn't start. Click Play again (browser autoplay policy).");
    });

    const ms = Math.max(0, (endAt - startAt) * 1000);
    stopTimerRef.current = setTimeout(() => {
      try {
        audioRef.current?.pause();
      } catch (_) {}
      onEnd?.();
    }, ms);
  }, [stopAudio]);

  const previewSegment = useCallback((idx) => {
    const seg = segments[idx];
    if (!seg) return;

    stopMic();
    stopAudio();
    setStatus("setup");
    setCurrentIndex(0);
    setMicError(null);
    setPreviewIndex(idx);

    playAudioRange(seg.start, seg.end, () => {
      setPreviewIndex(null);
    });
  }, [playAudioRange, segments, stopAudio, stopMic]);

  const playNextSessionSegment = useCallback(
    (idx) => {
      const seg = segmentsRef.current[idx];
      if (!seg) {
        stopAudio();
        stopMic();
        setStatus("done");
        return;
      }

      setPreviewIndex(null);
      setCurrentIndex(idx);
      setStatus("playing");
      playAudioRange(seg.start, seg.end, () => {
        // After interviewer speaks, wait for the user to stop talking.
        setStatus("waiting");
      });
    },
    [playAudioRange, stopAudio, stopMic],
  );

  useEffect(() => {
    playNextSessionSegmentRef.current = playNextSessionSegment;
  }, [playNextSessionSegment]);

  useEffect(() => {
    if (status !== "waiting") return;
    setMicError(null);
    // Ask for mic permission and start silence detection.
    startMic();
  }, [startMic, status]);

  const startSession = () => {
    if (!segments.length) return;
    stopMic();
    stopAudio();
    setPreviewIndex(null);
    setCurrentIndex(0);
    setStatus("playing");
    setMicError(null);
    // Important: play audio inside the click handler to satisfy browser autoplay rules.
    playNextSessionSegment(0);
  };

  const stopSession = () => {
    stopMic();
    stopAudio();
    setPreviewIndex(null);
    setStatus("setup");
    setCurrentIndex(0);
    setMicError(null);
  };

  const manualNext = () => {
    // User can skip the remaining speaking moment.
    stopMic();
    stopAudio();
    const nextIdx = currentIndexRef.current + 1;
    playNextSessionSegment(nextIdx);
  };

  const canEditSegment = segments.length > 0;

  const applyAudioSource = async (file, displayName) => {
    setMp3File(file);
    setMp3FileName(displayName || file.name);
    if (audioUrl) {
      try { URL.revokeObjectURL(audioUrl); } catch (_) {}
    }
    const nextUrl = URL.createObjectURL(file);
    setAudioUrl(nextUrl);
  };

  const onUpload = async (file) => {
    if (!file) return;
    if (!file.type.includes("audio")) {
      setAnalysisError("Please upload an audio file (mp3/wav).");
      return;
    }
    setActiveTemplateId(null);
    setTemplateName(file.name.replace(/\.[^.]+$/, ""));
    await applyAudioSource(file, file.name);
    await analyze(file);
    stopSession();
  };

  const loadTemplate = async (templateId) => {
    if (!templateId) return;
    setLoadingTemplateId(templateId);
    setAnalysisError(null);
    stopSession();
    try {
      const [detail, blob] = await Promise.all([
        fetchInterviewTemplate(templateId),
        fetchInterviewTemplateAudioBlob(templateId),
      ]);
      const file = new File(
        [blob],
        detail.original_filename || `${detail.name || "template"}.mp3`,
        { type: blob.type || "audio/mpeg" },
      );
      await applyAudioSource(file, detail.name || file.name);
      setSegments(detail.segments || []);
      setActiveTemplateId(templateId);
      setTemplateName(detail.name || "");
      const settings = detail.split_settings || {};
      if (settings.thresholdDb != null) setThresholdDb(Number(settings.thresholdDb));
      if (settings.minSilenceMs != null) setMinSilenceMs(Number(settings.minSilenceMs));
      if (settings.paddingMs != null) setPaddingMs(Number(settings.paddingMs));
      if (settings.minSegmentMs != null) setMinSegmentMs(Number(settings.minSegmentMs));
      await analyze(file, { applySegments: false });
      toast.success("Template loaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not load template");
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const handleSaveTemplate = async () => {
    if (!mp3File || !segments.length) {
      toast.error("Upload and trim an MP3 before saving.");
      return;
    }
    if (!templateName.trim()) {
      toast.error("Enter a template name.");
      return;
    }
    setSavingTemplate(true);
    try {
      const saved = await saveInterviewTemplate({
        name: templateName.trim(),
        segments,
        splitSettings: { thresholdDb, minSilenceMs, paddingMs, minSegmentMs },
        durationSeconds: audioBuffer?.duration,
        audioFile: mp3File,
      });
      setActiveTemplateId(saved.template_id);
      await refreshTemplates();
      toast.success("Template saved for all creators");
    } catch (e) {
      const status = e?.response?.status;
      if (status === 504) {
        toast.error("Upload timed out. Retry in a moment (or refresh the page).");
      } else {
        toast.error(e?.response?.data?.detail || e?.message || "Could not save template");
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  const updateSegment = (idx, patch) => {
    setSegments((prev) => {
      const seg = prev[idx];
      if (!seg) return prev;
      const next = [...prev];
      next[idx] = { ...seg, ...patch };
      // Keep start/end sane.
      if (next[idx].end <= next[idx].start + 0.05) {
        next[idx].end = next[idx].start + 0.05;
      }
      if (idx > 0 && next[idx].start < next[idx - 1].end) {
        next[idx].start = next[idx - 1].end + 0.01;
      }
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-900">
              Record tools — Interview simulator
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Upload an MP3 of interview questions, auto-split on silence, then play step by step. When you stop speaking, we move to the next step.
            </p>
          </div>

          <Button type="button" variant="outline" onClick={stopSession} className="rounded-full">
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>
        </div>

        <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-800">
            Shared templates
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            Load a saved interview script that every creator can reuse.
          </p>
          {templatesLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading templates…
            </div>
          ) : templates.length ? (
            <div className="mt-3 space-y-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.template_id}
                  className={`flex items-center justify-between gap-3 rounded-xl border bg-white p-3 ${
                    activeTemplateId === tpl.template_id ? "border-violet-300" : "border-zinc-200"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{tpl.name}</p>
                    <p className="text-xs text-zinc-500">
                      {tpl.segment_count} steps · {formatTime(tpl.duration_seconds)}
                      {tpl.created_by_name ? ` · ${tpl.created_by_name}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    disabled={loadingTemplateId === tpl.template_id || analysisLoading}
                    onClick={() => loadTemplate(tpl.template_id)}
                  >
                    {loadingTemplateId === tpl.template_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Load"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No shared templates yet.</p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                1) Upload your MP3
              </p>

              <div className="mt-3 flex items-center gap-3">
                <label className="cursor-pointer rounded-full bg-zinc-900 text-white px-4 py-2 text-sm font-semibold hover:opacity-90 inline-flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => onUpload(e.target.files?.[0])}
                    disabled={analysisLoading}
                  />
                </label>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">
                    {mp3FileName || "No file selected"}
                  </p>
                  {analysisLoading ? (
                    <p className="mt-1 text-xs text-zinc-500 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing…
                    </p>
                  ) : analysisError ? (
                    <p className="mt-1 text-xs text-rose-700 font-semibold">
                      {analysisError}
                    </p>
                  ) : null}
                </div>
              </div>

              {audioBuffer ? (
                <div className="mt-4">
                  <p className="text-xs text-zinc-500">
                    Duration: <span className="font-semibold text-zinc-700">{formatTime(audioBuffer.duration)}</span>
                  </p>
                </div>
              ) : null}
            </div>

            {segments.length > 0 && status === "setup" ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                  Save as shared template
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Template name"
                    className="rounded-xl"
                  />
                  <Button
                    type="button"
                    className="rounded-full bg-zinc-900 text-white hover:opacity-90 sm:shrink-0"
                    disabled={savingTemplate || !mp3File}
                    onClick={handleSaveTemplate}
                  >
                    {savingTemplate ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save template
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">2) Split settings</p>
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Silence threshold (dB)</span>
                  <Input
                    type="number"
                    step={1}
                    value={thresholdDb}
                    onChange={(e) => setThresholdDb(Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Min silence (ms)</span>
                  <Input
                    type="number"
                    step={50}
                    value={minSilenceMs}
                    onChange={(e) => setMinSilenceMs(Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Padding (ms)</span>
                  <Input
                    type="number"
                    step={10}
                    value={paddingMs}
                    onChange={(e) => setPaddingMs(Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Min segment (ms)</span>
                  <Input
                    type="number"
                    step={50}
                    value={minSegmentMs}
                    onChange={(e) => setMinSegmentMs(Number(e.target.value))}
                    className="mt-1"
                  />
                </label>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full flex-1"
                    disabled={!audioBuffer || analysisLoading}
                    onClick={() => {
                      if (!audioBuffer) return;
                      setAnalysisLoading(true);
                      try {
                        const segs = splitAudioBufferBySilence(audioBuffer, {
                          thresholdDb,
                          minSilenceMs,
                          paddingMs,
                          minSegmentMs,
                        });
                        setSegments(segs.map((s, idx) => ({
                          id: `seg-${idx + 1}`,
                          label: `Step ${idx + 1}`,
                          start: s.start,
                          end: s.end,
                        })));
                        setAnalysisLoading(false);
                      } catch (e) {
                        setAnalysisLoading(false);
                      }
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Re-analyze
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">3) Detected steps</p>
              <p className="mt-2 text-sm text-zinc-600">
                {segments.length ? `${segments.length} steps ready.` : "Upload an MP3 to detect steps."}
              </p>

              {segments.length > 0 && (status === "setup" || status === "done") && previewIndex == null ? (
                <Button
                  type="button"
                  className="mt-4 h-14 w-full rounded-2xl bg-violet-600 text-base font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700"
                  onClick={startSession}
                >
                  <Play className="mr-2 h-5 w-5 fill-current" />
                  Play this template
                </Button>
              ) : null}

              {(status !== "setup" || previewIndex != null) ? (
                <div className="mt-4">
                  <InterviewTurnIndicator
                    status={status}
                    currentIndex={currentIndex}
                    totalSteps={segments.length}
                    micLevel={micLevel}
                    previewIndex={previewIndex}
                  />
                </div>
              ) : null}

              {segments.length ? (
                <div className="mt-4 space-y-3">
                  {segments.map((seg, idx) => (
                    <div
                      key={seg.id}
                      className={`rounded-2xl border p-3 ${
                        idx === currentIndex && (status === "playing" || status === "waiting")
                          ? "border-violet-200 bg-violet-50"
                          : previewIndex === idx
                            ? "border-sky-200 bg-sky-50"
                            : "border-zinc-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-900">{seg.label}</p>
                          <p className="text-xs text-zinc-500">
                            {formatTime(seg.start)} → {formatTime(seg.end)}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            disabled={analysisLoading || status === "playing" || status === "waiting"}
                            onClick={() => previewSegment(idx)}
                          >
                            <Headphones className="w-4 h-4 mr-1.5" />
                            Listen
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="block font-semibold text-zinc-600">Start (s)</span>
                          <Input
                            type="number"
                            step={0.1}
                            value={Number(seg.start.toFixed(2))}
                            onChange={(e) => updateSegment(idx, { start: Number(e.target.value) })}
                            disabled={!canEditSegment || status !== "setup"}
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="block font-semibold text-zinc-600">End (s)</span>
                          <Input
                            type="number"
                            step={0.1}
                            value={Number(seg.end.toFixed(2))}
                            onChange={(e) => updateSegment(idx, { end: Number(e.target.value) })}
                            disabled={!canEditSegment || status !== "setup"}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-5 flex flex-col sm:flex-row gap-2">
                {segments.length > 0 && status !== "setup" ? (
                  <Button
                    type="button"
                    className="rounded-full bg-violet-600 text-white hover:opacity-90"
                    onClick={startSession}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Restart template
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={status !== "waiting" || micListening === false}
                  onClick={manualNext}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop talking &amp; next
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={status !== "waiting" || micListening === true}
                  onClick={() => {
                    setMicError(null);
                    startMic();
                  }}
                >
                  <MicOff className="w-4 h-4 mr-2" />
                  Enable mic
                </Button>
              </div>

              {status === "waiting" && micError ? (
                <p className="mt-3 text-xs font-semibold text-rose-700">{micError}</p>
              ) : null}

              <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" />
              <div className="mt-3 text-xs text-zinc-400">
                Tip: if the split is off, adjust silence threshold and min silence, then Re-analyze.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

