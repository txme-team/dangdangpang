Original prompt: 내가 이전에 개발하던 게임이 있는데 그걸 이어서 작업하고 싶어. github에 파일이 올라가있는데, 이어서 작업할 수 있도록 세팅해줘

## 2026-02-23 Setup Log
- Cloned repository: https://github.com/txme-team/dangdangpang
- Installed dependencies with `npm install`
- Verified build succeeds with `npm run build`
- Removed Gemini env dependency from `vite.config.ts`
- Updated README to remove AI Studio/Gemini key requirement
- Pulled character assets from Figma node `KOqXpBGs5YxUQOPhORSvCh` and switched tile rendering from SVG icon components to image sprites
- Added character metadata (type/name/sprite crop config) from Figma names
- Added `Jindo` from Figma node `171:67` as character type `12` (sprite config + local asset)
- Updated level tile type counts to fit available Figma character set
- Improved board generation to randomly choose character types from the full Figma set each run (so new breeds like Jindo can appear from early levels without increasing level difficulty setting)
- Switched rewarded ads from Toss flow to Google AdMob (native app runtime):
  - `utils/ads.ts` now uses Capacitor AdMob plugin flow
  - Added env-based ad config (`VITE_ADMOB_ANDROID_REWARDED_ID`, `VITE_ADMOB_IOS_REWARDED_ID`, `VITE_ADMOB_TEST_MODE`)
  - Web(localhost) keeps simulated reward fallback for development only
- RN migration prep:
  - Added storage abstraction `utils/storage.ts` (`KeyValueStorage`), with browser localStorage + memory fallback
  - Updated `utils/db.ts` to depend on storage abstraction instead of direct `localStorage`
  - Added `window` guards in `App.tsx` event-listener effects for safer non-web runtime behavior
  - Added service interfaces:
    - `SoundService` in `utils/audio.ts` (exported as `soundService`)
    - `UserDataService` in `utils/db.ts` (exported as `userDataService`)
  - Added service contracts and platform composition:
    - `services/contracts.ts`
    - `services/platformServices.ts`
    - App/Auth/Login now consume `platformServices` instead of importing low-level utils directly
  - Moved shared `RankingEntry` type to `types.ts` to decouple UI from DB implementation details
  - Extracted game-session pure logic to `utils/gameSession.ts`:
    - timer guard (`shouldRunGameTimer`)
    - match reward calculation (`evaluateMatchReward`)
- Visual redesign pass (not just palette swap):
  - Re-themed to "puppy card table" mood with layered lounge background + paw pattern
  - Reworked main shell/header/panel/button visual language (rounded card deck feel)
  - Increased practical tile size by rendering board as playable area (7x10) instead of including invisible border cells in UI grid
  - Kept tile count and game rules unchanged; updated path line mapping to remain accurate with hidden logical border
- Verified build succeeds after character image migration

## Current Status
- Local project is ready for development.
- To run locally: `npm run dev`
- Gemini API key is no longer required for local startup.
- Optional env (if using Supabase sync): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Tile characters now use Figma-based image sprites and Figma breed names.

## TODO / Next Agent Notes
- Confirm runtime behavior in browser (tile sprite crop/alignment on multiple screen sizes).
- Add or verify game test loop if continuing feature work (Playwright skill workflow).
- If additional Figma dog names are finalized, append them to `constants/characters.ts` and increase `CHARACTER_COUNT` usage in level configs.

## 2026-02-23 Asset Consistency Fix
- User provided `/Users/doyoulovez/Downloads/미니 시트` as source of truth.
- Verified all 12 source PNGs and `/public/characters/*.png` are byte-identical (SHA-1 all matched).
- Simplified tile image rendering in `components/Tile.tsx`:
  - Removed aspect-ratio/absolute positioning crop logic.
  - Now renders each tile image as `w-full h-full object-contain` with `pixelated`.
- Added asset-version query string in `constants/characters.ts` (`mini-sheet-20260223-1`) to force browser cache refresh for character PNGs.
- Verified build passes after changes.

## 2026-02-23 Retro UI Pass (Icons/Modals)
- Replaced `components/Icons.tsx` with a clean pixel-icon set (gear/shuffle/star/clock/video/pause/play/sound/hint/trophy + sad/happy dog faces).
- Removed previous glossy/vector dog icon block to avoid mixed visual language.
- Updated modal shell in `components/Modals.tsx` to a stricter pixel-window tone:
  - darker overlay
  - double-frame style
  - less rounded/softer button style
  - icon badge frame changed from rounded to square
- Verified production build succeeds after retro pass.

## 2026-02-23 Retro Theme Rework (8-bit Arcade)
- Reworked global visual tokens in `index.html` to a dark arcade backdrop + warm pixel panel contrast.
- Updated shared UI primitives (`ui-shell`, `ui-header`, `ui-panel`, `ui-mini-btn`, action buttons, tags) for stronger 8-bit framing and contrast.
- Rebuilt `components/LoginScreen.tsx` to remove vector mascot/logo and use a simple pixel-login card with character PNG (`/characters/jindo.png`).
- Refined `components/Modals.tsx` into consistent pixel-window style (frame, icon slot, ranking palette, action button borders).
- Adjusted in-game header/menu text colors in `App.tsx` to match the new dark-header palette and readability.
- Verified build passes after the rework.

