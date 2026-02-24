
import { SoundService } from '../services/contracts';

// A simple web-audio synth implementation.
class WebSoundManager implements SoundService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private bgmOscillators: OscillatorNode[] = [];
  private bgmGain: GainNode | null = null;
  private isBgmPlaying: boolean = false;
  private didUnlock: boolean = false;

  constructor() {
    // Intentionally empty.
  }

  // Call this on the FIRST user interaction (e.g. Game Start button or Touch)
  // This is critical for iOS Safari to unlock audio.
  init() {
    if (!this.ctx) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.ctx = new AudioContextClass({ latencyHint: 'interactive' } as AudioContextOptions);
        }
      } catch (e) {
        console.error("Web Audio API not supported", e);
      }
    }

    this.resume();
  }

  // Helper to force resume context (iOS Safari fix)
  resume() {
    if (this.ctx) {
        // 1. Resume context if suspended
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        // 2. iOS Unlock Trick: Play a short silent buffer
        // This forces the audio hardware to wake up immediately within the interaction event.
        if (!this.didUnlock) {
          try {
              const buffer = this.ctx.createBuffer(1, 1, 22050);
              const source = this.ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(this.ctx.destination);
              source.start(0);
              this.didUnlock = true;
          } catch {
              // Ignore errors here
          }
        }
    }
  }

  private ensureContext() {
    // Just a fallback, but init() should be called explicitly first via user interaction.
    if (!this.ctx) {
        this.init();
    } else {
        // Always try to resume if suspended
        this.resume();
    }
  }

  // iOS WebView can stay suspended for a short moment after touch.
  // Run sound logic only when AudioContext is actually running.
  private withRunningContext(action: (ctx: AudioContext) => void) {
    this.ensureContext();
    if (!this.ctx) return;

    const ctx = this.ctx;
    if (ctx.state === 'running') {
      action(ctx);
      return;
    }

    ctx.resume()
      .then(() => {
        this.resume();
        if (ctx.state === 'running') {
          action(ctx);
        }
      })
      .catch(() => {
        // No-op
      });
  }

  // --- Haptic Feedback Helper ---
  private vibrate(pattern: number | number[]) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Ignore
        }
    }
  }

  toggleMute() {
    this.ensureContext(); // Ensure context exists when toggling
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopBGM();
    } else {
      this.playBGM();
    }
    return this.isMuted;
  }

  playSelect() {
    this.vibrate(10); 
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    });
  }

  playMatchSuccess() {
    this.vibrate([10, 30, 10]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major
      notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      const startTime = ctx.currentTime + (i * 0.05);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      
      osc.start(startTime);
      osc.stop(startTime + 0.3);
      });
    });
  }

  playStoreSuccess() {
    this.vibrate([50, 50, 100]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
      // "Coin" / Cash register sound
      const notes = [880, 1760]; 
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + (i * 0.1));
        
        const startTime = ctx.currentTime + (i * 0.1);
        gain.gain.setValueAtTime(0.05, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
        
        osc.start(startTime);
        osc.stop(startTime + 0.1);
      });
    });
  }

  playError() {
    this.vibrate([50, 50, 50]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    });
  }

  playGameOver() {
    this.vibrate([60, 40, 80]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
    const now = ctx.currentTime;
    const notes = [220, 196, 174, 146];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'square';
      const start = now + i * 0.09;
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.82), start + 0.12);

      gain.gain.setValueAtTime(0.09, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

      osc.start(start);
      osc.stop(start + 0.12);
    });
    });
  }

  playLevelComplete() {
    this.vibrate([20, 30, 20, 30, 50]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; 
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = ctx.currentTime + (i * 0.1);
        gain.gain.setValueAtTime(0.1, start);
        gain.gain.linearRampToValueAtTime(0, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    });
  }

  playEndingCelebration() {
    this.vibrate([30, 20, 30, 20, 60, 40, 60]);
    if (this.isMuted) return;
    this.withRunningContext((ctx) => {
    const now = ctx.currentTime;
    // Fanfare chord stack
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';

      const start = now + i * 0.03;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.start(start);
      osc.stop(start + 0.45);
    });

    // Clap-like bright ticks
    const clapTimes = [0.08, 0.16, 0.31, 0.44, 0.58, 0.72];
    clapTimes.forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(1800, now + t);
      osc.frequency.exponentialRampToValueAtTime(850, now + t + 0.03);
      gain.gain.setValueAtTime(0.045, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.04);
      osc.start(now + t);
      osc.stop(now + t + 0.04);
    });
    });
  }

  playBGM() {
    if (this.isMuted || this.isBgmPlaying) return;
    this.ensureContext();
    if (!this.ctx) return;
    
    this.isBgmPlaying = true;
    // Simple placeholder for BGM
  }

  stopBGM() {
    this.isBgmPlaying = false;
  }
}

export const soundService: SoundService = new WebSoundManager();
// Backward compatibility for existing imports.
export const soundManager = soundService;
