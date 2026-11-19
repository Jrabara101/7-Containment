import React from 'react';
import { formatRunTime } from '../game/rules';
import type { GameOutcome, GamePhase, GameSettings, HudSnapshot } from '../game/types';

interface MenuOverlaysProps {
  phase: GamePhase;
  outcome: GameOutcome;
  hud: HudSnapshot;
  settings: GameSettings;
  onStart: () => void;
  onLoadSave: () => void;
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
  onUpdateSettings: (next: GameSettings) => void;
}

export const MenuOverlays: React.FC<MenuOverlaysProps> = ({
  phase,
  outcome,
  hud,
  settings,
  onStart,
  onLoadSave,
  onResume,
  onRestart,
  onTitle,
  onUpdateSettings,
}) => {
  if (phase === 'playing') return null;

  if (phase === 'title') {
    return (
      <div
        className="fixed inset-0 z-20 flex flex-col justify-between p-8 md:p-12 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(8,10,13,0.78) 0%, rgba(8,10,13,0.42) 38%, rgba(8,10,13,0.0) 68%)',
        }}
      >
        {/* Left-third negative-space framing over live backdrop */}
        <div className="max-w-xl mt-6 md:mt-12 pointer-events-auto">
          {/* Bespoke inline SVG Title Lockup */}
          <svg
            viewBox="0 0 560 155"
            className="w-full max-w-[520px] h-auto mb-6 drop-shadow-[0_6px_18px_rgba(0,0,0,0.9)]"
            aria-label="Sector 7: Containment Breach"
          >
            <polygon points="0,12 24,12 14,28 0,28" fill="#e6a23c" />
            <polygon points="30,12 46,12 36,28 20,28" fill="#df3b2c" />
            <text
              x="58"
              y="26"
              fill="#d5cfc2"
              fontSize="14"
              fontWeight="700"
              letterSpacing="5"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              SUBLEVEL RESEARCH FACILITY // 1998
            </text>
            <text
              x="0"
              y="90"
              fill="#f3ede0"
              fontSize="66"
              fontWeight="900"
              letterSpacing="3"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              SECTOR 7
            </text>
            <rect x="0" y="106" width="500" height="4" fill="#e6a23c" />
            <text
              x="0"
              y="140"
              fill="#df3b2c"
              fontSize="26"
              fontWeight="800"
              letterSpacing="7"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              CONTAINMENT BREACH
            </text>
          </svg>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="px-7 py-3.5 bg-[#e6a23c] hover:bg-[#f0b454] text-[#0c0e11] font-black text-base tracking-[0.18em] uppercase border-b-4 border-[#9c6615] active:translate-y-0.5 transition-colors cursor-pointer"
            >
              Enter Facility
            </button>

            {hud.savedTimestamp && (
              <button
                type="button"
                data-load-save="true"
                onClick={onLoadSave}
                title={`Saved in Stronghold Lobby at ${hud.savedTimestamp}`}
                className="px-5 py-3.5 bg-[#12181f]/95 hover:bg-[#1b242e] text-[#e8e2d5] font-bold text-sm tracking-[0.14em] uppercase border border-[#4ea3d8] border-b-4 border-b-[#2c658a] active:translate-y-0.5 transition-colors cursor-pointer"
              >
                Continue Lobby Save ({hud.savedTimestamp})
              </button>
            )}
          </div>
        </div>

        {/* Single flat borderless control-hint line */}
        <div className="text-xs font-semibold tracking-[0.14em] uppercase text-[#bfb8aa] hud-text-shadow">
          WASD Move · Mouse Look · Click Attack · E Grab/Save · R Reload · 1/2 Weapons · Space Jump · Shift Sprint · Ctrl Crouch · Esc Pause
        </div>
      </div>
    );
  }

  if (phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090b]/80 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          className="w-full max-w-md bg-[#111519] border-2 border-[#39424b] border-t-4 border-t-[#e6a23c] p-6 shadow-2xl"
        >
          <h2
            id="pause-title"
            className="text-2xl font-black tracking-[0.18em] uppercase text-[#f0ebe1] mb-5"
          >
            Simulation Paused
          </h2>

          <div className="space-y-4 mb-6">
            <label className="block">
              <div className="flex justify-between text-xs font-bold tracking-[0.14em] uppercase text-[#b6afa2] mb-1.5">
                <span>Mouse Sensitivity</span>
                <span className="tabular-nums text-[#e6a23c]">
                  {settings.mouseSensitivity.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={2.5}
                step={0.1}
                value={settings.mouseSensitivity}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    mouseSensitivity: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-[#e6a23c] cursor-pointer"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs font-bold tracking-[0.14em] uppercase text-[#b6afa2] mb-1.5">
                <span>Master Volume</span>
                <span className="tabular-nums text-[#e6a23c]">
                  {settings.muted ? 'MUTED' : `${Math.round(settings.masterVolume * 100)}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.masterVolume}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    masterVolume: parseFloat(e.target.value),
                    muted: false,
                  })
                }
                className="w-full accent-[#e6a23c] cursor-pointer"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 bg-[#e6a23c] hover:bg-[#f0b454] text-[#0b0d10] font-black text-sm tracking-[0.18em] uppercase cursor-pointer"
            >
              Resume
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onRestart}
                className="py-2.5 bg-[#1c2228] hover:bg-[#262e36] border border-[#3c4650] text-[#e8e2d5] font-bold text-xs tracking-[0.16em] uppercase cursor-pointer"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={onTitle}
                className="py-2.5 bg-[#1c2228] hover:bg-[#262e36] border border-[#3c4650] text-[#b4aea2] font-bold text-xs tracking-[0.16em] uppercase cursor-pointer"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Victory / Game Over Modal
  const isVictory = outcome === 'victory';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090b]/84 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outcome-title"
        className={`w-full max-w-md bg-[#111519] border-2 border-[#39424b] border-t-4 p-6 shadow-2xl ${
          isVictory ? 'border-t-[#3ee08f]' : 'border-t-[#df3b2c]'
        }`}
      >
        <div
          className={`text-xs font-bold tracking-[0.22em] uppercase mb-1 ${
            isVictory ? 'text-[#3ee08f]' : 'text-[#df3b2c]'
          }`}
        >
          {isVictory ? 'Extraction Lift Reached' : 'Vital Signs Terminated'}
        </div>
        <h2
          id="outcome-title"
          className="text-3xl font-black tracking-[0.14em] uppercase text-[#f3ede0] mb-5"
        >
          {isVictory ? 'Sector Cleared' : 'Containment Failure'}
        </h2>

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="bg-[#181e24] border border-[#2d353e] p-3">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8e969e] mb-1">
              Time
            </div>
            <div className="text-lg font-black tabular-nums text-[#f0ebe1]">
              {formatRunTime(hud.elapsedSeconds)}
            </div>
          </div>

          <div className="bg-[#181e24] border border-[#2d353e] p-3">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8e969e] mb-1">
              Enemies Killed
            </div>
            <div className="text-lg font-black tabular-nums text-[#e6a23c]">
              {hud.enemiesKilled} / {hud.totalEnemies}
            </div>
          </div>

          <div className="bg-[#181e24] border border-[#2d353e] p-3">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8e969e] mb-1">
              {isVictory ? 'Dmg Taken' : 'Zone'}
            </div>
            <div className="text-sm font-black tabular-nums text-[#d8d2c5] truncate">
              {isVictory ? `${Math.round(hud.damageTaken)}` : hud.zoneName}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onRestart}
            className={`w-full py-3 font-black text-sm tracking-[0.18em] uppercase cursor-pointer ${
              isVictory
                ? 'bg-[#3ee08f] hover:bg-[#57ea9f] text-[#09120d]'
                : 'bg-[#df3b2c] hover:bg-[#ef4c3d] text-[#fff6f5]'
            }`}
          >
            {isVictory ? 'Play Again' : 'Restart'}
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-2.5 bg-[#1c2228] hover:bg-[#262e36] border border-[#3c4650] text-[#b4aea2] font-bold text-xs tracking-[0.16em] uppercase cursor-pointer"
          >
            Title Screen
          </button>
        </div>
      </div>
    </div>
  );
};
