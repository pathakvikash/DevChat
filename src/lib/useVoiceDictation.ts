"use client";

import { useState, useRef, useCallback, useEffect } from "react";

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

const SpeechRecognition =
  (typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)) as
    | SpeechRecognitionConstructor
    | undefined;

export function useVoiceDictation(
  onTranscript: (text: string) => void,
) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(() => !!SpeechRecognition);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isListeningRef = useRef(false);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { }
      try { recognitionRef.current.abort() } catch { }
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      recognitionRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognition) return;

    isListeningRef.current = true;
    setIsListening(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        }
      }
      if (finalTranscript) {
        onTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      stop();
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch { }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      stop();
    }
  }, [onTranscript, stop]);

  const toggle = useCallback(() => {
    if (isListeningRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch { }
      }
    };
  }, []);

  return { isListening, toggle, isSupported };
}
