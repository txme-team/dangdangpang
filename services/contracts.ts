import { RankingEntry } from '../types';

export type SoundDebugState = {
  mode: 'web-audio' | 'rn-bridge';
  contextState: AudioContextState | 'none';
  unlocked: boolean;
  lastResume: {
    ok: boolean;
    at: number;
    reason: string;
    error?: string;
  } | null;
  lastError: string | null;
};

export interface SoundService {
  init: () => void;
  resume: () => void;
  forceUnlockFromUserGesture?: (reason?: string) => void;
  getDebugState?: () => SoundDebugState;
  toggleMute: () => boolean;
  playSelect: () => void;
  playMatchSuccess: () => void;
  playStoreSuccess: () => void;
  playError: () => void;
  playGameOver: () => void;
  playLevelComplete: () => void;
  playEndingCelebration: () => void;
  playBGM: () => void;
  stopBGM: () => void;
}

export interface UserDataService {
  isConnected: () => boolean;
  getUserProfile: () => Promise<{ id: string; nickname: string; highScore: number }>;
  updateProfile: (nickname: string) => Promise<void>;
  saveScore: (currentScore: number) => Promise<void>;
  getRankings: (currentScore: number) => Promise<RankingEntry[]>;
}

export interface AdsService {
  init: () => void;
  showRewardAd: (onReward: () => void, onDismiss: () => void) => void;
}
