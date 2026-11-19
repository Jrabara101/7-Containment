export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;
  private muted = false;
  private alarmTimer: number | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.buildNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setVolume(vol: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  public stopAllLoops(): void {
    if (this.alarmTimer !== null) {
      window.clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
  }

  public playGunshot(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const jitter = 0.94 + Math.random() * 0.12;

    // Sharp punchy noise crack
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400 * jitter, now);
    bp.frequency.exponentialRampToValueAtTime(280, now + 0.14);
    bp.Q.value = 0.8;

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.65, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    noise.connect(bp).connect(nGain).connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.18);

    // Low-end thump
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.11);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.5, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oGain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playDryFire(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.03);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const clicks = [0, 0.22, 0.55];
    const freqs = [480, 620, 820];
    clicks.forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freqs[idx], now + offset);
      osc.frequency.exponentialRampToValueAtTime(220, now + offset + 0.05);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain).connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.07);
    });
  }

  public playWrenchSwing(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(880, now + 0.07);
    filter.frequency.exponentialRampToValueAtTime(240, now + 0.17);
    filter.Q.value = 1.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  public playWrenchHit(metallic = true): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = metallic ? 'triangle' : 'sawtooth';
    const baseFreq = metallic ? 440 + Math.random() * 80 : 150 + Math.random() * 30;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playFootstep(sprint: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const jitter = 0.92 + Math.random() * 0.16;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime((sprint ? 480 : 360) * jitter, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(sprint ? 0.14 : 0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    noise.connect(lp).connect(gain).connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.08);
  }

  public playDoorHiss(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(2200, now);
    hp.frequency.linearRampToValueAtTime(1200, now + 0.35);
    hp.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    noise.connect(hp).connect(gain).connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.4);
  }

  public playAlarmBurst(pulses = 5): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.stopAllLoops();
    let count = 0;
    const firePulse = () => {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.linearRampToValueAtTime(520, now + 0.28);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.24, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      osc.connect(lp).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.36);
      count++;
      if (count >= pulses) {
        this.stopAllLoops();
      }
    };
    firePulse();
    this.alarmTimer = window.setInterval(firePulse, 520);
  }

  public playVentClatter(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [0, 0.14, 0.24].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(340 - i * 45, now + offset);
      osc.frequency.exponentialRampToValueAtTime(110, now + offset + 0.1);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22 / (i + 1), now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
      osc.connect(gain).connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.13);
    });
  }

  public playEnemyGrowl(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 115 + Math.random() * 25;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.linearRampToValueAtTime(base * 1.25, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(base * 0.65, now + 0.36);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playEnemyHit(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playEnemyDeath(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + 0.75);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.85, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    noise.connect(lp).connect(nGain).connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.9);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.75, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    sub.connect(sGain).connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.6);
  }

  public playPickup(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.07);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playPlayerHurt(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playPaChime(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [587.33, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, now + idx * 0.14);
      gain.gain.linearRampToValueAtTime(0.16, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.35);
      osc.connect(gain).connect(this.masterGain!);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.38);
    });
  }

  public playSaveConfirm(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 1046.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.28);
      osc.connect(gain).connect(this.masterGain!);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.3);
    });
  }

  public playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.45);
      osc.connect(gain).connect(this.masterGain!);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.48);
    });
  }

  public dispose(): void {
    this.stopAllLoops();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
