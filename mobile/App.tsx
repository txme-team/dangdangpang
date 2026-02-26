import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

const DEFAULT_WEB_URL = __DEV__ ? 'http://127.0.0.1:3000' : 'https://dangdangpang.vercel.app';
const DEFAULT_IOS_REWARDED_UNIT_ID = 'ca-app-pub-9402701434542302/8971449211';
const DEFAULT_ANDROID_REWARDED_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
const FORCE_TEST_REWARDED = process.env.EXPO_PUBLIC_ADMOB_FORCE_TEST === 'true';
const FORCE_LIVE_REWARDED = process.env.EXPO_PUBLIC_ADMOB_FORCE_LIVE === 'true';
const ALLOW_TEST_FALLBACK = process.env.EXPO_PUBLIC_ADMOB_ALLOW_TEST_FALLBACK !== 'false';
const BRIDGE_LOG_PREFIX = '[DangdangpangBridge]';
const AUDIO_LOG_PREFIX = '[DangdangpangAudio]';

type NativeSoundName =
  | 'select'
  | 'match'
  | 'store'
  | 'error'
  | 'gameover'
  | 'levelcomplete'
  | 'ending';

type ShowRewardedAdPayload = {
  source: 'dangdangpang';
  type: 'SHOW_REWARDED_AD';
  requestId: string;
};

type PlaySoundPayload = {
  source: 'dangdangpang';
  type: 'PLAY_SOUND';
  sound: NativeSoundName;
};

type RewardedAdResultPayload = {
  source: 'dangdangpang';
  type: 'REWARDED_AD_RESULT';
  requestId: string;
  rewarded?: boolean;
  error?: string;
};

type AdsModuleType = typeof import('react-native-google-mobile-ads');

let adsModule: AdsModuleType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  adsModule = require('react-native-google-mobile-ads') as AdsModuleType;
} catch {
  adsModule = null;
}

const SOUND_ASSETS: Record<NativeSoundName, number> = {
  select: require('./assets/sfx/select.wav'),
  match: require('./assets/sfx/match.wav'),
  store: require('./assets/sfx/store.wav'),
  error: require('./assets/sfx/error.wav'),
  gameover: require('./assets/sfx/gameover.wav'),
  levelcomplete: require('./assets/sfx/levelcomplete.wav'),
  ending: require('./assets/sfx/ending.wav'),
};

const isNativeSoundName = (value: unknown): value is NativeSoundName => {
  return (
    value === 'select' ||
    value === 'match' ||
    value === 'store' ||
    value === 'error' ||
    value === 'gameover' ||
    value === 'levelcomplete' ||
    value === 'ending'
  );
};

const parseBridgePayload = (raw: string): ShowRewardedAdPayload | PlaySoundPayload | null => {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || data.source !== 'dangdangpang') return null;
    if (data.type === 'SHOW_REWARDED_AD') {
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) return null;
      return data as unknown as ShowRewardedAdPayload;
    }
    if (data.type === 'PLAY_SOUND') {
      if (!isNativeSoundName(data.sound)) return null;
      return data as unknown as PlaySoundPayload;
    }
    return null;
  } catch {
    console.warn(`${BRIDGE_LOG_PREFIX} Failed to parse message`, raw?.slice?.(0, 160) ?? raw);
    return null;
  }
};

const getRewardedAdUnitId = (): string => {
  if (!adsModule) return '';
  const { TestIds } = adsModule;
  if (FORCE_TEST_REWARDED) return TestIds.REWARDED;

  const iosUnit = process.env.EXPO_PUBLIC_ADMOB_REWARDED_IOS?.trim();
  const androidUnit = process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID?.trim();

  if (FORCE_LIVE_REWARDED) {
    if (Platform.OS === 'ios') return iosUnit && iosUnit.length > 0 ? iosUnit : DEFAULT_IOS_REWARDED_UNIT_ID;
    return androidUnit && androidUnit.length > 0 ? androidUnit : DEFAULT_ANDROID_REWARDED_UNIT_ID;
  }

  if (Platform.OS === 'ios') {
    if (iosUnit && iosUnit.length > 0) return iosUnit;
    return __DEV__ ? TestIds.REWARDED : DEFAULT_IOS_REWARDED_UNIT_ID;
  }
  if (androidUnit && androidUnit.length > 0) return androidUnit;
  return __DEV__ ? TestIds.REWARDED : DEFAULT_ANDROID_REWARDED_UNIT_ID;
};

