import React, { useEffect, useState } from 'react';
import { formatEtaCountdown, PLAYER_DOSSIER } from '../game/rules';
import type { HudSnapshot } from '../game/types';

interface HudOverlayProps {
  hud: HudSnapshot;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  onRequestLock: () => void;
  onSkipTransit: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  muted,
  onToggleMute,
  onPause,
  onRequestLock,
  onSkipTransit,
}) => {
  const [ghostHealth, setGhostHealth] = useState(hud.health);

  useEffect(() => {
    if (hud.health >= ghostHealth) {
      setGhostHealth(hud.health);
      return;
    }
    const timer = window.setTimeout(() => {
      setGhostHealth(hud.health);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [hud.health, ghostHealth]);

  const lowHealth = hud.health > 0 && hud.health <= 25;
  const flashOpacity = Math.max(hud.damageFlash * 0.52, lowHealth ? 0.22 : 0);

  return (
    <div className="fixed inset-0 pointer-events-none z-10 select-none">
      {/* Damage Flash & Low-HP Peripheral Vignette */}
      <div
        aria-hidden="true"
        className="fixed inset-0 transition-opacity duration-75"
        style={{
          opacity: flashOpacity,
          background:
            'radial-gradient(circle at center, rgba(190, 24, 18, 0.05) 42%, rgba(205, 22, 16, 0.85) 100%)',
        }}
      />

      {/* Top-Left Static Zone Readout */}
      <div className="fixed top-4 left-5 flex flex-col gap-0.5 hud-text-shadow">
        <span className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#e6a23c]">
          SECTOR 07 // CONTAINMENT
        </span>
        <span
          data-testid="hud-zone"
          className="text-sm font-bold tracking-[0.14em] uppercase text-[#e8e2d5]"
        >
          {hud.zoneName}
        </span>
        {hud.savedTimestamp && hud.zoneName === 'Stronghold Lobby' && (
          <span
            data-testid="hud-saved-badge"
            className="mt-0.5 text-[10px] font-bold tracking-[0.16em] uppercase text-[#4de08c]"
          >
            CONSOLE SAVED // {hud.savedTimestamp}
          </span>
        )}
      </div>

      {/* Top-Right Compact Utility Controls */}
      <div className="fixed top-4 right-5 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          aria-label={muted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
          title={muted ? 'Unmute (M)' : 'Mute (M)'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          className="w-9 h-9 flex items-center justify-center rounded-sm bg-[#101418]/90 border border-[#3a434c] text-[#d8d2c5] hover:border-[#e6a23c] hover:text-[#e6a23c] transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth={2}>
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" fillOpacity={0.2} />
            {muted ? (
              <path d="M22 9l-6 6M16 9l6 6" strokeLinecap="round" />
            ) : (
              <>
                <path d="M15.5 8.5a5 5 0 010 7" strokeLinecap="round" />
                <path d="M18.5 5.5a9 9 0 010 13" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Pause Game [Esc]"
          title="Pause (Esc / P)"
          onClick={(e) => {
            e.currentTarget.blur();
            onPause();
          }}
          className="w-9 h-9 flex items-center justify-center rounded-sm bg-[#101418]/90 border border-[#3a434c] text-[#d8d2c5] hover:border-[#e6a23c] hover:text-[#e6a23c] transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <rect x="6" y="5" width="4" height="14" rx="0.5" />
            <rect x="14" y="5" width="4" height="14" rx="0.5" />
          </svg>
        </button>
      </div>

      {/* Compact Transit Dossier & ETA Card (Visible during train transit only) */}
      {hud.showDossierCard && (
        <div
          data-testid="hud-dossier"
          className="fixed top-16 right-5 w-[312px] bg-[#0e1318]/92 border border-[#2f3842] border-l-4 border-l-[#e6a23c] px-3.5 py-2.5 hud-text-shadow"
        >
          <div className="flex items-center justify-between border-b border-[#252d36] pb-1.5 mb-2">
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#8fa1b3]">
              PERSONNEL DOSSIER
            </span>
            <span
              data-testid="hud-eta"
              className="text-xs font-black tracking-[0.14em] tabular-nums text-[#e6a23c]"
            >
              ETA {formatEtaCountdown(hud.etaSeconds)}
            </span>
          </div>
          <div className="space-y-0.5 text-[11px] leading-snug">
            <div className="font-bold text-[#f0ebe1] tracking-wide">
              {PLAYER_DOSSIER.name}
            </div>
            <div className="text-[#a8b3be] font-medium">
              Age {PLAYER_DOSSIER.age} · {PLAYER_DOSSIER.occupation}
            </div>
          </div>
          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              tabIndex={-1}
              data-testid="skip-transit-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                onSkipTransit();
              }}
              className="pointer-events-auto px-2.5 py-1 bg-[#182028] hover:bg-[#232e39] border border-[#e6a23c]/70 text-[10px] font-bold tracking-[0.16em] uppercase text-[#f5d28c] cursor-pointer transition-colors"
            >
              [F] Skip To Station
            </button>
          </div>
        </div>
      )}

      {/* Scripted Event / Pickup Banner */}
      {hud.bannerText && (
        <div
          data-testid="hud-banner"
          className="fixed top-5 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#12161a]/92 border-l-2 border-r-2 border-[#e6a23c] text-xs font-bold tracking-[0.18em] uppercase text-[#f4e8cf] hud-text-shadow whitespace-nowrap"
        >
          {hud.bannerText}
        </div>
      )}

      {/* PA Speaker / Radio Intercom Transmission */}
      {hud.intercomLine && (
        <div
          data-testid="hud-intercom"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[min(640px,calc(100vw-2rem))] px-4 py-2.5 bg-[#0c1116]/92 border border-[#2f3b47] border-l-4 border-l-[#4ea3d8] hud-text-shadow"
        >
          {hud.intercomSpeaker && (
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#6fc2f2] mb-1">
              {hud.intercomSpeaker}
            </div>
          )}
          <div className="text-xs sm:text-[13px] font-medium leading-relaxed text-[#ece6da]">
            “{hud.intercomLine}”
          </div>
        </div>
      )}

      {/* Pointer Lock Reminder (bottom-center, non-overlapping) */}
      {!hud.pointerLocked && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onRequestLock();
          }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 pointer-events-auto px-3.5 py-1.5 bg-[#11161b]/92 border border-[#3e4852] text-[11px] font-semibold tracking-[0.15em] uppercase text-[#c7c0b2] hover:border-[#e6a23c] hover:text-[#e6a23c] cursor-pointer"
        >
          Click Viewport To Lock Mouse
        </button>
      )}

      {/* Center Reticle */}
      <div
        aria-hidden="true"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6">
          <circle cx="12" cy="12" r="1.4" fill="#e8e2d5" fillOpacity="0.92" />
          <path
            d="M12 3v4M12 17v4M3 12h4M17 12h4"
            stroke={hud.activeWeapon === 'pistol' ? '#e6a23c' : '#e8e2d5'}
            strokeWidth="1.6"
            strokeOpacity="0.88"
            strokeLinecap="square"
          />
        </svg>
      </div>

      {/* Center-Bottom Interaction Prompt */}
      {hud.interactPrompt && (
        <div className="fixed left-1/2 top-[56%] -translate-x-1/2 px-3 py-1 bg-[#0f1317]/90 border border-[#e6a23c]/60 text-[11px] font-bold tracking-[0.16em] uppercase text-[#f2d08a] hud-text-shadow whitespace-nowrap">
          {hud.interactPrompt}
        </div>
      )}

      {/* Bottom-Left: Health & Armor Cluster */}
      <div className="fixed bottom-5 left-5 flex items-end gap-5 px-4 py-3 bg-[#0e1216]/88 border-l-4 border-[#e6a23c] border-t border-r border-b border-t-[#2c333b] border-r-[#2c333b] border-b-[#2c333b]">
        {/* Health */}
        <div className="flex flex-col gap-1 min-w-[116px]">
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#df3b2c]" aria-hidden="true">
              <path
                d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"
                fill="currentColor"
                stroke="#140908"
                strokeWidth="1.5"
              />
            </svg>
            <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#a3aab0]">
              HEALTH
            </span>
          </div>
          <div
            data-testid="hud-health"
            className={`text-3xl font-black leading-none tabular-nums hud-text-shadow ${
              lowHealth ? 'text-[#ff5342]' : 'text-[#f0ebe1]'
            }`}
          >
            {Math.round(hud.health)}
          </div>
          <div className="relative h-1.5 w-full bg-[#1d2329] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[#f0a548] transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, ghostHealth))}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[#df3b2c] transition-all duration-75"
              style={{ width: `${Math.max(0, Math.min(100, hud.health))}%` }}
            />
          </div>
        </div>

        {/* Armor */}
        <div className="flex flex-col gap-1 min-w-[104px]">
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#4ea3d8]" aria-hidden="true">
              <path
                d="M12 2L4 5.5v6.2c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V5.5L12 2z"
                fill="currentColor"
                fillOpacity={0.85}
                stroke="#0b151c"
                strokeWidth="1.5"
              />
            </svg>
            <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#a3aab0]">
              ARMOR
            </span>
          </div>
          <div
            data-testid="hud-armor"
            className="text-3xl font-black leading-none tabular-nums text-[#7ec4ef] hud-text-shadow"
          >
            {Math.round(hud.armor)}
          </div>
          <div className="relative h-1.5 w-full bg-[#1d2329] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[#4ea3d8] transition-all duration-100"
              style={{ width: `${Math.max(0, Math.min(100, hud.armor))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom-Right: Weapon & Ammo Cluster */}
      <div className="fixed bottom-5 right-5 flex flex-col items-end gap-2 px-4 py-3 bg-[#0e1216]/88 border-r-4 border-[#e6a23c] border-t border-l border-b border-t-[#2c333b] border-l-[#2c333b] border-b-[#2c333b]">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] uppercase">
          <span
            className={`px-1.5 py-0.5 border ${
              hud.activeWeapon === 'wrench'
                ? 'border-[#e6a23c] bg-[#e6a23c]/20 text-[#f5d28c]'
                : hud.hasWrench
                  ? 'border-[#3a434c] text-[#98a1a8]'
                  : 'border-[#252b30] text-[#495158]'
            }`}
          >
            [1] WRENCH
          </span>
          <span
            className={`px-1.5 py-0.5 border ${
              hud.activeWeapon === 'pistol'
                ? 'border-[#e6a23c] bg-[#e6a23c]/20 text-[#f5d28c]'
                : hud.hasPistol
                  ? 'border-[#3a434c] text-[#98a1a8]'
                  : 'border-[#252b30] text-[#495158]'
            }`}
          >
            [2] 9MM PISTOL
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          {hud.activeWeapon === 'pistol' ? (
            <>
              <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-[#a3aab0]">
                {hud.isReloading ? 'RELOADING' : 'AMMO'}
              </span>
              <span
                data-testid="hud-ammo"
                className="text-3xl font-black leading-none tabular-nums text-[#e6a23c] hud-text-shadow"
              >
                {hud.magAmmo}
              </span>
              <span className="text-base font-bold tabular-nums text-[#8e969d]">
                / {hud.reserveAmmo}
              </span>
            </>
          ) : hud.activeWeapon === 'wrench' ? (
            <span
              data-testid="hud-ammo"
              className="text-2xl font-black tracking-[0.12em] uppercase text-[#e8e2d5] hud-text-shadow"
            >
              MELEE
            </span>
          ) : (
            <span
              data-testid="hud-ammo"
              className="text-xl font-bold tracking-[0.14em] uppercase text-[#7f878e]"
            >
              UNARMED
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
