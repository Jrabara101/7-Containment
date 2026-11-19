export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type GameOutcome = 'none' | 'victory' | 'defeat';

export type WeaponId = 'none' | 'wrench' | 'pistol';

export type EnemyAIState = 'idle' | 'alert' | 'chase' | 'windup' | 'attack' | 'dead';

export type PickupType = 'wrench' | 'pistol' | 'ammo' | 'health' | 'armor';

export type StoryStage =
  | 'train_transit'
  | 'train_arrived'
  | 'escort_walking'
  | 'lobby_entered'
  | 'facility_breach';

export interface DossierInfo {
  name: string;
  age: number;
  occupation: string;
}

export interface SavedGameData {
  version: number;
  savedAt: string;
  zoneName: string;
  storyStage: StoryStage;
  dossier: DossierInfo;
  health: number;
  armor: number;
  position: { x: number; y: number; z: number };
  yaw: number;
}

export interface GameSettings {
  mouseSensitivity: number; // 0.2 to 2.5, default 1.0
  masterVolume: number; // 0.0 to 1.0, default 0.7
  muted: boolean;
}

export interface HudSnapshot {
  phase: GamePhase;
  outcome: GameOutcome;
  health: number;
  armor: number;
  activeWeapon: WeaponId;
  hasWrench: boolean;
  hasPistol: boolean;
  magAmmo: number;
  reserveAmmo: number;
  isReloading: boolean;
  holdingProp: boolean;
  interactPrompt: string | null;
  bannerText: string | null;
  enemiesKilled: number;
  totalEnemies: number;
  elapsedSeconds: number;
  damageTaken: number;
  damageFlash: number; // 0..1
  pointerLocked: boolean;
  zoneName: string;
  storyStage: StoryStage;
  etaSeconds: number;
  intercomSpeaker: string | null;
  intercomLine: string | null;
  showDossierCard: boolean;
  savedTimestamp: string | null;
}

export interface RunSummary {
  outcome: GameOutcome;
  elapsedSeconds: number;
  enemiesKilled: number;
  totalEnemies: number;
  damageTaken: number;
  zoneReached: string;
}