const runRewardedAdAttempt = async (unitId: string): Promise<boolean> => {
  if (!adsModule) return false;
  const { RewardedAd, RewardedAdEventType, AdEventType } = adsModule;

  const ad = RewardedAd.createForAdRequest(unitId, {
    requestNonPersonalizedAdsOnly: true,
  });

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let earnedReward = false;
    let adShown = false;
    let adFailed = false;

    const settle = (rewarded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubLoaded();
      unsubEarned();
      unsubClosed();
      unsubError();
      resolve(rewarded);
    };

    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      try {
        ad.show();
        adShown = true;
      } catch {
        settle(false);
      }
    });

    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      // Reward is marked here, but applied only after ad is closed.
      earnedReward = true;
    });

    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      // Apply reward only after the ad screen is closed.
      // Some runtimes dispatch CLOSED before EARNED_REWARD, so keep a short grace window.
      setTimeout(() => {
        if (earnedReward) {
          settle(true);
          return;
        }
        if (__DEV__ && adShown && !adFailed) {
          settle(true);
          return;
        }
        settle(false);
      }, 350);
    });

    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      adFailed = true;
      settle(false);
    });

    const timer = setTimeout(() => {
      settle(false);
    }, 45000);

    ad.load();
  });
};

const showNativeRewardedAd = async (): Promise<boolean> => {
  if (!adsModule) return false;
  const { MobileAds, TestIds } = adsModule;
  await MobileAds().initialize();

  const primaryUnitId = getRewardedAdUnitId();
  const rewarded = await runRewardedAdAttempt(primaryUnitId);
  if (rewarded) return true;

  if (!ALLOW_TEST_FALLBACK || FORCE_LIVE_REWARDED || primaryUnitId === TestIds.REWARDED) return false;

  console.warn('[AdMob] Primary rewarded ad failed. Retrying with TestIds.REWARDED');
  return await runRewardedAdAttempt(TestIds.REWARDED);
};

