import { SoundDebugState, SoundService } from '../services/contracts';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __DANGDANG_SOUND_DEBUG__?: SoundDebugState;
  }
}

type SoundEvent = 'select' | 'match' | 'store' | 'error' | 'gameover' | 'levelcomplete' | 'ending';
type AudioBackend = 'web-audio' | 'html5-audio' | 'rn-bridge';

const MUTE_STORAGE_KEY = 'dangdangpang:isMuted';
const HTML_POOL_SIZE = 8;
const IOS_BACKEND_STORAGE_KEY = 'dangdangpang:ios_sfx_backend';
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

  private iosBufferCtx: AudioContext | null = null;
  private iosBufferCache: Partial<Record<SoundEvent, AudioBuffer>> = {};
  private iosBufferReady = false;
  private iosBufferLoading = false;

  constructor() {
    this.storedMutedValue = this.readStoredMuted();
    this.isMuted = this.storedMutedValue === 'true';
    this.backend = this.detectBackend();
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
      this.prepareIOSBufferBackend();
    }
    if (this.backend === 'web-audio') {
      this.attachLifecycleResumeHandlers();
    }
    this.publishDebug();
  }

  init() {
    if (this.backend === 'rn-bridge') return;
    if (this.backend === 'html5-audio') {
      this.ensureHtmlAudioPools();
      this.warmupHtmlAudioPools();
      this.prepareIOSBufferBackend();
      this.updateDebug({
        lastResume: { ok: true, at: Date.now(), reason: 'html5-init' },
      });
      return;
    }
    this.forceUnlockFromUserGesture('init');
  }

  resume() {
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
      const requestAt = performance.now();
      if (this.shouldUseIOSBufferBackend()) {
        const played = this.playIOSBufferSound(event, requestAt);
        if (played) return;
      }
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
    const requestAt = performance.now();
    const pool = this.htmlAudioPools[event];
    if (!pool || pool.length === 0) {
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
    audio.volume = this.getEffectiveVolume();
    audio.muted = this.isMuted && !this.forceMasterGain;

    try {
      // iOS Safari can leave elements in a pseudo-playing silent state.
      // Always hard-reset before replaying.
      if (!audio.paused && !audio.ended) {
        audio.pause();
      }
      try {
        if (audio.readyState > 0) {
          audio.currentTime = 0;
        }
      } catch {
        // iOS can throw if currentTime is set before metadata is ready.
      }
      const onPlaying = () => {
        const latency = performance.now() - requestAt;
        console.log(`[SFX-LATENCY] html5 ${event} playing in ${latency.toFixed(1)}ms (pool#${index})`);
      };
      const onEnded = () => {
        // no-op
      };
      audio.addEventListener('playing', onPlaying, { once: true });
      audio.addEventListener('ended', onEnded, { once: true });
      const promise = audio.play();
      if (promise && typeof promise.then === 'function') {
        void promise
          .then(() => {
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
            const isCritical = event === 'gameover' || event === 'levelcomplete' || event === 'ending';
            if (isCritical && allowRetry) {
              window.setTimeout(() => {
                const noProgress = audio.currentTime < 0.02 && audio.paused;
                if (noProgress) {
                  this.playHtmlSound(event, false);
                }
              }, 140);
            }
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[SFX-PLAY] html5 reject ${event} pool#${index}: ${message}`);
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
              window.setTimeout(() => this.playHtmlSound(event, false), 90);
            }
          });
      } else {
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
      console.warn(`[SFX-PLAY] html5 exception ${event} pool#${index}: ${message}`);
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
        window.setTimeout(() => this.playHtmlSound(event, false), 90);
      }
    }
  }

  private ensureHtmlAudioPools() {
    if (this.backend !== 'html5-audio' || this.htmlPoolReady || typeof window === 'undefined') return;
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
    this.updateDebug({
      masterGain: this.getEffectiveVolume(),
      muted: this.isMuted,
      storedMuted: this.storedMutedValue,
      forceMasterGain: this.forceMasterGain,
    });
  }

  private pickHtmlAudioInstance(sound: SoundEvent, pool: HTMLAudioElement[]) {
    const size = pool.length;
    const start = this.htmlPoolCursor[sound] % size;

    // 1) Prefer idle+ready entries to avoid cutting currently playing sounds.
    for (let i = 0; i < size; i++) {
      const idx = (start + i) % size;
      const candidate = pool[idx];
      if (candidate.readyState >= 2 && (candidate.paused || candidate.ended)) {
        this.htmlPoolCursor[sound] = (idx + 1) % size;
        return candidate;
      }
    }

    // 2) If no ready idle entry, still prefer any idle entry.
    for (let i = 0; i < size; i++) {
      const idx = (start + i) % size;
      const candidate = pool[idx];
      if (candidate.paused || candidate.ended) {
        this.htmlPoolCursor[sound] = (idx + 1) % size;
        return candidate;
      }
    }

    // 3) Fallback: all entries busy, use round-robin slot.
    const fallback = pool[start];
    this.htmlPoolCursor[sound] = (start + 1) % size;
    return fallback;
  }

  private warmupHtmlAudioPools() {
    if (this.backend !== 'html5-audio' || this.htmlPoolWarmedUp) return;
    this.htmlPoolWarmedUp = true;
    // iOS Safari can drop early user-triggered SFX if we aggressively play/pause many
    // hidden primer sounds at startup. Keep warmup as preload-only.
    (Object.keys(this.htmlAudioPools) as SoundEvent[]).forEach((sound) => {
      const pool = this.htmlAudioPools[sound];
      if (!pool) return;
      pool.forEach((audio) => {
        try {
          if (audio.readyState < 2) audio.load();
        } catch {
          // No-op
        }
      });
    });
  }

  private shouldUseIOSBufferBackend() {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent || '';
    const isiOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (!isiOS) return false;
    try {
      const pref = window.localStorage.getItem(IOS_BACKEND_STORAGE_KEY);
      return pref === 'buffer' && this.iosBufferReady;
    } catch {
      return false;
    }
  }

  private prepareIOSBufferBackend() {
    if (this.iosBufferReady || this.iosBufferLoading || typeof window === 'undefined') return;
    const ua = window.navigator.userAgent || '';
    const isiOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (!isiOS) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    this.iosBufferLoading = true;
    this.iosBufferCtx = this.iosBufferCtx ?? new AudioContextClass({ latencyHint: 'interactive' } as AudioContextOptions);

    const tasks = (Object.keys(HTML_AUDIO_SRC) as SoundEvent[]).map(async (sound) => {
      const res = await fetch(HTML_AUDIO_SRC[sound], { cache: 'force-cache' });
      const ab = await res.arrayBuffer();
      const decoded = await this.iosBufferCtx!.decodeAudioData(ab.slice(0));
      this.iosBufferCache[sound] = decoded;
    });

    void Promise.all(tasks)
      .then(() => {
        this.iosBufferReady = true;
        console.log('[SFX-BUFFER] iOS buffer backend prepared');
      })
      .catch((error) => {
        console.warn('[SFX-BUFFER] prepare failed, fallback html5', error);
        this.iosBufferReady = false;
      })
      .finally(() => {
        this.iosBufferLoading = false;
      });
  }

  private playIOSBufferSound(event: SoundEvent, requestAt: number) {
    if (!this.iosBufferReady || !this.iosBufferCtx) return false;
    const buffer = this.iosBufferCache[event];
    if (!buffer) return false;
    try {
      if (this.iosBufferCtx.state === 'suspended') {
        void this.iosBufferCtx.resume();
      }
      const src = this.iosBufferCtx.createBufferSource();
      const gain = this.iosBufferCtx.createGain();
      gain.gain.value = this.getEffectiveVolume();
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(this.iosBufferCtx.destination);
      src.start(0);
      const latency = performance.now() - requestAt;
      console.log(`[SFX-LATENCY] ios-buffer ${event} start in ${latency.toFixed(1)}ms`);
      this.updateDebug({
        lastPlay: {
          ok: true,
          at: Date.now(),
          backend: 'web-audio',
          sound: event,
          message: 'ios-buffer source start',
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[SFX-BUFFER] play failed ${event}, fallback html5: ${message}`);
      return false;
    }
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
