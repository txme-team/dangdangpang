
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createBoard, findPath, hasPossibleMoves, shuffleBoard, findAvailableMatch } from './utils/gameLogic';
import { evaluateMatchReward, shouldRunGameTimer } from './utils/gameSession';
import { platformServices } from './services/platformServices';
import { AuthProvider, useAuth } from './contexts/AuthContext'; 
import LoginScreen from './components/LoginScreen'; 
import AppErrorBoundary from './components/AppErrorBoundary';
import { 
  GameState, 
  TileData, 
  Path, 
  LevelConfig,
  FloatingTextData,
  RankingEntry
} from './types';
import { 
  LEVEL_CONFIGS, 
  MAX_LEVEL, 
  TOTAL_TIME_SECONDS, 
  TIME_PENALTY_SECONDS,
  SCORE_PER_MATCH,
  BOARD_COLS,
  BOARD_ROWS
} from './constants';
import { ShuffleIcon, HintIcon, SoundOnIcon, SoundOffIcon, VideoIcon, PauseIcon, PlayIcon, ClockIcon, StarIcon, CoinIcon } from './components/Icons';

import Board from './components/Board';
import { 
  GameOverModal, 
  LevelCompleteModal, 
  GameCompleteModal, 
  HelpModal,
  AdConfirmModal
} from './components/Modals';

