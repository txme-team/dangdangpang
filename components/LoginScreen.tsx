import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { platformServices } from '../services/platformServices';

const LoginScreen: React.FC = () => {
  const { sound } = platformServices;
  const { login, isLoading } = useAuth();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();

    if (!trimmed) {
      setError('닉네임을 입력해주세요!');
      sound.playError();
      return;
    }
    if (trimmed.length > 8) {
      setError('닉네임은 8글자 이하로 해주세요.');
      sound.playError();
      return;
    }

    sound.init();
    sound.playSelect();
    await login(trimmed);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-retro-stripe p-4 overflow-hidden select-none">
      <div className="ui-shell pixel-sheet-corner p-2 w-full max-w-[360px] overflow-hidden">
        <div className="pixel-sheet-corner border border-[#1f4e7e] bg-[#d5e9f8] overflow-hidden">
          <div className="h-10 bg-[linear-gradient(180deg,#eef8ff_0%,#d4ebf9_100%)] border-b border-[#7faecb] flex items-center justify-between px-3 text-[#1f4e7e]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#7faecb] border border-[#5b86a4]" />
              <span className="w-2 h-2 rounded-full bg-[#9cc0d8] border border-[#6e96b2]" />
              <span className="w-2 h-2 rounded-full bg-[#b7d6e9] border border-[#81a9c2]" />
              <span className="text-xs tracking-wider font-bold ml-2">LOGIN</span>
            </div>
            <span className="text-[10px] opacity-80">v2.1</span>
          </div>

          <div
            className="px-4 py-14"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(93,140,178,0.12) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 100%)',
              backgroundSize: '8px 8px, 100% 100%',
            }}
          >
            <div className="w-full mb-10 px-5 py-8 bg-[linear-gradient(180deg,#d8ecfb_0%,#c6e2f6_100%)] pixel-btn-corner">
              <div className="w-full h-[98px] flex items-center justify-center mb-6">
                <img
                  src="/icons/dangdangpang-logo.png?v=20260224-1"
                  alt="Dangdangpang logo"
                  className="max-w-full max-h-full object-contain animate-home-logo-bounce"
                  style={{ imageRendering: 'pixelated' }}
                  draggable={false}
                />
              </div>
              <p className="px-1 text-center text-[12px] font-semibold leading-snug tracking-wide text-[#2d5d88]" style={{ fontFamily: "'DotGothic16', sans-serif" }}>
                Match puppy pairs and pop the board!<br />
                Tap fast and chase a high score!
              </p>
            </div>

            <form onSubmit={handleLogin} className="w-full flex flex-col">
              <label className="text-xs font-bold text-[#1a2242] tracking-wider mb-3">NICKNAME</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setError('');
                }}
                placeholder="닉네임 입력"
                className="w-full h-11 px-3 pixel-btn-corner bg-[#f4fcff] border border-[#1f4e7e] text-center text-[14px] text-[#1f4e7e] placeholder:text-[14px] placeholder-[#6490af] focus:outline-none"
              />
              {error && (
                <div className="text-center text-xs font-bold text-[#a32626] bg-[#ffe2e2] border border-[#a32626] py-1 px-2 mt-2 pixel-btn-corner-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="h-12 mt-11 bg-[linear-gradient(180deg,#ffe9ab_0%,#ffd65c_55%,#f2b33f_100%)] border border-[#92521a] text-[#5b360f] font-bold text-base tracking-wide shadow-[2px_2px_0_rgba(122,72,23,0.35)] active:translate-y-1 active:shadow-none disabled:opacity-60 pixel-btn-corner"
              >
                {isLoading ? 'LOADING...' : 'PRESS START'}
              </button>

              <a
                href="/privacy/"
                className="mt-5 text-center text-[12px] font-medium tracking-wide text-[#3f6d92] underline underline-offset-2 hover:text-[#1f4e7e] active:text-[#1f4e7e]"
                onClick={() => {
                  sound.init();
                  sound.playSelect();
                }}
              >
                개인정보처리방침
              </a>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
