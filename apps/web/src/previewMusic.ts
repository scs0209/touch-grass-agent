import type { Sky } from './WeatherPanel';

export type Mood = 'bright' | 'mellow' | 'lofi' | 'night';

export function moodFor(sky: Sky, isDay: boolean): Mood {
  if (sky === 'rain' || sky === 'drizzle' || sky === 'thunder') return 'lofi';
  if (!isDay) return 'night';
  if (sky === 'cloudy' || sky === 'fog' || sky === 'snow') return 'mellow';
  return 'bright';
}

export const BPM: Record<Mood, number> = { bright: 112, mellow: 100, lofi: 86, night: 92 };

/** Four chords per mood as MIDI notes, one chord per bar. */
const PROGRESSIONS: Record<Mood, number[][]> = {
  bright: [[60, 64, 67], [67, 71, 74], [69, 72, 76], [65, 69, 72]],
  mellow: [[65, 69, 72, 76], [67, 71, 74], [64, 67, 71], [69, 72, 76]],
  lofi: [[69, 72, 76, 79], [65, 69, 72, 76], [60, 64, 67, 71], [67, 71, 74, 77]],
  night: [[62, 65, 69, 72], [67, 71, 74, 77], [60, 64, 67, 71], [57, 60, 64, 67]],
};

const TONE_CUTOFF_HZ: Record<Mood, number> = { bright: 9000, mellow: 5000, lofi: 1800, night: 2600 };
const MASTER_LEVEL = 0.7;

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export interface Music {
  stop(): void;
}

/** Schedules the whole track at once; the story is short and fixed, so no live scheduler is needed. */
export function playMusic(ctx: AudioContext, mood: Mood, startAt: number, durationSec: number, outputs: AudioNode[]): Music {
  const end = startAt + durationSec;
  const beat = 60 / BPM[mood];

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, startAt);
  master.gain.exponentialRampToValueAtTime(MASTER_LEVEL, startAt + 0.4);
  master.gain.setValueAtTime(MASTER_LEVEL, end - 1.5);
  master.gain.linearRampToValueAtTime(0, end);
  outputs.forEach((output) => master.connect(output));

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = TONE_CUTOFF_HZ[mood];
  tone.connect(master);

  const noise = noiseBuffer(ctx);

  function envelope(t: number, peak: number, attack: number, release: number) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    gain.connect(tone);
    return gain;
  }

  function oscillator(type: OscillatorType, frequency: number, t: number, length: number, target: AudioNode) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(target);
    osc.start(t);
    osc.stop(t + length + 0.05);
    return osc;
  }

  function noiseHit(t: number, filterType: BiquadFilterType, frequency: number, peak: number, release: number) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    source.connect(filter).connect(envelope(t, peak, 0.002, release));
    source.start(t);
    source.stop(t + release + 0.05);
  }

  function pad(chord: number[], t: number, length: number) {
    const level = mood === 'bright' ? 0.035 : 0.045;
    for (const note of chord) {
      for (const detune of [-6, 6]) {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.2);
        gain.gain.setValueAtTime(level, t + length - 0.25);
        gain.gain.linearRampToValueAtTime(0.0001, t + length);
        gain.connect(tone);
        oscillator(mood === 'lofi' ? 'sine' : 'triangle', hz(note), t, length, gain).detune.value = detune;
      }
    }
  }

  function kick(t: number) {
    const osc = oscillator('sine', 140, t, 0.3, envelope(t, 0.9, 0.003, 0.3));
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  }

  const bars = Math.ceil(durationSec / (beat * 4));
  const swing = mood === 'lofi' ? beat * 0.08 : 0;
  for (let bar = 0; bar < bars; bar++) {
    const chord = PROGRESSIONS[mood][bar % 4];
    const barStart = startAt + bar * 4 * beat;
    pad(chord, barStart, 4 * beat);

    for (let step = 0; step < 4; step++) {
      const t = barStart + step * beat;
      if (t >= end - beat) break;
      oscillator('sine', hz(chord[0] - 24), t, beat * 0.9, envelope(t, 0.3, 0.01, beat * 0.85));
      if (step % 2 === 0) kick(t);
      if (step % 2 === 1 && mood !== 'night') noiseHit(t, 'bandpass', 1800, mood === 'lofi' ? 0.18 : 0.3, 0.18);
      if (step % 2 === 1 && mood === 'night') noiseHit(t, 'highpass', 3000, 0.12, 0.04);
      for (const offset of [0, beat / 2 + swing]) noiseHit(t + offset, 'highpass', 5000, 0.06, 0.05);
      if (mood === 'bright' || mood === 'mellow') {
        for (const [index, offset] of [0, beat / 2].entries()) {
          const note = chord[(step * 2 + index) % chord.length] + 12;
          oscillator('square', hz(note), t + offset, 0.25, envelope(t + offset, 0.025, 0.005, 0.22));
        }
      }
    }
  }

  if (mood === 'lofi') {
    const crackle = ctx.createBufferSource();
    crackle.buffer = noise;
    crackle.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    crackle.connect(filter).connect(gain).connect(master);
    crackle.start(startAt);
    crackle.stop(end);
  }

  return {
    stop() {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.disconnect();
    },
  };
}

function noiseBuffer(ctx: AudioContext) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
