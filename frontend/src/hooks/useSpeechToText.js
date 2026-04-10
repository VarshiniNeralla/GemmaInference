import { useState, useRef, useCallback, useEffect } from "react";

/**
 * useSpeechToText — browser-native speech recognition via Web Speech API.
 *
 * @param {object} opts
 * @param {string} opts.lang        — BCP-47 language tag (default "en-US")
 * @param {boolean} opts.continuous  — keep listening after pauses (default true)
 * @param {boolean} opts.interimResults — show partial results while speaking (default true)
 *
 * @returns {{
 *   listening: boolean,
 *   transcript: string,
 *   supported: boolean,
 *   start: () => void,
 *   stop: () => void,
 *   toggle: () => void,
 * }}
 */
export default function useSpeechToText(opts = {}) {
  const { lang = "en-US", continuous = true, interimResults = true } = opts;

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recRef = useRef(null);
  const stoppingRef = useRef(false);

  const SpeechRecognition =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  const supported = Boolean(SpeechRecognition);

  // Build recognition instance lazily
  const getRec = useCallback(() => {
    if (recRef.current) return recRef.current;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;

    rec.onresult = (event) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          final += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      setTranscript(final + interim);
    };

    rec.onend = () => {
      // If we didn't intentionally stop, the browser ended it (silence timeout).
      // Restart to keep listening in continuous mode.
      if (!stoppingRef.current && continuous) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    rec.onerror = (event) => {
      // "no-speech" and "aborted" are benign — don't stop for those
      if (event.error === "no-speech" || event.error === "aborted") return;
      setListening(false);
    };

    recRef.current = rec;
    return rec;
  }, [SpeechRecognition, lang, continuous, interimResults]);

  const start = useCallback(() => {
    const rec = getRec();
    if (!rec) return;
    stoppingRef.current = false;
    setTranscript("");
    try {
      rec.start();
      setListening(true);
    } catch {
      // Already started — ignore
    }
  }, [getRec]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    stoppingRef.current = true;
    try {
      rec.stop();
    } catch {
      // Not started — ignore
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
    } else {
      start();
    }
  }, [listening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recRef.current) {
        stoppingRef.current = true;
        try {
          recRef.current.stop();
        } catch {}
        recRef.current = null;
      }
    };
  }, []);

  return { listening, transcript, supported, start, stop, toggle };
}
