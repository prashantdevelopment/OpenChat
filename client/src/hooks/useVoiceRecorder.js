import { useEffect, useRef, useState } from "react";

// Voice messages are recorded with the browser's MediaRecorder: Opus in WebM
// (Chrome, Edge, Firefox) or AAC in MP4 (Safari).
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export const MAX_VOICE_SECONDS = 5 * 60; // about 1-2 MB, well under the 10 MB limit

export const canRecordVoice = () => typeof window.MediaRecorder === "function" && Boolean(navigator.mediaDevices?.getUserMedia);

const stopEverything = (recording) => {
  if (!recording) return;
  clearInterval(recording.timer);
  if (recording.recorder.state !== "inactive") recording.recorder.stop();
  recording.stream.getTracks().forEach((track) => track.stop()); // the browser's mic indicator goes off
};

// status: "idle" | "starting" (asking for the mic) | "recording".
// The microphone is asked for only when start() is called. onLimit() is
// called when a recording reaches MAX_VOICE_SECONDS (e.g. to send it).
export const useVoiceRecorder = ({ onLimit } = {}) => {
  const [state, setState] = useState({ status: "idle", seconds: 0, error: "" });
  const current = useRef(null); // { recorder, stream, chunks, startedAt, timer }
  const onLimitRef = useRef(onLimit);
  useEffect(() => {
    onLimitRef.current = onLimit;
  });

  const start = async () => {
    setState({ status: "starting", seconds: 0, error: "" });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message =
        error.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your browser's site settings."
          : "No microphone was found.";
      setState({ status: "idle", seconds: 0, error: message });
      return;
    }
    const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const recording = { recorder, stream, chunks: [], startedAt: Date.now(), timer: null };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recording.chunks.push(e.data);
    };
    recording.timer = setInterval(() => {
      const seconds = (Date.now() - recording.startedAt) / 1000;
      setState((s) => ({ ...s, seconds }));
      if (seconds >= MAX_VOICE_SECONDS && current.current === recording) {
        clearInterval(recording.timer);
        onLimitRef.current?.();
      }
    }, 250);
    current.current = recording;
    recorder.start();
    setState({ status: "recording", seconds: 0, error: "" });
  };

  // Stops and resolves to { blob, mime, duration } (null if nothing was
  // recorded). The duration is measured here: WebM recordings don't store it.
  const stop = () =>
    new Promise((resolve) => {
      const recording = current.current;
      current.current = null;
      if (!recording) {
        resolve(null);
        return;
      }
      const duration = (Date.now() - recording.startedAt) / 1000;
      recording.recorder.onstop = () => {
        const mime = recording.recorder.mimeType || "audio/webm";
        const blob = new Blob(recording.chunks, { type: mime });
        resolve(blob.size > 0 ? { blob, mime, duration } : null);
      };
      stopEverything(recording);
      setState({ status: "idle", seconds: 0, error: "" });
    });

  // Throws the recording away.
  const cancel = () => {
    const recording = current.current;
    current.current = null;
    if (recording) recording.recorder.onstop = null;
    stopEverything(recording);
    setState({ status: "idle", seconds: 0, error: "" });
  };

  // Leaving the chat while recording: stop the microphone.
  useEffect(() => {
    const holder = current;
    return () => stopEverything(holder.current);
  }, []);

  return { ...state, start, stop, cancel };
};