export default function App() {
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const nativeSoundsRef = useRef<Partial<Record<NativeSoundName, Audio.Sound>>>({});

  useEffect(() => {
    // Keep audio playback active even when iOS hardware silent switch is on.
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    }).catch((error) => {
      console.warn('[AudioMode] Failed to configure audio mode:', error);
    });

    let isMounted = true;
    const preloadNativeSounds = async () => {
      const loaded: Partial<Record<NativeSoundName, Audio.Sound>> = {};
      try {
        for (const soundName of Object.keys(SOUND_ASSETS) as NativeSoundName[]) {
          console.log(`${AUDIO_LOG_PREFIX} preload start`, soundName);
          const { sound } = await Audio.Sound.createAsync(SOUND_ASSETS[soundName], {
            shouldPlay: false,
            volume: 1,
            isMuted: false,
          });
          loaded[soundName] = sound;
          console.log(`${AUDIO_LOG_PREFIX} preload success`, soundName);
        }
        if (isMounted) {
          nativeSoundsRef.current = loaded;
          console.log(`${AUDIO_LOG_PREFIX} preload completed`, Object.keys(loaded).join(', '));
        } else {
          await Promise.all(Object.values(loaded).map((sound) => sound?.unloadAsync()));
        }
      } catch (error) {
        console.warn(`${AUDIO_LOG_PREFIX} preload failed:`, error);
      }
    };

    void preloadNativeSounds();

    return () => {
      isMounted = false;
      const sounds = nativeSoundsRef.current;
      nativeSoundsRef.current = {};
      void Promise.all(Object.values(sounds).map((sound) => sound?.unloadAsync()));
    };
  }, []);

  const gameUrl = useMemo(() => {
    const envUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim();
    return envUrl && envUrl.length > 0 ? envUrl : DEFAULT_WEB_URL;
  }, []);

  const retry = () => {
    setHasError(false);
    setIsLoading(true);
    setReloadKey((prev) => prev + 1);
  };

  const playNativeSound = async (soundName: NativeSoundName) => {
    console.log(`${AUDIO_LOG_PREFIX} replay request`, soundName);
    const sound = nativeSoundsRef.current[soundName];
    if (!sound) {
      console.warn(`${AUDIO_LOG_PREFIX} replay skipped - not preloaded`, soundName);
      return;
    }
    try {
      await sound.replayAsync();
      console.log(`${AUDIO_LOG_PREFIX} replay success`, soundName);
    } catch (error) {
      console.warn(`${AUDIO_LOG_PREFIX} replay failed ${soundName}:`, error);
    }
  };

  const postRewardResult = (payload: RewardedAdResultPayload) => {
    const data = JSON.stringify(payload);
    const js = `
      (function() {
        var __ddp = ${JSON.stringify(data)};
        try { window.dispatchEvent(new MessageEvent('message', { data: __ddp })); } catch (e) {}
        try { document.dispatchEvent(new MessageEvent('message', { data: __ddp })); } catch (e) {}
        try { if (typeof window.onmessage === 'function') { window.onmessage({ data: __ddp }); } } catch (e) {}
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  };

  const onWebViewMessage = async (event: WebViewMessageEvent) => {
    console.log(`${BRIDGE_LOG_PREFIX} onMessage raw`, event.nativeEvent.data?.slice?.(0, 220) ?? event.nativeEvent.data);
    const payload = parseBridgePayload(event.nativeEvent.data);
    if (!payload) {
      console.warn(`${BRIDGE_LOG_PREFIX} payload ignored`);
      return;
    }
    console.log(`${BRIDGE_LOG_PREFIX} payload`, payload.type, payload);

    if (payload.type === 'PLAY_SOUND') {
      await playNativeSound(payload.sound);
      return;
    }

    let rewarded = false;
    let error = '';

    try {
      rewarded = await showNativeRewardedAd();
    } catch (e) {
      rewarded = false;
      error = e instanceof Error ? e.message : 'unknown_error';
    }

    postRewardResult({
      source: 'dangdangpang',
      type: 'REWARDED_AD_RESULT',
      requestId: payload.requestId,
      rewarded,
      error,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#d4e8f7" />

      <WebView
        ref={webViewRef}
        key={reloadKey}
        source={{ uri: gameUrl }}
        style={styles.webView}
        onMessage={onWebViewMessage}
        onLoadStart={() => {
          setIsLoading(true);
          setHasError(false);
        }}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
      />

      {isLoading && !hasError && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#2f6b9c" />
          <Text style={styles.overlayText}>Loading Dangdangpang...</Text>
        </View>
      )}

      {hasError && (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Connection failed</Text>
          <Text style={styles.errorDesc}>Check network or EXPO_PUBLIC_WEB_URL and retry.</Text>
          <Pressable onPress={retry} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#d4e8f7',
  },
  webView: {
    flex: 1,
    backgroundColor: '#d4e8f7',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(212,232,247,0.9)',
    paddingHorizontal: 24,
  },
  overlayText: {
    fontSize: 16,
    color: '#1f4e7e',
    fontWeight: '600',
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f4e7e',
  },
  errorDesc: {
    fontSize: 14,
    color: '#335e85',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#255683',
    backgroundColor: '#f5c44f',
  },
  retryText: {
    color: '#4a2b0a',
    fontSize: 16,
    fontWeight: '700',
  },
});
