"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 96;

interface VoiceWaveformProps {
  isActive: boolean;
}

export default function VoiceWaveform({ isActive }: VoiceWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const cleanupRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      cleanupRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (containerRef.current) {
        const bars = containerRef.current.children;
        for (let i = 0; i < bars.length; i++) {
          (bars[i] as HTMLElement).style.height = "3%";
        }
      }
      analyserRef.current = null;
      return;
    }

    cleanupRef.current = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cleanupRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const audioCtx = new AudioContext();
        if (audioCtx.state === "suspended") await audioCtx.resume();
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function animate() {
          if (cleanupRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          const container = containerRef.current;
          if (!container) return;
          const bars = container.children;
          for (let i = 0; i < bars.length; i++) {
            const index = Math.floor((i / bars.length) * bufferLength);
            const value = dataArray[index] / 255;
            const pct = Math.max(value * 100, 3);
            (bars[i] as HTMLElement).style.height = `${pct}%`;
          }
          rafRef.current = requestAnimationFrame(animate);
        }

        animate();
      } catch {
      }
    }

    start();

    return () => {
      cleanupRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      analyserRef.current = null;
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      className="flex items-center w-full"
      style={{ height: "28px" }}
      role="status"
      aria-label="Voice recording active"
    >
      <div
        ref={containerRef}
        className="flex items-center justify-between w-full h-full px-0.5"
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            className="w-[2px] rounded-full"
            style={{
              backgroundColor: "var(--glass-accent-strong)",
              height: "3%",
              minHeight: "2px",
            }}
          />
        ))}
      </div>
    </div>
  );
}
