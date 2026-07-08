import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Play, RotateCcw, Square, Upload } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
  const { user } = useAuth();

  const [mp3FileName, setMp3FileName] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [segments, setSegments] = useState([]);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [thresholdDb, setThresholdDb] = useState(-42);
  const [minSilenceMs, setMinSilenceMs] = useState(900);
  const [paddingMs, setPaddingMs] = useState(180);
  const [minSegmentMs, setMinSegmentMs] = useState(600);

  const [status, setStatus] = useState("setup"); // setup | playing | waiting | done
  const [currentIndex, setCurrentIndex] = useState(0);
  const [micError, setMicError] = useState(null);

  const audioRef = useRef(null);
  const stopTimerRef = useRef(null);

  const stopAudio = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      audioRef.current?.pause();
    } catch (_) {}
  }, []);

  const { start: startMic, stop: stopMic, listening: micListening, error: micDetectError } = useMicrophoneSilenceDetector({
    threshold: 0.02,
    silenceMs: 1200,
    onSilence: () => {
      if (status !== "waiting") return;
      // User stopped speaking -> next step.
      stopMic();
      setMicError(null);
      setStatus((prev) => {
        if (prev !== "waiting") return prev;
        return "playing";
      });
      setCurrentIndex((i) => i + 1);
    },
  });

  useEffect(() => {
    if (micDetectError) setMicError(micDetectError);
  }, [micDetectError]);

  const analyze = useCallback(async (file) => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    setSegments([]);
    setAudioBuffer(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextCtor();
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      setAudioBuffer(buffer);
      ctx.close?.();

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
    } catch (e) {
      setAnalysisError(e?.message || "Could not analyze audio.");
    } finally {
      setAnalysisLoading(false);
    }
  }, [minSegmentMs, minSilenceMs, paddingMs, thresholdDb]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopAudio();
      stopMic();
    };
  }, [stopAudio, stopMic]);

  const playSegment = useCallback((idx) => {
    const seg = segments[idx];
    if (!seg || !audioRef.current) return;

    stopAudio();

    // Ensure we don't start at a time just before 0 causing issues.
    const startAt = Math.max(0, seg.start + 0.01);
    const endAt = Math.max(startAt + 0.05, seg.end);

    audioRef.current.currentTime = startAt;
    audioRef.current.play().catch(() => {});

    const ms = Math.max(0, (endAt - startAt) * 1000);
    stopTimerRef.current = setTimeout(() => {
      try {
        audioRef.current?.pause();
      } catch (_) {}
      setStatus("waiting");
    }, ms);
  }, [segments, stopAudio]);

  useEffect(() => {
    if (status !== "playing") return;
    if (!segments.length) return;
    if (currentIndex >= segments.length) {
      stopAudio();
      stopMic();
      setStatus("done");
      return;
    }
    playSegment(currentIndex);
  }, [currentIndex, playSegment, segments.length, status, stopAudio, stopMic]);

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
    setCurrentIndex(0);
    setStatus("playing");
    setMicError(null);
  };

  const stopSession = () => {
    stopMic();
    stopAudio();
    setStatus("setup");
    setCurrentIndex(0);
    setMicError(null);
  };

  const manualNext = () => {
    // User can skip the remaining speaking moment.
    stopMic();
    stopAudio();
    setStatus("playing");
    setCurrentIndex((i) => i + 1);
  };

  const canEditSegment = segments.length > 0;

  const onUpload = async (file) => {
    if (!file) return;
    if (!file.type.includes("audio")) {
      setAnalysisError("Please upload an audio file (mp3/wav).");
      return;
    }
    setMp3FileName(file.name);

    if (audioUrl) {
      try { URL.revokeObjectURL(audioUrl); } catch (_) {}
    }
    const nextUrl = URL.createObjectURL(file);
    setAudioUrl(nextUrl);

    await analyze(file);
    stopSession();
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
              Upload un MP3 de questions, découpe-le automatiquement sur les silences, puis joue étape par étape. Quand tu t’arrêtes de parler, on passe à la suivante.
            </p>
            {user ? (
              <p className="mt-2 text-xs text-zinc-400">
                Access: demo/user {user.user_id}
              </p>
            ) : null}
          </div>

          <Button type="button" variant="outline" onClick={stopSession} className="rounded-full">
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                1) Importer ton MP3
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
                    {mp3FileName || "Aucun fichier"}
                  </p>
                  {analysisLoading ? (
                    <p className="mt-1 text-xs text-zinc-500 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyse en cours…
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
                    Durée: <span className="font-semibold text-zinc-700">{formatTime(audioBuffer.duration)}</span>
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">2) Réglages de découpe</p>
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Seuil silence (dB)</span>
                  <Input
                    type="number"
                    step={1}
                    value={thresholdDb}
                    onChange={(e) => setThresholdDb(Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="block text-xs font-semibold text-zinc-600">Silence min (ms)</span>
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
                  <span className="block text-xs font-semibold text-zinc-600">Segment min (ms)</span>
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
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">3) Étapes détectées</p>
              <p className="mt-2 text-sm text-zinc-600">
                {segments.length ? `${segments.length} étapes prêtes à être jouées.` : "Importe un MP3 pour détecter les étapes."}
              </p>

              {segments.length ? (
                <div className="mt-4 space-y-3">
                  {segments.map((seg, idx) => (
                    <div key={seg.id} className={`rounded-2xl border p-3 ${idx === currentIndex ? "border-violet-200 bg-violet-50" : "border-zinc-200 bg-white"}`}>
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
                            disabled={analysisLoading}
                            onClick={() => {
                              stopSession();
                              setCurrentIndex(idx);
                              setStatus("playing");
                            }}
                          >
                            <Play className="w-4 h-4 mr-1.5" />
                            Play
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
                <Button
                  type="button"
                  className="rounded-full bg-violet-600 text-white hover:opacity-90"
                  disabled={!segments.length || status === "playing" || status === "waiting"}
                  onClick={startSession}
                >
                  <Mic className="w-4 h-4 mr-2" />
                  Start dialogue
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  disabled={status !== "waiting" || micListening === false}
                  onClick={manualNext}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop talking & Next
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

              {status === "waiting" ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Waiting for you…</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    On avance quand on détecte que tu t’arrêtes de parler.
                  </p>
                  {micError ? (
                    <p className="mt-2 text-xs text-rose-700 font-semibold">{micError}</p>
                  ) : null}
                </div>
              ) : null}

              {status === "playing" ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Playing…</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Step {segments[currentIndex]?.label || currentIndex + 1}
                  </p>
                </div>
              ) : null}

              {status === "done" ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Session finished</p>
                  <p className="mt-1 text-xs text-zinc-600">Tu peux relancer “Start dialogue”.</p>
                </div>
              ) : null}

              <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" />
              <div className="mt-3 text-xs text-zinc-400">
                Tip: si le découpage est mauvais, ajuste “Seuil silence” et “Silence min”, puis fais “Re-analyze”.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

