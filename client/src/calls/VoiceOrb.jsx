import { useEffect, useRef } from "react";

const POINTS = 64; // points around the edge of the blob
const SMOOTHING = 0.2; // how fast the orb follows the voice (0..1)

// Loudness of a stream, 0..1, in decibels like our ears hear it: the root
// mean square of the waveform, -50 dB (near silence) -> 0 to -10 dB -> 1.
// A plain RMS would leave the orb almost still for normal speech.
const readLevel = (analyser, samples) => {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms < 1e-5) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 50) / 40));
};

// The theme's accent colour, sindoor red (it differs between light and dark).
const primaryColour = () => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#c8321a";

// Voice-call orb: a soft "liquid" blob that swells and ripples with the other
// person's voice. Canvas 2D, no library. The stream is only analysed, never
// played here (the call's <audio> element plays it). Decorative, so hidden
// from screen readers; with reduced motion it stays still. data-level (0..1)
// exposes the current loudness for tests.
const VoiceOrb = ({ stream, size = 128 }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    ctx.scale(ratio, ratio);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let audio = null;
    let analyser = null;
    let samples = null;
    if (stream?.getAudioTracks().length) {
      audio = new AudioContext();
      analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      samples = new Float32Array(analyser.fftSize);
      audio.createMediaStreamSource(stream).connect(analyser); // analysed, not played
      audio.resume().catch(() => {});
    }

    let level = 0;
    let colour = primaryColour();
    let frame = 0;
    let animation = 0;
    const centre = size / 2;
    // Room around the blob so it can swell and glow without being cut off by
    // the canvas edge: at most ~0.34 of the size from the centre, plus glow.
    const base = size * 0.24;

    const draw = (time) => {
      if (analyser) level += (readLevel(analyser, samples) - level) * SMOOTHING;
      if (frame++ % 30 === 0) {
        colour = primaryColour(); // follows a theme switch during the call
        canvas.dataset.level = level.toFixed(3);
      }
      const t = reduceMotion ? 0 : time / 1000;
      const swell = reduceMotion ? 0 : level * 0.3;
      const ripple = reduceMotion ? 0 : 0.03 + level * 0.12;

      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const angle = (i / POINTS) * Math.PI * 2;
        // Three waves of different speed and shape make the edge look liquid.
        const wobble = Math.sin(angle * 3 + t * 1.7) * 0.5 + Math.sin(angle * 5 - t * 2.3) * 0.3 + Math.sin(angle * 2 + t * 0.9) * 0.2;
        const radius = base * (1 + swell + wobble * ripple);
        const x = centre + Math.cos(angle) * radius;
        const y = centre + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const gradient = ctx.createRadialGradient(centre - base * 0.3, centre - base * 0.3, base * 0.1, centre, centre, base * 1.4);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      gradient.addColorStop(0.35, colour);
      gradient.addColorStop(1, colour);
      ctx.fillStyle = gradient;
      ctx.shadowColor = colour;
      ctx.shadowBlur = reduceMotion ? 10 : 8 + level * 12; // glows more while they speak
      ctx.globalAlpha = 0.9;
      ctx.fill();

      if (!reduceMotion || analyser) animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animation);
      audio?.close().catch(() => {});
    };
  }, [stream, size]);

  return <canvas ref={canvasRef} aria-hidden="true" data-voice-orb="" style={{ width: size, height: size }} />;
};

export default VoiceOrb;
