import { SoundDebugState, SoundService } from '../services/contracts';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __DANGDANG_SOUND_DEBUG__?: SoundDebugState;
    __DANGDANG_AUDIO_TRACE__?: Array<{ at: number; tag: string; detail?: string }>;
    __DANGDANG_DUMP_AUDIO_TRACE__?: () => Array<{ at: number; tag: string; detail?: string }>;
  }
}

type SoundEvent = 'select' | 'match' | 'store' | 'error' | 'gameover' | 'levelcomplete' | 'ending';
type AudioBackend = 'web-audio' | 'html5-audio' | 'rn-bridge';

const MUTE_STORAGE_KEY = 'dangdangpang:isMuted';
const AUDIO_TRACE_STORAGE_KEY = 'dangdangpang:audio_trace';
const HTML_POOL_SIZE = 8;
const HTML_AUDIO_VERSION = '20260226-1';
const HTML_AUDIO_SRC: Record<SoundEvent, string> = {
  select: `/sfx/select.mp3?v=${HTML_AUDIO_VERSION}`,
  match: `/sfx/match.mp3?v=${HTML_AUDIO_VERSION}`,
  store: `/sfx/store.mp3?v=${HTML_AUDIO_VERSION}`,
  error: `/sfx/error.mp3?v=${HTML_AUDIO_VERSION}`,
  gameover: `/sfx/gameover.mp3?v=${HTML_AUDIO_VERSION}`,
  levelcomplete: `/sfx/levelcomplete.mp3?v=${HTML_AUDIO_VERSION}`,
  ending: `/sfx/ending.mp3?v=${HTML_AUDIO_VERSION}`,
};

class WebSoundManager implements SoundService {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private storedMutedValue: string | null = null;
  private didUnlock = false;
  private backend: AudioBackend;
  private debug: SoundDebugState;

  private masterGainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private forceMasterGain = false;
  private rmsTimer: number | null = null;

  private htmlAudioPools: Partial<Record<SoundEvent, HTMLAudioElement[]>> = {};
  private htmlPoolCursor: Record<SoundEvent, number> = {
    select: 0,
    match: 0,
    store: 0,
    error: 0,
    gameover: 0,
    levelcomplete: 0,
    ending: 0,
  };
  private htmlPoolReady = false;
  private htmlPoolWarmedUp = false;
  private traceEnabled = false;

  constructor() {
    this.storedMutedValue = this.readStoredMuted();
    this.isMuted = this.storedMutedValue === 'true';
    this.backend = this.detectBackend();
    this.traceEnabled = this.isTraceEnabled();
    this.debug = {
      mode: this.backend,
      contextState: 'none',
      unlocked: false,
      rms: 0,
      masterGain: this.getEffectiveVolume(),
      forceMasterGain: false,
      muted: this.isMuted,
      storedMuted: this.storedMutedValue,
      lastBeep: null,
      lastPlay: null,
      lastResume: null,
      lastError: null,
    };

    if (this.backend === 'html5-audio') {
      this.ensureHtmlAudioPools();
    }
    if (this.backend === 'web-audio') {
      this.attachLifecycleResumeHandlers();
    }
    this.publishDebug();
    this.trace('construct', `backend=${this.backend} muted=${this.isMuted}`);
  }

  init() {
    this.trace('init', `backend=${this.backend}`);
    if (this.backend === 'rn-bridge') return;
    if (this.backend === 'html5-audio') {
      this.ensureHtmlAudioPools();
      this.warmupHtmlAudioPools();
      this.didUnlock = true;
      this.updateDebug({
        unlocked: true,
        lastResume: { ok: true, at: Date.now(), reason: 'html5-init' },
      });
      this.trace('init-html5', 'warmup done');
      return;
    }
    this.forceUnlockFromUserGesture('init');
  }

  resume() {
    this.trace('resume', `backend=${this.backend}`);
    if (this.backend === 'rn-bridge') return;
    if (this.backend === 'html5-audio') {
      this.updateDebug({
        lastResume: { ok: true, at: Date.now(), reason: 'html5-resume' },
      });
      return;
    }
    if (!this.ctx) this.createAudioContext();
    if (!this.ctx) {
      this.updateDebug({ contextState: 'none' });
      return;
    }
    this.resumeContext('manual-resume');
  }

