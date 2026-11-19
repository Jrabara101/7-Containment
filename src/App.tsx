import { useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { MenuOverlays } from './components/MenuOverlays';
import { GameEngine } from './game/engine';
import type { GameSettings, HudSnapshot } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  outcome: 'none',
  health: 100,
  armor: 0,
  activeWeapon: 'none',
  hasWrench: false,
  hasPistol: false,
  magAmmo: 12,
  reserveAmmo: 48,
  isReloading: false,
  holdingProp: false,
  interactPrompt: null,
  bannerText: null,
  enemiesKilled: 0,
  totalEnemies: 5,
  elapsedSeconds: 0,
  damageTaken: 0,
  damageFlash: 0,
  pointerLocked: false,
  zoneName: 'Transit Train',
  storyStage: 'train_transit',
  etaSeconds: 300,
  intercomSpeaker: null,
  intercomLine: null,
  showDossierCard: true,
  savedTimestamp: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [settings, setSettings] = useState<GameSettings>({
    mouseSensitivity: 1.0,
    masterVolume: 0.7,
    muted: false,
  });

  useEffect(() => {
    document.body.dataset.state = 'title';
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new GameEngine(mount, settings, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.startNewGame();
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // Intentionally initialize renderer & scene once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter or Space on Title screen starts the game
  useEffect(() => {
    const onTitleKey = (e: KeyboardEvent) => {
      if (hud.phase !== 'title') return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        engineRef.current?.startNewGame();
      }
    };
    window.addEventListener('keydown', onTitleKey);
    return () => window.removeEventListener('keydown', onTitleKey);
  }, [hud.phase]);

  const handleUpdateSettings = (next: GameSettings) => {
    setSettings(next);
    engineRef.current?.updateSettings(next);
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#090c0f]">
      {/* Isolated WebGL mount container */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas"
        className="w-full h-full"
      />

      {hud.phase === 'playing' && (
        <HudOverlay
          hud={hud}
          muted={settings.muted}
          onToggleMute={() =>
            handleUpdateSettings({ ...settings, muted: !settings.muted })
          }
          onPause={() => engineRef.current?.pauseGame()}
          onRequestLock={() => engineRef.current?.requestPointerLock()}
          onSkipTransit={() => engineRef.current?.skipTransit()}
        />
      )}

      <MenuOverlays
        phase={hud.phase}
        outcome={hud.outcome}
        hud={hud}
        settings={settings}
        onStart={() => {
          (document.activeElement as HTMLElement | null)?.blur?.();
          engineRef.current?.startNewGame();
        }}
        onLoadSave={() => {
          (document.activeElement as HTMLElement | null)?.blur?.();
          engineRef.current?.loadSavedLobby();
        }}
        onResume={() => {
          (document.activeElement as HTMLElement | null)?.blur?.();
          engineRef.current?.resumeGame();
        }}
        onRestart={() => {
          (document.activeElement as HTMLElement | null)?.blur?.();
          engineRef.current?.startNewGame();
        }}
        onTitle={() => engineRef.current?.returnToTitle()}
        onUpdateSettings={handleUpdateSettings}
      />
    </main>
  );
}
