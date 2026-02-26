
import { SoundDebugState, SoundService } from '../services/contracts';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __DANGDANG_SOUND_DEBUG__?: SoundDebugState;
  }
}

type NativeSoundEvent =
  | 'select'
  | 'match'
  | 'store'
  | 'error'
  | 'gameover'
  | 'levelcomplete'
  | 'ending';

// A simple web-audio synth implementation.
class WebSoundManager implements SoundService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private bgmOscillators: OscillatorNode[] = [];
  private bgmGain: GainNode | null = null;
  private isBgmPlaying: boolean = false;
  private didUnlock: boolean = false;
  private isRNWebView: boolean;
  private debug: SoundDebugState;

  constructor() {
    this.isRNWebView = this.detectRNWebView();
    this.debug = {
      mode: this.isRNWebView ? 'rn-bridge' : 'web-audio',
      contextState: 'none',
      unlocked: false,
      lastResume: null,
      lastError: null,
    };
    this.publishDebug();
    this.attachLifecycleResumeHandlers();
  }

  // Call this on the FIRST user interaction (e.g. Game Start button or Touch)
  // This is critical for iOS Safari to unlock audio.
  init() {
    if (this.isRNWebView) return;
    this.forceUnlockFromUserGesture('init');
  }

  // Helper to force resume context (iOS Safari fix)
  resume() {
    if (this.isRNWebView) return;
    if (!this.ctx) {
      this.createAudioContext();
    }
    if (!this.ctx) {
      this.updateDebug({ contextState: 'none' });
      return;
    }
    this.resumeContext('manual-resume');
  }

  private ensureContext() {
    if (this.isRNWebView) return;
    this.createAudioContext();
    this.resume();
  }

  private detectRNWebView() {
    return typeof window !== 'undefined' && typeof window.ReactNativeWebView?.postMessage === 'function';
  }

  private isReactNativeWebView() {
    return this.isRNWebView;
  }

  private sendNativeSound(event: NativeSoundEvent) {
    if (!this.isReactNativeWebView()) return;
    try {
      window.ReactNativeWebView!.postMessage!(
        JSON.stringify({
          source: 'dangdangpang',
          type: 'PLAY_SOUND',
          sound: event,
          ts: Date.now(),
        })
      );
    } catch {
      // No-op
    }
  }

  private createAudioContext() {
    if (this.isRNWebView || this.ctx) return this.ctx;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        this.updateDebug({ lastError: 'AudioContext unavailable', contextState: 'none' });
        return null;
      }
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' } as AudioContextOptions);
      this.updateDebug({
        contextState: this.ctx.state,
        lastError: null,
      });
      return this.ctx;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({ lastError: `AudioContext create failed: ${message}`, contextState: 'none' });
      return null;
    }
  }

  private resumeContext(reason: string) {
    if (!this.ctx) return;
    this.updateDebug({ contextState: this.ctx.state });
    if (this.ctx.state === 'running') {
      this.updateDebug({
        unlocked: this.didUnlock,
        lastResume: { ok: true, at: Date.now(), reason },
        lastError: null,
      });
      return;
    }
    try {
      const resumePromise = this.ctx.resume();
      void resumePromise
        .then(() => {
          this.updateDebug({
            contextState: this.ctx?.state ?? 'none',
            lastResume: { ok: true, at: Date.now(), reason },
            lastError: null,
          });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.updateDebug({
            contextState: this.ctx?.state ?? 'none',
            lastResume: { ok: false, at: Date.now(), reason, error: message },
            lastError: `resume failed: ${message}`,
          });
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({
        contextState: this.ctx?.state ?? 'none',
        lastResume: { ok: false, at: Date.now(), reason, error: message },
        lastError: `resume throw: ${message}`,
      });
    }
  }

  forceUnlockFromUserGesture(reason = 'gesture') {
    if (this.isRNWebView) return;
    const ctx = this.createAudioContext();
    if (!ctx) return;

    // Keep resume call in the same user gesture stack (do not await here).
    this.resumeContext(`unlock:${reason}`);

    // Gesture-stack unlock pulse: very short near-silent oscillator + silent buffer.
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);

      const buffer = ctx.createBuffer(1, 128, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);

      this.didUnlock = true;
      this.updateDebug({
        unlocked: true,
        contextState: ctx.state,
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({
        contextState: ctx.state,
        lastError: `unlock pulse failed: ${message}`,
      });
    }
  }

  getDebugState() {
    return { ...this.debug };
  }

  private updateDebug(partial: Partial<SoundDebugState>) {
    this.debug = { ...this.debug, ...partial };
    this.publishDebug();
  }

  private publishDebug() {
    if (typeof window === 'undefined') return;
    window.__DANGDANG_SOUND_DEBUG__ = { ...this.debug };
    window.dispatchEvent(new CustomEvent('dangdang:sound-debug', { detail: { ...this.debug } }));
  }

  private attachLifecycleResumeHandlers() {
    if (typeof window === 'undefined' || this.isRNWebView) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        this.resumeContext('visibilitychange');
      }
    };
    const onPageShow = () => this.resumeContext('pageshow');
    const onFocus = () => this.resumeContext('focus');
    const onPageHide = () => {
      this.updateDebug({ contextState: this.ctx?.state ?? 'none' });
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          this.resumeContext('pagehide-recovery');
        }
      }, 120);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
  }

  // iOS WebView can stay suspended for a short moment after touch.
  // Run sound logic only when AudioContext is actually running.
  private withRunningContext(action: (ctx: AudioContext) => void) {
    if (this.isRNWebView) return;
    this.ensureContext();
    if (!this.ctx) return;

    const ctx = this.ctx;
    if (ctx.state === 'running') {
      action(ctx);
      return;
    }

    // Important for iOS WebView:
    // attempt resume inside the same user gesture call, then run action immediately.
    // If resume settles slightly later, fire one retry.
    try {
      const resumePromise = ctx.resume();
      action(ctx);
      resumePromise
        .then(() => {
          this.resume();
          if (ctx.state === 'running') {
            action(ctx);
          }
        })
        .catch(() => {
          // No-op
        });
    } catch {
      action(ctx);
    }
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
    if (!this.isRNWebView) {
      this.ensureContext();
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('select');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('match');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('store');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('error');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('gameover');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('levelcomplete');
      return;
    }
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
    if (this.isReactNativeWebView()) {
      this.sendNativeSound('ending');
      return;
    }
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
    if (this.isRNWebView) return;
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