// Separated Game Component to use Auth Context
const GameApp: React.FC = () => {
  const { sound, userData, ads } = platformServices;
  const { user, logout } = useAuth(); // Get logged in user and logout function
  
  const [gameState, setGameState] = useState<GameState>({
    level: 1,
    score: 0,
    timeLeft: TOTAL_TIME_SECONDS,
    isPlaying: false,
    isGameOver: false,
    isLevelComplete: false,
  });

  const [board, setBoard] = useState<(TileData | null)[][]>([]);
  const [selectedTile, setSelectedTile] = useState<TileData | null>(null);
  const [secondSelectedTile, setSecondSelectedTile] = useState<TileData | null>(null);
  const [errorTile, setErrorTile] = useState<TileData | null>(null);
  const [connectionPath, setConnectionPath] = useState<Path | null>(null);
  
  const [showHelp, setShowHelp] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAd, setIsLoadingAd] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  
  // Ad Confirmation State
  const [adConfirmType, setAdConfirmType] = useState<'hint' | 'shuffle' | null>(null);

  // Bonus System State
  const [combo, setCombo] = useState(0);
  const lastMatchTime = useRef<number>(0);
  const [floatingTexts, setFloatingTexts] = useState<FloatingTextData[]>([]);
  const [isScoreAnimating, setIsScoreAnimating] = useState(false);
  const endingSfxPlayedRef = useRef(false);

  // Ranking State for Modals
  const [rankings, setRankings] = useState<RankingEntry[]>([]);

  // Init Ads
  useEffect(() => {
    ads.init();
  }, [ads]);

  useEffect(() => {
    const initialMute = sound.getDebugState?.().muted;
    if (typeof initialMute === 'boolean') {
      setIsMuted(initialMute);
    }
  }, [sound]);

  // --- Back Button Handling (History API) ---
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = (event: PopStateEvent) => {
        // Just prevent back navigation for now in PWA context
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // --- iOS Audio Unlocker ---
  // Attaches a one-time listener to the window to unlock audio on the very first touch anywhere.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tryUnlock = () => {
      // Keep all unlock work in the user gesture call stack.
      sound.forceUnlockFromUserGesture?.('global-pointer');
      sound.init();

      const debug = sound.getDebugState?.();
      if (!debug?.unlocked) return;
      window.removeEventListener('pointerdown', tryUnlock);
      window.removeEventListener('touchstart', tryUnlock);
      window.removeEventListener('mousedown', tryUnlock);
      window.removeEventListener('keydown', tryUnlock);
      window.removeEventListener('click', tryUnlock);
      document.removeEventListener('pointerdown', tryUnlock);
      document.removeEventListener('touchstart', tryUnlock);
      document.removeEventListener('mousedown', tryUnlock);
      document.removeEventListener('keydown', tryUnlock);
      document.removeEventListener('click', tryUnlock);
    };

    window.addEventListener('pointerdown', tryUnlock, { passive: true });
    window.addEventListener('touchstart', tryUnlock, { passive: true });
    window.addEventListener('mousedown', tryUnlock);
    window.addEventListener('keydown', tryUnlock);
    window.addEventListener('click', tryUnlock);
    document.addEventListener('pointerdown', tryUnlock, { passive: true });
    document.addEventListener('touchstart', tryUnlock, { passive: true });
    document.addEventListener('mousedown', tryUnlock);
    document.addEventListener('keydown', tryUnlock);
    document.addEventListener('click', tryUnlock);

    return () => {
      window.removeEventListener('pointerdown', tryUnlock);
      window.removeEventListener('touchstart', tryUnlock);
      window.removeEventListener('mousedown', tryUnlock);
      window.removeEventListener('keydown', tryUnlock);
      window.removeEventListener('click', tryUnlock);
      document.removeEventListener('pointerdown', tryUnlock);
      document.removeEventListener('touchstart', tryUnlock);
      document.removeEventListener('mousedown', tryUnlock);
      document.removeEventListener('keydown', tryUnlock);
      document.removeEventListener('click', tryUnlock);
    };
  }, [sound]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        sound.resume();
      }
    };
    const onPageShow = () => sound.resume();
    const onFocus = () => sound.resume();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, [sound]);

  const startLevel = useCallback((level: number) => {
    const config: LevelConfig = LEVEL_CONFIGS[level];
    const newBoard = createBoard(
      config.rows,
      config.cols,
      config.tileTypesCount,
      config.tileTypePool
    );
    
    setBoard(newBoard);
    setGameState(prev => ({
      ...prev,
      level,
      isPlaying: true,
      isLevelComplete: false,
      isGameOver: false,
      timeLeft: config.timeLimit, 
    }));
    setSelectedTile(null);
    setSecondSelectedTile(null);
    setConnectionPath(null);
    setErrorTile(null);
    setCombo(0);
    lastMatchTime.current = 0;
    setFloatingTexts([]);
    setRankings([]); 
    setIsPaused(false);
    endingSfxPlayedRef.current = false;
  }, []);

  const restartGame = async () => {
    const l1Config = LEVEL_CONFIGS[1];
    setGameState(prev => ({
      level: 1,
      score: 0,
      timeLeft: l1Config.timeLimit,
      isPlaying: true,
      isGameOver: false,
      isLevelComplete: false,
    }));
    setIsPaused(false);
    endingSfxPlayedRef.current = false;
    startLevel(1);
  };

  // --- Timer ---
  useEffect(() => {
    let timer: number;
    // Timer pauses when help or settings are open
    if (shouldRunGameTimer({
      isPlaying: gameState.isPlaying,
      isGameOver: gameState.isGameOver,
      isLevelComplete: gameState.isLevelComplete,
      showHelp,
      showSettings: isPaused,
      isLoadingAd,
      isShuffling,
      hasAdConfirm: !!adConfirmType,
    })) {
      timer = window.setInterval(async () => {
        setGameState(prev => {
          if (prev.timeLeft <= 1) {
             return { ...prev, timeLeft: 0, isGameOver: true, isPlaying: false };
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState.isPlaying, gameState.isGameOver, gameState.isLevelComplete, showHelp, isPaused, isLoadingAd, isShuffling, adConfirmType]);

  // Game Over
  useEffect(() => {
    if (gameState.isGameOver && gameState.timeLeft === 0) {
        sound.playGameOver();
        const finishGame = async () => {
            await userData.saveScore(gameState.score);
            const r = await userData.getRankings(gameState.score);
            setRankings(r);
        };
        finishGame();
    }
  }, [gameState.isGameOver, gameState.timeLeft, gameState.score]);


  // --- Logic ---

  const handleTileClick = (clickedTile: TileData) => {
    if (!gameState.isPlaying || gameState.isGameOver || connectionPath || secondSelectedTile || isPaused || isLoadingAd || isShuffling || adConfirmType) return; 

    sound.playSelect();

    if (!selectedTile) {
      setSelectedTile(clickedTile);
      setErrorTile(null);
      return;
    }

    if (selectedTile.id === clickedTile.id) {
      setSelectedTile(null);
      return;
    }

    setSecondSelectedTile(clickedTile);

    if (selectedTile.type === clickedTile.type) {
      const path = findPath(selectedTile.position, clickedTile.position, board);
      if (path) {
        handleMatch(selectedTile, clickedTile, path);
      } else {
        handleMismatch(clickedTile);
      }
    } else {
       handleMismatch(clickedTile);
    }
  };

  const addFloatingText = (text: string, subText?: string, type: 'normal' | 'combo' = 'normal') => {
    const id = Date.now();
    setFloatingTexts(prev => [...prev, { id, text, subText, type }]);
    setTimeout(() => {
      setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
    }, 1200);
  };

  const triggerScoreAnimation = () => {
    setIsScoreAnimating(true);
    setTimeout(() => setIsScoreAnimating(false), 300);
  };

  const handleMatch = (tile1: TileData, tile2: TileData, path: Path) => {
    sound.playMatchSuccess();
    setConnectionPath(path);

    const now = Date.now();
    const reward = evaluateMatchReward({
      combo,
      lastMatchTime: lastMatchTime.current,
      now,
      scorePerMatch: SCORE_PER_MATCH,
    });

    setCombo(reward.newCombo);
    lastMatchTime.current = now;

    addFloatingText(`+${reward.points}`, reward.finalSubText, reward.isCombo ? 'combo' : 'normal');
    triggerScoreAnimation();
    
    setTimeout(() => {
      setBoard(prevBoard => {
        const newBoard = prevBoard.map(row => row.map(t => {
            if (!t) return null;
            if (t.id === tile1.id || t.id === tile2.id) {
                return { ...t, isMatched: true };
            }
            return t;
        }));
        
        const remainingTiles = newBoard.flat().filter(t => t && !t.isMatched).length;
        if (remainingTiles === 0) {
           handleLevelComplete(gameState.score + reward.points);
        } else if (!hasPossibleMoves(newBoard)) {
             return shuffleBoard(newBoard);
        }
        return newBoard;
      });

      setGameState(prev => ({
        ...prev,
        score: prev.score + reward.points,
        timeLeft: prev.timeLeft + 2, // Bonus time!
      }));
      
      setConnectionPath(null);
      setSelectedTile(null);
      setSecondSelectedTile(null); 
    }, 300);
  };

  const handleMismatch = (secondTile: TileData) => {
    sound.playError();
    setErrorTile(secondTile);
    setCombo(0); 
    
    setGameState(prev => {
        const newTime = Math.max(0, prev.timeLeft - TIME_PENALTY_SECONDS);
        return { ...prev, timeLeft: newTime };
    });

    setTimeout(() => {
      setSelectedTile(null);
      setSecondSelectedTile(null); 
      setErrorTile(null);
    }, 500);
  };

  // --- Ad Based Actions ---

  const handleHintClick = () => {
    if (!gameState.isPlaying || isPaused || connectionPath || isLoadingAd || isShuffling) return;
    sound.playSelect();
    setAdConfirmType('hint');
  };

  const handleShuffleClick = () => {
    if (!gameState.isPlaying || isPaused || connectionPath || isLoadingAd || isShuffling) return;
    sound.playSelect();
    setAdConfirmType('shuffle');
  };

  const handleAdConfirmed = async () => {
    const type = adConfirmType;
    setAdConfirmType(null); // Close modal
    setIsLoadingAd(true);

    // SAFETY: If ad fails silently, reset loading after 5s
    const safetyTimer = setTimeout(() => {
        setIsLoadingAd(false);
    }, 5000);

    ads.showRewardAd(
      async () => {
        // Success
        clearTimeout(safetyTimer);
        setIsLoadingAd(false);
        
        if (type === 'hint') {
            const match = findAvailableMatch(board);
            if (match) {
                sound.playStoreSuccess();
                setSelectedTile(match.tile1);
                setSecondSelectedTile(match.tile2);
                setTimeout(() => {
                     handleMatch(match.tile1, match.tile2, match.path);
                }, 500);
            }
        } else if (type === 'shuffle') {
            // Start Shuffle Animation
            setIsShuffling(true);
            sound.playSelect(); 

            setTimeout(() => {
                sound.playStoreSuccess();
                setBoard(prev => shuffleBoard(prev));
                setIsShuffling(false);
                addFloatingText("SHUFFLE!", "", 'combo');
            }, 800);
        }
      },
      () => {
        // Dismissed/Failed
        clearTimeout(safetyTimer);
        setIsLoadingAd(false);
        sound.playError();
      }
    );
  };

  const handleAdCancel = () => {
    sound.playSelect();
    setAdConfirmType(null);
  };

  const handleLevelComplete = async (finalScore: number) => {
    if (gameState.level >= MAX_LEVEL) {
      if (!endingSfxPlayedRef.current) {
        sound.playEndingCelebration();
        endingSfxPlayedRef.current = true;
      }
    } else {
      sound.playLevelComplete();
    }
    await userData.saveScore(finalScore);
    const r = await userData.getRankings(finalScore);
    setRankings(r);

    setGameState(prev => ({
        ...prev,
        isLevelComplete: true,
        isPlaying: false 
    }));
    setIsPaused(false);
    setCombo(0);
    setFloatingTexts([]);
  };

  const nextLevel = () => {
    if (gameState.level >= MAX_LEVEL) {
    } else {
        startLevel(gameState.level + 1);
    }
  };

  const handleRestartFromModal = () => {
    sound.playSelect();
    restartGame();
  };

  const handleNextFromModal = () => {
    sound.playSelect();
    nextLevel();
  };

  const togglePause = () => {
    if (!gameState.isPlaying || gameState.isGameOver || gameState.isLevelComplete || isLoadingAd || isShuffling || !!adConfirmType) {
      return;
    }
    setIsPaused(prev => !prev);
    sound.playSelect();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePauseShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      togglePause();
    };

    window.addEventListener('keydown', handlePauseShortcut);
    return () => window.removeEventListener('keydown', handlePauseShortcut);
  }, [gameState.isPlaying, gameState.isGameOver, gameState.isLevelComplete, isLoadingAd, isShuffling, adConfirmType]);

  const toggleMute = () => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
    sound.playSelect();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative h-screen w-full flex flex-col items-center justify-center p-1 pt-[calc(0.25rem+env(safe-area-inset-top))] pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
      
      {/* Floating Text Overlay */}
      <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
        {floatingTexts.map(ft => (
          <div 
            key={ft.id}
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center animate-float-up ${ft.type === 'combo' ? 'text-yellow-500 scale-125' : 'text-blue-500'}`}
          >
             <span className="text-5xl font-black stroke-white drop-shadow-md" style={{ WebkitTextStroke: '2px white' }}>{ft.text}</span>
             {ft.subText && (
               <span className="text-2xl font-bold text-green-500 mt-1 drop-shadow-sm bg-white/90 px-3 py-1 rounded-full border border-green-500">{ft.subText}</span>
             )}
          </div>
        ))}
      </div>

      <div className="w-full max-w-[560px] md:max-w-[680px] ui-shell pixel-sheet-corner p-1 flex flex-col h-full max-h-[96vh] overflow-hidden">
        
        {/* Header Bar */}
        <div className="ui-header px-2 py-2 shrink-0 mb-1">
          <div className="grid grid-cols-3 gap-2 items-stretch">
            <div className="!h-[52px] px-3 flex flex-col items-start justify-center gap-0.5 border border-[#7ea9c8] rounded-[6px] bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)]">
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[#4a6f8f]">LEVEL</span>
              <span className="text-[18px] leading-none font-semibold text-[#2d5d88] flex items-center gap-1">
                <span className="w-4 h-4"><StarIcon /></span>
                <span>{gameState.level}</span>
              </span>
            </div>
            <div className={`!h-[52px] px-3 flex flex-col items-start justify-center gap-0.5 border border-[#7ea9c8] rounded-[6px] bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)] ${gameState.timeLeft < 10 ? 'text-[#ff6e57] animate-pulse' : ''}`}>
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[#4a6f8f]">TIME</span>
              <span className="text-[18px] leading-none font-semibold text-[#2d5d88] flex items-center gap-1">
                <span className="w-4 h-4"><ClockIcon /></span>
                <span>{formatTime(gameState.timeLeft)}</span>
              </span>
            </div>
            <div className={`!h-[52px] px-3 flex flex-col items-start justify-center gap-0.5 border border-[#7ea9c8] rounded-[6px] bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)] ${isScoreAnimating ? 'animate-score-bump' : ''}`}>
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[#4a6f8f]">SCORE</span>
              <span className="text-[18px] leading-none font-semibold text-[#2d5d88] flex items-center gap-1">
                <span className="w-4 h-4"><CoinIcon /></span>
                <span>{gameState.score}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Game Screen */}
        <div className="flex-grow relative overflow-hidden flex items-center justify-center p-1.5 border border-[#7ea9c8] rounded-[6px] bg-[linear-gradient(180deg,#e6f1fa_0%,#d5e7f5_100%)] shadow-[inset_0_0_0_1px_#f7fcff]">
            {board.length > 0 && (
                <div 
                  className="relative shadow-sm h-full w-full flex items-center justify-center"
                  style={{ 
                    aspectRatio: `${BOARD_COLS - 2}/${BOARD_ROWS - 2}`,
                    height: '100%',
                    width: 'auto',
                    maxWidth: '100%',
                  }}
                >
                    <Board 
                        board={board}
                        selectedTile={selectedTile}
                        secondSelectedTile={secondSelectedTile}
                        errorTile={errorTile}
                        onTileClick={handleTileClick}
                        connectionPath={connectionPath}
                        isPaused={isPaused}
                        isShuffling={isShuffling}
                    />
                </div>
            )}
            
            {/* Loading Ad Overlay */}
            {isLoadingAd && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                    <div className="w-12 h-12 mb-4 animate-spin rounded-full border-4 border-white border-t-transparent"></div>
                    <div className="font-medium text-lg">광고 불러오는 중...</div>
                </div>
            )}
        </div>

        {/* Bottom Controls */}
        <div className="mt-1 shrink-0 flex gap-1 sm:gap-2 h-[58px] sm:h-[64px] ui-header p-1">
           <button
             onClick={toggleMute}
             className="retro-icon-btn pixel-btn-corner !w-[44px] sm:!w-[64px] !h-full shrink-0"
             aria-label={isMuted ? '소리 켜기' : '소리 끄기'}
             title={isMuted ? 'SOUND ON' : 'SOUND OFF'}
           >
             <div className="w-[22px] h-[22px] sm:w-8 sm:h-8">{isMuted ? <SoundOffIcon /> : <SoundOnIcon />}</div>
           </button>

            <button
             onClick={togglePause}
             className="retro-icon-btn pixel-btn-corner !w-[44px] sm:!w-[64px] !h-full shrink-0"
             aria-label={isPaused ? '게임 재개' : '게임 일시정지'}
             title={isPaused ? 'RESUME' : 'PAUSE'}
            >
             <div className="w-[22px] h-[22px] sm:w-8 sm:h-8">{isPaused ? <PlayIcon /> : <PauseIcon />}</div>
            </button>

           {/* Hint Button */}
           <button 
             onClick={handleHintClick}
             className="min-w-0 flex-1 ui-action-hint pixel-btn-corner flex items-center justify-center gap-1 sm:gap-3 px-1.5 sm:px-3 py-2 text-[#5b360f] active:translate-y-1 active:shadow-none transition-colors"
           >
              <div className="hidden sm:block w-6 h-6 sm:w-10 sm:h-10 shrink-0"><HintIcon /></div>
              <div className="flex items-center gap-1 leading-none min-w-0">
                 <span className="font-bold text-[11px] sm:text-sm whitespace-nowrap">HINT</span>
                 <div className="flex items-center gap-1 text-[9px] sm:text-[10px] bg-black/20 px-1.5 sm:px-2 py-0.5 pixel-btn-corner-sm border border-white/20 shrink-0">
                    <div className="w-3 h-3"><VideoIcon /></div>
                    <span>AD</span>
                 </div>
              </div>
           </button>

           {/* Shuffle Button */}
           <button 
             onClick={handleShuffleClick}
             className="min-w-0 flex-1 ui-action-shuffle pixel-btn-corner flex items-center justify-center gap-1 sm:gap-3 px-1.5 sm:px-3 py-2 text-[#5b360f] active:translate-y-1 active:shadow-none transition-colors"
           >
              <div className="hidden sm:block w-6 h-6 sm:w-10 sm:h-10 shrink-0"><ShuffleIcon /></div>
              <div className="flex items-center gap-1 leading-none min-w-0">
                 <span className="font-bold text-[11px] sm:text-sm whitespace-nowrap">SHUFFLE</span>
                 <div className="flex items-center gap-1 text-[9px] sm:text-[10px] bg-black/20 px-1.5 sm:px-2 py-0.5 pixel-btn-corner-sm border border-white/20 shrink-0">
                    <div className="w-3 h-3"><VideoIcon /></div>
                    <span>AD</span>
                 </div>
              </div>
           </button>
        </div>

      </div>

      {showHelp && (
        <HelpModal onClose={() => {
            sound.init();
            sound.playSelect();
            try {
              window.history.pushState({ page: 'game' }, '', '');
            } catch (error) {
              console.warn('history.pushState failed:', error);
            }
            setShowHelp(false);
            if (!gameState.isPlaying && gameState.level === 1) {
                startLevel(1);
            }
        }} />
      )}
      
      {/* Ad Confirmation Modal */}
      {adConfirmType && (
          <AdConfirmModal 
              type={adConfirmType} 
              onConfirm={handleAdConfirmed} 
              onCancel={handleAdCancel} 
          />
      )}

      {gameState.isGameOver && (
          <GameOverModal 
            score={gameState.score} 
            onRestart={handleRestartFromModal} 
          />
      )}

      {gameState.isLevelComplete && (
          gameState.level >= MAX_LEVEL ? (
             <GameCompleteModal 
                score={gameState.score} 
                onRestart={handleRestartFromModal} 
                rankings={rankings}
             />
          ) : (
             <LevelCompleteModal 
                score={gameState.score} 
                level={gameState.level} 
                onNext={handleNextFromModal} 
                rankings={rankings}
             />
          )
      )}

    </div>
  );
};

// Root Component that handles Switching
const App: React.FC = () => {
    return (
        <AppErrorBoundary>
          <AuthProvider>
              <AuthConsumer />
          </AuthProvider>
        </AppErrorBoundary>
    );
}

const AuthConsumer: React.FC = () => {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return (
             <div className="h-screen w-screen bg-retro-stripe flex items-center justify-center">
                 <div className="text-xl font-bold text-[#fff2c6] animate-bounce" style={{ textShadow: '2px 2px 0 #1a2242' }}>LOADING...</div>
             </div>
        );
    }

    if (!user) {
        return <LoginScreen />;
    }

    return <GameApp />;
}

export default App;
