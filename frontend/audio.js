const preferenceKey = 'homepoker-audio';
let enabled = true;
try { enabled = localStorage.getItem(preferenceKey) !== 'off'; } catch {}

let context;
let shuffle;
let chips;
let output;

export const audioEnabled = () => enabled;

export function enableAudio() {
  if (!enabled) return;
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) return;
  try {
    if (!context) {
      context = new Audio();
      output = context.createGain();
      output.connect(context.destination);
      const frames = Math.round(context.sampleRate * .15);
      shuffle = context.createBuffer(1,frames,context.sampleRate);
      const data = shuffle.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const progress = i / frames;
        const brush = Math.min(1,progress * 30) * Math.exp(-progress * 6);
        const tap = Math.exp(-Math.abs(progress - .52) * 80) * .45;
        data[i] = (Math.random() * 2 - 1) * (brush + tap);
      }
      chips = context.createBuffer(1,frames,context.sampleRate);
      const clink = chips.getChannelData(0);
      for (const [delay,frequency,volume] of [[.004,1720,.85],[.046,1080,.5],[.094,1460,.3]]) {
        const start = Math.round(delay * context.sampleRate);
        for (let i = start; i < frames; i++) {
          const time = (i-start) / context.sampleRate;
          const resonance = Math.sin(2 * Math.PI * frequency * time) * .58;
          const impact = (Math.random() * 2 - 1) * .38 * Math.exp(-time * 180);
          clink[i] += (resonance + impact) * Math.exp(-time * 95) * volume;
        }
      }
    }
    output.gain.value = 1;
    if (context.state === 'suspended') context.resume().catch(() => {});
  } catch {}
}

export function toggleAudio() {
  enabled = !enabled;
  try { localStorage.setItem(preferenceKey,enabled ? 'on' : 'off'); } catch {}
  if (enabled) enableAudio();
  else if (output) output.gain.value = 0;
}

export function playCards(count) {
  if (!enabled || document.hidden || context?.state !== 'running') return;
  const time = context.currentTime;
  for (let i = 0; i < count; i++) {
    const source = context.createBufferSource();
    source.buffer = shuffle;
    source.playbackRate.value = 1 + i * .065;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1450 + i * 160;
    const level = context.createGain();
    level.gain.value = .26;
    source.connect(filter).connect(level).connect(output);
    source.start(time + i * .13);
  }
}

export function playVictory() {
  if (!enabled || document.hidden || context?.state !== 'running') return;
  const start = context.currentTime;
  const tune = [[0,72,.18],[.18,76,.18],[.36,79,.23],[.59,84,.7],
    [.59,72,.7],[.59,76,.7],[.59,79,.7]];
  for (const [delay,note,length] of tune) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + delay;
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(.065,at + .025);
    gain.gain.exponentialRampToValueAtTime(.0001,at + length);
    oscillator.connect(gain).connect(output);
    oscillator.start(at);
    oscillator.stop(at + length);
  }
}

export function playChips(count) {
  if (!enabled || document.hidden || context?.state !== 'running') return;
  const start = context.currentTime;
  for (let i = 0; i < count; i++) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = chips;
    gain.gain.value = .23;
    source.connect(gain).connect(output);
    source.start(start + i * .16);
  }
}
