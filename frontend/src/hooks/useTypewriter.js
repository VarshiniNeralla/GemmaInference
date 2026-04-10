import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Cycles through phrases with a typewriter effect. Driven entirely by `enabled`:
 * when false, timers are cleared and text is empty (no restart until enabled is true again).
 *
 * @param {string[]} phrases
 * @param {object} opts
 * @param {boolean} opts.enabled — when false, animation is off and stays off
 * @param {number} opts.typeSpeed
 * @param {number} opts.deleteSpeed
 * @param {number} opts.pauseAfter
 * @param {number} opts.pauseBetween
 */
export default function useTypewriter(phrases, opts = {}) {
  const {
    enabled = true,
    typeSpeed = 55,
    deleteSpeed = 35,
    pauseAfter = 1500,
    pauseBetween = 400,
  } = opts;

  const [text, setText] = useState("");

  const state = useRef({
    phraseIdx: 0,
    charIdx: 0,
    phase: "typing",
    timer: null,
  });

  const tick = useCallback(() => {
    const s = state.current;
    const phrase = phrases[s.phraseIdx] ?? "";

    switch (s.phase) {
      case "typing": {
        if (s.charIdx < phrase.length) {
          s.charIdx++;
          setText(phrase.slice(0, s.charIdx));
          s.timer = setTimeout(tick, typeSpeed);
        } else {
          s.phase = "pausing";
          s.timer = setTimeout(tick, pauseAfter);
        }
        break;
      }
      case "pausing": {
        s.phase = "deleting";
        s.timer = setTimeout(tick, deleteSpeed);
        break;
      }
      case "deleting": {
        if (s.charIdx > 0) {
          s.charIdx--;
          setText(phrase.slice(0, s.charIdx));
          s.timer = setTimeout(tick, deleteSpeed);
        } else {
          s.phase = "gap";
          s.timer = setTimeout(tick, pauseBetween);
        }
        break;
      }
      case "gap": {
        s.phraseIdx = (s.phraseIdx + 1) % Math.max(phrases.length, 1);
        s.charIdx = 0;
        s.phase = "typing";
        setText("");
        s.timer = setTimeout(tick, typeSpeed);
        break;
      }
    }
  }, [phrases, typeSpeed, deleteSpeed, pauseAfter, pauseBetween]);

  useEffect(() => {
    const s = state.current;
    clearTimeout(s.timer);
    s.timer = null;

    if (!enabled || phrases.length === 0) {
      setText("");
      return;
    }

    s.phraseIdx = 0;
    s.charIdx = 0;
    s.phase = "typing";
    setText("");
    s.timer = setTimeout(tick, typeSpeed);

    return () => {
      clearTimeout(s.timer);
      s.timer = null;
    };
  }, [enabled, phrases, tick, typeSpeed]);

  return { text };
}