## 2026-02-23 UI Reference Match Pass (Icon + Radius)
- Applied image-reference style cues (capsule bars + rounded icon badges) to gameplay HUD:
  - `App.tsx`: changed top HUD into pill-based `LV / score` layout and right-side rounded square icon buttons.
  - `App.tsx`: moved timer into dedicated capsule row (`retro-pill-time`) to match reference rhythm.
- Added reusable radius/icon classes in `index.html`:
  - `retro-pill`, `retro-pill-blue`, `retro-pill-gold`, `retro-pill-time`, `retro-pill-coin`, `retro-icon-btn`
  - Increased roundness on action buttons and mini controls.
- Reworked `GearIcon` in `components/Icons.tsx` to a cleaner gray mechanical style aligned with the reference icon family.
- Verified build passes.

## 2026-02-23 Settings UX Simplification
- Removed settings popup menu from `App.tsx` as requested.
- Replaced popup behavior with directly listed header buttons:
  - pause/resume icon button
  - sound toggle icon button
  - retry button
- Removed unused `showSettings` state/toggle code and related click guards.
- Verified build passes.

## 2026-02-23 Final Clear Confetti
- Added pixel-art confetti burst effect for final game clear popup (`GameCompleteModal`) in `components/Modals.tsx`.
- Implemented procedural confetti particles (color/angle/duration variance) with a looping burst pattern centered behind the trophy/title.
- Added shared confetti animation styles in `index.html`:
  - `@keyframes pixel-confetti-burst`
  - `.pixel-confetti-dot`
- Verified build passes.

## 2026-02-23 BUIZE-Style Full Theme Pass (DangDangPang Palette)
- Reworked global visual language to match the latest reference screenshots (BUIZE-like 8bit UI):
  - lavender/blue phone UI frame
  - glossy pixel bars/buttons
  - layered panel framing and dot texture background
- Updated `index.html` style tokens and primitives:
  - `bg-dog-lounge`, `bg-retro-stripe`, `bg-retro-grid`
  - `ui-shell`, `ui-header`, `ui-panel`, `retro-pill*`, `retro-icon-btn`
  - action button skins (`ui-action-hint`, `ui-action-shuffle`)
  - refreshed pixel corner shapes (`pixel-round-2/3/4`) for a cleaner retro edge profile
- Updated in-game layout in `App.tsx`:
  - header changed to 2-row status bar (`DANGDANGPANG` title + icon controls + LV/score/timer)
  - board section kept full-height with new panel skin
  - bottom control bar reskinned to match reference rhythm
- Updated `components/Modals.tsx`:
  - modal shell, ranking list, and all CTA buttons moved to same lavender-blue frame system
  - accent colors use DangDangPang warm tones (butter/caramel) instead of pure cold blue
- Updated `components/LoginScreen.tsx` to the same visual system.
- Verification:
  - `npm run build` passed.
  - Dev server running at `http://localhost:3000/` and `http://192.168.219.101:3000/`.
  - Playwright skill client attempt failed because `playwright` package is not installed in current environment.

## 2026-02-26 Mobile Audio Bridge Hardening + Debug Overlay
- Implemented gesture-stack audio unlock hardening in `/Users/doyoulovez/Documents/dangdangpang/utils/audio.ts`:
  - `forceUnlockFromUserGesture(reason)` performs create+resume+short pulse in the direct user-input call stack (no `await` in handler path).
  - Added debug state publishing via `window.__DANGDANG_SOUND_DEBUG__` and `dangdang:sound-debug` custom event.
  - Added lifecycle resume handlers for `visibilitychange`, `pageshow`, `focus`, and `pagehide` recovery.
  - Enforced RN WebView mode to never create `AudioContext`; WebView path now only posts `PLAY_SOUND` to native.
- Added mobile-visible sound debug overlay in `/Users/doyoulovez/Documents/dangdangpang/App.tsx`:
  - Shows mode, context state, unlock status, last resume result/time, and last error.
  - Added unlock listeners that call `sound.forceUnlockFromUserGesture()` directly from gesture handlers.
- Added RN-side bridge/audio diagnostics in `/Users/doyoulovez/Documents/dangdangpang/mobile/App.tsx`:
  - logs raw onMessage payload receipt/parsing,
  - logs per-sound preload start/success/failure,
  - logs replay request + success/failure + missing-preload cases.
- Updated `/Users/doyoulovez/Documents/dangdangpang/services/contracts.ts` with `SoundDebugState` and optional debug APIs on `SoundService`.
- Validation:
  - `npm run build` passed.
  - `cd mobile && npx tsc --noEmit` passed.