  forceUnlockFromUserGesture(reason = 'gesture') {
    if (this.backend !== 'web-audio') return;
    const ctx = this.createAudioContext();
    if (!ctx) return;

    this.resumeContext(`unlock:${reason}`);
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      this.connectGainToOutput(gain);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
      this.didUnlock = true;
      this.updateDebug({ unlocked: true, contextState: ctx.state, lastError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({ lastError: `unlock pulse failed: ${message}` });
    }
  }

  debugBeep() {
    if (this.backend !== 'web-audio') {
      this.updateDebug({
        lastBeep: {
          started: false,
          stopped: false,
          at: Date.now(),
          error: `${this.backend} mode: web beep disabled`,
        },
      });
      return;
    }

    const ctx = this.createAudioContext();
    if (!ctx) return;
    this.resumeContext('debug-beep');
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        this.updateDebug({
          lastBeep: { started: true, stopped: true, at: Date.now() },
          lastError: null,
        });
      };
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      this.updateDebug({
        lastBeep: { started: true, stopped: false, at: Date.now() },
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({
        lastBeep: { started: false, stopped: false, at: Date.now(), error: message },
        lastError: `debug beep failed: ${message}`,
      });
    }
  }

  setDebugForceMasterGain(force: boolean) {
    this.forceMasterGain = force;
    if (this.backend === 'web-audio') {
      this.updateMasterGainValue();
    }
    if (this.backend === 'html5-audio') {
      this.syncHtmlAudioVolumes();
      this.updateDebug({
        masterGain: this.getEffectiveVolume(),
        forceMasterGain: this.forceMasterGain,
      });
    }
  }

  getDebugState() {
    return { ...this.debug };
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.writeStoredMuted(this.isMuted);
    if (this.backend === 'web-audio') {
      this.updateMasterGainValue();
    }
    if (this.backend === 'html5-audio') {
      this.syncHtmlAudioVolumes();
    }
    this.updateDebug({
      muted: this.isMuted,
      storedMuted: this.storedMutedValue,
      masterGain: this.getEffectiveVolume(),
    });
    return this.isMuted;
  }

  playSelect() {
    this.vibrate(10);
    this.playSound('select', (ctx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      this.connectGainToOutput(gain);
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
    this.playSound('match', (ctx) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        this.connectGainToOutput(gain);
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const startTime = ctx.currentTime + i * 0.05;
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
    this.playSound('store', (ctx) => {
      const notes = [880, 1760];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        this.connectGainToOutput(gain);
        osc.type = 'square';
        const startTime = ctx.currentTime + i * 0.1;
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.05, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
        osc.start(startTime);
        osc.stop(startTime + 0.1);
      });
    });
  }

  playError() {
    this.vibrate([50, 50, 50]);
    this.playSound('error', (ctx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      this.connectGainToOutput(gain);
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
    this.playSound('gameover', (ctx) => {
      const now = ctx.currentTime;
      const notes = [220, 196, 174, 146];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        this.connectGainToOutput(gain);
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
    this.playSound('levelcomplete', (ctx) => {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        this.connectGainToOutput(gain);
        osc.type = 'sine';
        const start = ctx.currentTime + i * 0.1;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, start);
        gain.gain.linearRampToValueAtTime(0, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    });
  }

  playEndingCelebration() {
    this.vibrate([30, 20, 30, 20, 60, 40, 60]);
    this.playSound('ending', (ctx) => {
      const now = ctx.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        this.connectGainToOutput(gain);
        osc.type = 'triangle';
        const start = now + i * 0.03;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    });
  }

  playBGM() {
    // Not used currently.
  }

  stopBGM() {
    // Not used currently.
  }

  private playSound(event: SoundEvent, webAudioAction: (ctx: AudioContext) => void) {
    if (this.isMuted && !this.forceMasterGain) return;
    this.trace('play-request', `event=${event} backend=${this.backend} muted=${this.isMuted}`);

    if (this.backend === 'rn-bridge') {
      this.sendNativeSound(event);
      this.updateDebug({
        lastPlay: {
          ok: true,
          at: Date.now(),
          backend: 'rn-bridge',
          sound: event,
          message: 'posted PLAY_SOUND to RN',
        },
      });
      return;
    }

    if (this.backend === 'html5-audio') {
      this.playHtmlSound(event);
      return;
    }

    this.withRunningContext((ctx) => {
      webAudioAction(ctx);
      this.updateDebug({
        lastPlay: {
          ok: true,
          at: Date.now(),
          backend: 'web-audio',
          sound: event,
          message: 'oscillator path executed',
        },
      });
    });
  }

  private playHtmlSound(event: SoundEvent, allowRetry = true) {
    this.ensureHtmlAudioPools();
    const pool = this.htmlAudioPools[event];
    if (!pool || pool.length === 0) {
      this.trace('html-pool-missing', `event=${event}`);
      this.updateDebug({
        lastPlay: {
          ok: false,
          at: Date.now(),
          backend: 'html5-audio',
          sound: event,
          message: 'audio pool missing',
        },
        lastError: `html pool missing: ${event}`,
      });
      return;
    }

    const audio = this.pickHtmlAudioInstance(event, pool);
    const index = pool.indexOf(audio);
    this.trace(
      'html-pick',
      `event=${event} idx=${index} ready=${audio.readyState} paused=${audio.paused} ended=${audio.ended} t=${audio.currentTime.toFixed?.(3) ?? audio.currentTime}`
    );
    audio.volume = this.getEffectiveVolume();
    audio.muted = this.isMuted && !this.forceMasterGain;
    try {
      if (audio.readyState < 2) {
        try {
          audio.load();
        } catch {
          // no-op
        }
      }
      if (audio.readyState > 0 && (audio.paused || audio.ended)) {
        audio.currentTime = 0;
      }
      const promise = audio.play();
      if (promise && typeof promise.then === 'function') {
        void promise
          .then(() => {
            this.trace('html-play-ok', `event=${event} idx=${index}`);
            this.updateDebug({
              lastPlay: {
                ok: true,
                at: Date.now(),
                backend: 'html5-audio',
                sound: event,
                message: `pool#${index} play resolved`,
              },
              lastError: null,
            });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.trace('html-play-reject', `event=${event} idx=${index} err=${message}`);
            this.updateDebug({
              lastPlay: {
                ok: false,
                at: Date.now(),
                backend: 'html5-audio',
                sound: event,
                message: `pool#${index} play rejected: ${message}`,
              },
              lastError: `html5 play rejected: ${message}`,
            });
            if (allowRetry) {
              this.trace('html-retry', `event=${event} after=60ms`);
              window.setTimeout(() => this.playHtmlSound(event, false), 60);
            }
          });
      } else {
        this.trace('html-play-start', `event=${event} idx=${index}`);
        this.updateDebug({
          lastPlay: {
            ok: true,
            at: Date.now(),
            backend: 'html5-audio',
            sound: event,
            message: `pool#${index} play started`,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.trace('html-play-throw', `event=${event} idx=${index} err=${message}`);
      this.updateDebug({
        lastPlay: {
          ok: false,
          at: Date.now(),
          backend: 'html5-audio',
          sound: event,
          message: `pool#${index} exception: ${message}`,
        },
        lastError: `html5 play exception: ${message}`,
      });
      if (allowRetry) {
        this.trace('html-retry', `event=${event} after=60ms (throw)`);
        window.setTimeout(() => this.playHtmlSound(event, false), 60);
      }
    }
  }

  private ensureHtmlAudioPools() {
    if (this.backend !== 'html5-audio' || this.htmlPoolReady || typeof window === 'undefined') return;
    this.trace('html-pool-init', `size=${HTML_POOL_SIZE}`);
    (Object.keys(HTML_AUDIO_SRC) as SoundEvent[]).forEach((sound) => {
      this.htmlAudioPools[sound] = Array.from({ length: HTML_POOL_SIZE }).map(() => {
        const audio = new Audio(HTML_AUDIO_SRC[sound]);
        audio.preload = 'auto';
        audio.playsInline = true;
        audio.volume = this.getEffectiveVolume();
        audio.muted = this.isMuted && !this.forceMasterGain;
        audio.load();
        return audio;
      });
    });
    this.htmlPoolReady = true;
    this.trace('html-pool-ready');
    this.updateDebug({
      masterGain: this.getEffectiveVolume(),
      muted: this.isMuted,
      storedMuted: this.storedMutedValue,
      forceMasterGain: this.forceMasterGain,
    });
  }

  private pickHtmlAudioInstance(sound: SoundEvent, pool: HTMLAudioElement[]) {
    const start = this.htmlPoolCursor[sound] % pool.length;

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length;
      const candidate = pool[idx];
      if ((candidate.paused || candidate.ended) && candidate.readyState >= 2) {
        this.trace('pick-idle-ready', `sound=${sound} idx=${idx}`);
        this.htmlPoolCursor[sound] = (idx + 1) % pool.length;
        return candidate;
      }
    }

    for (let i = 0; i < pool.length; i++) {
      const idx = (start + i) % pool.length;
      const candidate = pool[idx];
      if (candidate.paused || candidate.ended) {
        this.trace('pick-idle', `sound=${sound} idx=${idx} ready=${candidate.readyState}`);
        this.htmlPoolCursor[sound] = (idx + 1) % pool.length;
        return candidate;
      }
    }

    const fallback = pool[start];
    this.trace('pick-fallback', `sound=${sound} idx=${start} ready=${fallback.readyState}`);
    this.htmlPoolCursor[sound] = (start + 1) % pool.length;
    return fallback;
  }

  private warmupHtmlAudioPools() {
    if (this.backend !== 'html5-audio' || this.htmlPoolWarmedUp) return;
    this.htmlPoolWarmedUp = true;
    this.trace('warmup-start');
    (Object.keys(HTML_AUDIO_SRC) as SoundEvent[]).forEach((sound) => {
      const primer = new Audio(HTML_AUDIO_SRC[sound]);
      primer.preload = 'auto';
      primer.playsInline = true;
      primer.muted = true;
      primer.volume = 0;
      try {
        const p = primer.play();
        if (p && typeof p.then === 'function') {
          void p
            .then(() => {
              this.trace('warmup-ok', sound);
              primer.pause();
              primer.currentTime = 0;
              primer.src = '';
            })
            .catch(() => {
              this.trace('warmup-reject', sound);
              primer.src = '';
            });
        }
      } catch {
        this.trace('warmup-throw', sound);
        primer.src = '';
      }
    });
  }

  private syncHtmlAudioVolumes() {
    if (this.backend !== 'html5-audio') return;
    (Object.keys(this.htmlAudioPools) as SoundEvent[]).forEach((sound) => {
      const pool = this.htmlAudioPools[sound];
      if (!pool) return;
      pool.forEach((audio) => {
        audio.volume = this.getEffectiveVolume();
        audio.muted = this.isMuted && !this.forceMasterGain;
      });
    });
  }

  private withRunningContext(action: (ctx: AudioContext) => void) {
    if (this.backend !== 'web-audio') return;
    this.ensureContext();
    if (!this.ctx) return;

    const ctx = this.ctx;
    if (ctx.state === 'running') {
      action(ctx);
      return;
    }

    try {
      const resumePromise = ctx.resume();
      action(ctx);
      void resumePromise.then(() => {
        this.resume();
        if (ctx.state === 'running') action(ctx);
      });
    } catch {
      action(ctx);
    }
  }

  private ensureContext() {
    if (this.backend !== 'web-audio') return;
    this.createAudioContext();
    this.resume();
  }

  private createAudioContext() {
    if (this.backend !== 'web-audio' || this.ctx) return this.ctx;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        this.updateDebug({ lastError: 'AudioContext unavailable', contextState: 'none' });
        return null;
      }
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' } as AudioContextOptions);
      this.ensureOutputNodes(this.ctx);
      this.updateMasterGainValue();
      this.updateDebug({ contextState: this.ctx.state, lastError: null });
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

  private ensureOutputNodes(ctx: AudioContext) {
    if (this.masterGainNode && this.analyserNode) return;
    this.masterGainNode = ctx.createGain();
    this.masterGainNode.gain.value = this.getEffectiveVolume();
    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.masterGainNode.connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);
    this.startRmsMonitor();
  }

  private connectGainToOutput(gain: GainNode) {
    if (!this.ctx) return;
    this.ensureOutputNodes(this.ctx);
    if (this.masterGainNode) {
      gain.connect(this.masterGainNode);
      return;
    }
    gain.connect(this.ctx.destination);
  }

  private updateMasterGainValue() {
    if (!this.masterGainNode || !this.ctx) {
      this.updateDebug({
        masterGain: this.getEffectiveVolume(),
        forceMasterGain: this.forceMasterGain,
        muted: this.isMuted,
      });
      return;
    }
    const value = this.getEffectiveVolume();
    this.masterGainNode.gain.setValueAtTime(value, this.ctx.currentTime);
    this.updateDebug({
      masterGain: value,
      forceMasterGain: this.forceMasterGain,
      muted: this.isMuted,
    });
  }

  private getEffectiveVolume() {
    if (this.forceMasterGain) return 1;
    if (this.isMuted) return 0;
    return 1;
  }

  private startRmsMonitor() {
    if (typeof window === 'undefined') return;
    if (this.rmsTimer !== null) return;
    this.rmsTimer = window.setInterval(() => {
      if (!this.analyserNode) {
        this.updateDebug({ rms: 0 });
        return;
      }
      const data = new Float32Array(this.analyserNode.fftSize);
      this.analyserNode.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
      }
      this.updateDebug({ rms: Math.sqrt(sum / data.length) });
    }, 140);
  }

  private detectBackend(): AudioBackend {
    if (typeof window === 'undefined') return 'web-audio';
    if (typeof window.ReactNativeWebView?.postMessage === 'function') return 'rn-bridge';

    const ua = window.navigator.userAgent || '';
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isMacTouch = /Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
    if (isiOS || isMacTouch) return 'html5-audio';
    return 'web-audio';
  }

  private isTraceEnabled() {
    if (typeof window === 'undefined') return false;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('audioTrace') === '1') return true;
      return window.localStorage.getItem(AUDIO_TRACE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private trace(tag: string, detail?: string) {
    if (typeof window === 'undefined' || !this.traceEnabled) return;
    const entry = { at: Date.now(), tag, detail };
    const prev = window.__DANGDANG_AUDIO_TRACE__ ?? [];
    const next = [...prev, entry].slice(-120);
    window.__DANGDANG_AUDIO_TRACE__ = next;
    window.__DANGDANG_DUMP_AUDIO_TRACE__ = () => [...(window.__DANGDANG_AUDIO_TRACE__ ?? [])];
    try {
      // eslint-disable-next-line no-console
      console.log('[DDP-AUDIO-TRACE]', entry);
    } catch {
      // no-op
    }
  }

  private sendNativeSound(event: SoundEvent) {
    try {
      window.ReactNativeWebView!.postMessage!(
        JSON.stringify({
          source: 'dangdangpang',
          type: 'PLAY_SOUND',
          sound: event,
          ts: Date.now(),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateDebug({
        lastPlay: {
          ok: false,
          at: Date.now(),
          backend: 'rn-bridge',
          sound: event,
          message,
        },
      });
    }
  }

  private readStoredMuted(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredMuted(value: boolean) {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, String(value));
      } catch {
        // No-op
      }
    }
    this.storedMutedValue = this.readStoredMuted();
  }

  private vibrate(pattern: number | number[]) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // No-op
      }
    }
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
    if (typeof window === 'undefined' || this.backend !== 'web-audio') return;
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
        if (document.visibilityState === 'visible') this.resumeContext('pagehide-recovery');
      }, 120);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
  }
}

export const soundService: SoundService = new WebSoundManager();
export const soundManager = soundService;
