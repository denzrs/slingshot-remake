/** Tiny synthesized sound set — no audio files needed. */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Browsers only allow audio after a user gesture; call this from input handlers. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  fire(power: number): void {
    const a = this.begin();
    if (!a) return;
    this.tone(55 + power * 0.8, 38, 0.18, 0.5, 'sine', a.t);
    this.hiss(a.t, 0.22, 0.28, 2400, 500);
  }

  impact(): void {
    const a = this.begin();
    if (!a) return;
    this.tone(110, 40, 0.3, 0.45, 'sine', a.t);
    this.hiss(a.t, 0.3, 0.35, 900, 120);
  }

  explode(): void {
    const a = this.begin();
    if (!a) return;
    this.tone(70, 24, 0.9, 0.8, 'sine', a.t);
    this.hiss(a.t, 1.3, 0.7, 3000, 80);
    this.tone(180, 60, 0.25, 0.2, 'sawtooth', a.t);
  }

  fizzle(): void {
    const a = this.begin();
    if (!a) return;
    this.tone(520, 180, 0.35, 0.08, 'triangle', a.t);
  }

  blip(): void {
    const a = this.begin();
    if (!a) return;
    this.tone(880, 880, 0.05, 0.05, 'square', a.t);
  }

  select(): void {
    const a = this.begin();
    if (!a) return;
    this.tone(660, 990, 0.09, 0.07, 'square', a.t);
  }

  private begin(): { ctx: AudioContext; t: number } | null {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, t: this.ctx.currentTime };
  }

  private tone(from: number, to: number, dur: number, vol: number, type: OscillatorType, t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, vol: number, fromHz: number, toHz: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(fromHz, t);
    f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
