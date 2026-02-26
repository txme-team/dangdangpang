
import React from 'react';
import { HintIcon, ShuffleIcon } from './Icons';
import { RankingEntry } from '../types';

// Reusable Modal Wrapper
interface ModalOverlayProps {
  children: React.ReactNode;
  containerClass?: string;
  animated?: boolean;
}

const ModalOverlay: React.FC<ModalOverlayProps> = ({ children, containerClass, animated = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#183149]/55 backdrop-blur-[1px]">
    <div className={`${containerClass || "pixel-sheet-corner bg-[#d4e8f7] p-4 border border-[#1f4e7e] shadow-[3px_3px_0_#78aacd] max-w-sm w-[90%] text-center relative flex flex-col items-center max-h-[90vh]"} ${animated ? 'animate-pop-in' : ''}`}>
      {children}
    </div>
  </div>
);

interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  colorClass?: string;
  disabled?: boolean;
}

const MODAL_BTN_BASE =
  'py-2.5 px-4 text-sm font-normal border border-[#7ea9c8] pixel-btn-corner shadow-[1px_1px_0_rgba(45,92,124,0.22)] active:translate-y-1 active:shadow-none transition-all';

const ActionButton: React.FC<ButtonProps> = ({ onClick, children, colorClass = 'glossy-blue', disabled = false }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full mt-3 ${MODAL_BTN_BASE} ${
      colorClass === 'glossy-green'
        ? 'bg-[linear-gradient(180deg,#f8fcff_0%,#deeffa_100%)] text-[#365c7c]'
        : colorClass === 'glossy-pink'
          ? 'bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)] text-[#365c7c]'
          : 'bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)] text-[#365c7c]'
    } ${disabled ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
  >
    {children}
  </button>
);

interface RankingItemProps {
  rank: number;
  name: string;
  score: number;
  isUser?: boolean;
}

const RankingItem: React.FC<RankingItemProps> = ({ rank, name, score, isUser }) => (
  <div className={`w-full flex items-center justify-between p-2 mb-2 pixel-btn-corner-sm ${isUser ? 'bg-[#ffe6ac] scale-[1.02] shadow-sm' : 'bg-[#f3fbff]'}`}>
     <div className="flex items-center gap-3 overflow-hidden">
        <span className={`shrink-0 w-8 h-6 flex items-center justify-center text-xs font-bold ${rank === 1 ? 'bg-yellow-400' : rank === 2 ? 'bg-slate-300' : rank === 3 ? 'bg-orange-300' : 'bg-slate-200'}`}>
           {rank}
        </span>
        <span className={`text-sm truncate ${isUser ? 'font-semibold text-[#1f4e7e]' : 'text-[#336588]'}`}>{name}</span>
     </div>
     <span className={`font-medium shrink-0 text-sm ${isUser ? 'text-[#b45b1a]' : 'text-[#336588]'}`}>{score.toLocaleString()}</span>
  </div>
);

const CONFETTI_COLORS = ['#ffe8a8', '#ffd15a', '#6cd3ff', '#85e6be', '#f8f6ef', '#ff9db0'];

const PixelConfettiBurst: React.FC = () => {
  const particles = Array.from({ length: 56 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 56;
    const distance = 34 + (i % 6) * 9;
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance) - 8;
    return {
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      dx,
      dy,
      delay: (i % 8) * 0.06,
      duration: 0.75 + (i % 4) * 0.1,
      size: 3 + (i % 3),
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
      {particles.map((p) => (
        <span
          key={p.id}
          className="pixel-confetti-dot"
          style={{
            left: '50%',
            top: '38%',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            animationName: 'pixel-confetti-burst',
            animationDuration: `${p.duration}s`,
            animationTimingFunction: 'steps(8, end)',
            animationIterationCount: 'infinite',
            animationDelay: `${p.delay}s`,
            ['--dx' as any]: `${p.dx}px`,
            ['--dy' as any]: `${p.dy}px`,
          }}
        />
      ))}
    </div>
  );
};

// Visual Separator for large rank gaps
const RankSeparator = () => (
  <div className="w-full flex justify-center items-center py-1 mb-2">
      <div className="flex gap-1">
          <div className="w-1.5 h-1.5 bg-[#2a3356]/40 rounded-full"></div>
          <div className="w-1.5 h-1.5 bg-[#2a3356]/40 rounded-full"></div>
          <div className="w-1.5 h-1.5 bg-[#2a3356]/40 rounded-full"></div>
      </div>
  </div>
);

const RankingView = ({ rankings }: { rankings: RankingEntry[] }) => {
  return (
    <div className="w-full mt-4 mb-2 text-left bg-[#f1fbff] p-2 pixel-btn-corner">
       <h3 className="text-xs font-semibold text-[#1f4e7e] uppercase mb-2 text-center">GLOBAL RANKING</h3>
       {rankings.length === 0 ? (
         <div className="text-center text-gray-400 py-4">Loading...</div>
       ) : (
         rankings.map((r, i) => {
           // Check if there is a gap between this item and the previous one
           const prevRank = i > 0 ? rankings[i-1].rank : 0;
           const isGap = r.rank > prevRank + 1;

           return (
             <React.Fragment key={i}>
               {isGap && <RankSeparator />}
               <RankingItem 
                 rank={r.rank} 
                 name={r.name} 
                 score={r.score} 
                 isUser={r.isUser} 
               />
             </React.Fragment>
           );
         })
       )}
    </div>
  );
};

export const GameOverModal = ({ score, onRestart }: { score: number; onRestart: () => void }) => (
  <ModalOverlay animated>
    <div className="w-full mb-4 py-6 px-4 bg-[linear-gradient(180deg,#d8ecfb_0%,#c6e2f6_100%)] pixel-btn-corner">
      <h2 className="text-[34px] leading-none font-semibold tracking-[0.08em] text-[#1f4e7e] text-center animate-pulse" style={{ textShadow: '2px 2px 0 #f7fcff' }}>
        GAME OVER
      </h2>
      <p className="mt-3 text-center text-[#1f4e7e] text-sm">
        SCORE <span className="font-semibold text-base">{score.toLocaleString()}</span>
      </p>
    </div>

    <ActionButton onClick={onRestart} colorClass="glossy-blue">RETRY</ActionButton>
  </ModalOverlay>
);

export const LevelCompleteModal = ({ score, level, onNext, rankings }: { score: number; level: number; onNext: () => void; rankings: RankingEntry[] }) => (
  <ModalOverlay animated>
    <PixelConfettiBurst />
    <div className="w-full mb-4 py-6 px-4 bg-[linear-gradient(180deg,#d8ecfb_0%,#c6e2f6_100%)] pixel-btn-corner relative z-10">
      <h2 className="text-[30px] leading-none font-semibold tracking-[0.08em] text-[#1f4e7e] text-center" style={{ textShadow: '2px 2px 0 #f7fcff' }}>
        LEVEL {level} CLEAR
      </h2>
      <p className="mt-3 text-center text-[#1f4e7e] text-sm">
        SCORE <span className="font-semibold text-base">{score.toLocaleString()}</span>
      </p>
    </div>

    <div className="relative z-10 w-full">
      <RankingView rankings={rankings} />
    </div>
    
    <div className="relative z-10 w-full">
      <ActionButton onClick={onNext} colorClass="glossy-blue">
      {level >= 5 ? 'ENDING' : 'NEXT LEVEL'}
      </ActionButton>
    </div>
  </ModalOverlay>
);

export const GameCompleteModal = ({ score, onRestart, rankings }: { score: number; onRestart: () => void; rankings: RankingEntry[] }) => (
  <ModalOverlay animated containerClass="pixel-sheet-corner bg-[linear-gradient(180deg,#ffeab0_0%,#ffd57f_58%,#f3b95d_100%)] p-4 border border-[#92521a] shadow-[3px_3px_0_#b06d2d] max-w-sm w-[90%] text-center relative flex flex-col items-center max-h-[90vh]">
    <PixelConfettiBurst />
    <div className="w-full mb-4 py-6 px-4 bg-[linear-gradient(180deg,#fff4cb_0%,#ffe296_100%)] pixel-btn-corner relative z-10">
      <h2 className="text-[30px] leading-none font-semibold tracking-[0.08em] text-[#7a3e12] text-center" style={{ textShadow: '2px 2px 0 #fff9e3' }}>
        ENDING
      </h2>
      <p className="mt-2 text-sm text-[#8a4a17] text-center">ALL CLEAR</p>
      <p className="mt-3 text-center text-[#7a3e12] text-sm">
        SCORE <span className="font-semibold text-base">{score.toLocaleString()}</span>
      </p>
    </div>

    <div className="relative z-10 w-full">
      <RankingView rankings={rankings} />
    </div>
    
    <div className="relative z-10 w-full">
      <ActionButton onClick={onRestart} colorClass="glossy-pink">PLAY AGAIN</ActionButton>
    </div>
  </ModalOverlay>
);

export const HelpModal = ({ onClose }: { onClose: () => void }) => (
  <ModalOverlay>
    <div className="w-full mb-4 py-6 px-4 bg-[linear-gradient(180deg,#d8ecfb_0%,#c6e2f6_100%)] pixel-btn-corner relative z-10">
      <h2 className="text-[30px] leading-none font-semibold tracking-[0.08em] text-[#1f4e7e] text-center" style={{ textShadow: '2px 2px 0 #f7fcff' }}>
        HOW TO PLAY
      </h2>
    </div>

    <div className="w-full text-left bg-[#f3fbff] p-4 mb-4 pixel-btn-corner relative z-10">
        <ul className="list-decimal pl-5 space-y-2 text-sm font-normal text-slate-700 break-keep">
            <li>
                <span className="text-[#d07f2f]">짝 맞추기:</span> 똑같은 모양의 패 2개를 선택해서 없애세요.
            </li>
            <li>
                <span className="text-[#d07f2f]">규칙:</span> 연결하는 선은 <span className="text-red-500">2번까지만</span> 꺾일 수 있어요.
            </li>
            <li>
                <span className="text-[#d07f2f]">보너스:</span> 매칭할 때마다 시간이 <span className="text-green-600">2초</span> 늘어납니다!
            </li>
            <li>
                <span className="text-[#d07f2f]">아이템:</span> 힌트와 섞기를 전략적으로 사용해보세요.
            </li>
        </ul>
    </div>

    <div className="relative z-10 w-full">
      <ActionButton onClick={onClose} colorClass="glossy-blue">GAME START</ActionButton>
    </div>
  </ModalOverlay>
);

export const AdConfirmModal = ({ type, onConfirm, onCancel }: { type: 'hint' | 'shuffle', onConfirm: () => void, onCancel: () => void }) => (
  <ModalOverlay>
    <div className="w-11 h-11 mb-3 text-[#1f2a55]">
      {type === 'hint' ? <HintIcon /> : <ShuffleIcon />}
    </div>

    <div className="w-full text-center mb-5">
      <h2 className="text-base font-medium text-[#1f4e7e] leading-tight mb-1">
        {type === 'hint' ? '힌트를 받을까요?' : '타일을 섞을까요?'}
      </h2>
      <p className="text-sm font-normal text-[#4f6781] leading-snug break-keep">
        {type === 'hint'
          ? '광고를 시청하면 정답 하나를 바로 보여드려요.'
          : '광고를 시청하면 현재 타일을 랜덤으로 재배치해드려요.'}
      </p>
    </div>

    <div className="flex gap-3 w-full">
      <button
        onClick={onCancel}
        className={`flex-1 ${MODAL_BTN_BASE} text-[#365c7c] bg-[linear-gradient(180deg,#f8fcff_0%,#e0f0fa_100%)]`}
      >
        취소
      </button>
      <button
        onClick={onConfirm}
        className={`flex-1 ${MODAL_BTN_BASE} text-[#365c7c] bg-[linear-gradient(180deg,#f8fcff_0%,#dceefa_100%)] flex items-center justify-center`}
      >
        네, 볼게요!
      </button>
    </div>
  </ModalOverlay>
);
