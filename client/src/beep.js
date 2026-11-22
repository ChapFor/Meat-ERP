// Audible scan feedback: one short high beep = good, three low beeps = refused.
let ctx;
function tone(freq, start, dur) {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq; o.type = 'square';
  g.gain.value = 0.15;
  o.connect(g); g.connect(ctx.destination);
  o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
}
export const beepOk = () => { try { tone(1800, 0, 0.08); } catch {} };
export const beepBad = () => { try { [0, 0.18, 0.36].forEach((s) => tone(300, s, 0.12)); } catch {} };
