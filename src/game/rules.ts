import type { DossierInfo, EnemyAIState, SavedGameData, WeaponId } from './types';

export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_ARMOR = 100;
export const PISTOL_MAG_SIZE = 12;
export const PISTOL_START_RESERVE = 48;
export const PISTOL_DAMAGE = 34; // 3 shots to kill 100 HP mutant
export const WRENCH_DAMAGE = 26; // 4 hits to kill 100 HP mutant
export const ENEMY_MAX_HP = 100;
export const EXPLOSION_RADIUS = 6.5;
export const EXPLOSION_MAX_DAMAGE = 125;

export const SAVE_STORAGE_KEY = 'sector7_lobby_save_v1';

export const PLAYER_DOSSIER: DossierInfo = {
  name: 'Carl James G. Bellvees',
  age: 29,
  occupation: 'Part-time Inspector Security and Scientist',
};

export interface PaBriefingCue {
  speaker: string;
  text: string;
  /** Minimum on-screen time in seconds. The line is also held until the voice finishes speaking it. */
  duration: number;
}

/** Speech-synthesis rate used for intercom lines (see engine.handleIntercomCue). */
export const INTERCOM_SPEECH_RATE = 1.02;

/**
 * Estimates how long a dialogue line takes to be spoken / read, in seconds.
 * ~2.6 words per second at rate 1.0, plus a short pause before the next line.
 * Used as a minimum hold time so lines still finish when audio is muted or
 * speech synthesis is unavailable.
 */
export function estimateLineDuration(text: string, rate = INTERCOM_SPEECH_RATE): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / (2.6 * rate) + 1.2;
}

export const PA_BRIEFING_CUES: PaBriefingCue[] = [
  {
    speaker: 'TRANSIT PA // CARRIAGE 04',
    text: 'Estimated arrival at Sector 7 Sublevel Terminal: 5 minutes. Uploading personnel dossier for Carl James G. Bellvees, age 29, Part-time Inspector Security and Scientist.',
    duration: 5.5,
  },
  {
    speaker: 'TRANSIT PA // PREVIOUS AUDIT LOG',
    text: 'Your prior safety inspections flagged unstable resonance inside Sublevel B. Unscheduled collider tests have already triggered localized temporal distortions.',
    duration: 5.5,
  },
  {
    speaker: 'TRANSIT PA // COMMAND DIRECTIVE',
    text: "Your mission is to check facilities within breach of the location and check the collider's progress to manipulate space and time within aliens, monsters and humans... You will have to carry this mission yourself.",
    duration: 6.5,
  },
  {
    speaker: 'TRANSIT PA // APPROACH CONTROL',
    text: 'Security escort is standing by on Platform Bravo. Keep your credentials ready—braking now for Sector 7 Stronghold.',
    duration: 4.5,
  },
];

export interface DamageResult {
  health: number;
  armor: number;
  healthLoss: number;
  armorLoss: number;
  dead: boolean;
}

/**
 * Applies incoming damage to player health & armor (classic shooter 60% armor absorption).
 */
export function applyPlayerDamage(
  currentHealth: number,
  currentArmor: number,
  rawDamage: number,
): DamageResult {
  if (rawDamage <= 0 || currentHealth <= 0) {
    return {
      health: Math.max(0, currentHealth),
      armor: Math.max(0, currentArmor),
      healthLoss: 0,
      armorLoss: 0,
      dead: currentHealth <= 0,
    };
  }

  let armorAbsorb = Math.min(currentArmor, Math.round(rawDamage * 0.6));
  if (currentArmor > 0 && armorAbsorb === 0) {
    armorAbsorb = Math.min(currentArmor, 1);
  }
  const healthLoss = Math.max(1, Math.round(rawDamage - armorAbsorb));
  const nextArmor = Math.max(0, currentArmor - armorAbsorb);
  const nextHealth = Math.max(0, currentHealth - healthLoss);

  return {
    health: nextHealth,
    armor: nextArmor,
    healthLoss: currentHealth - nextHealth,
    armorLoss: currentArmor - nextArmor,
    dead: nextHealth <= 0,
  };
}

export interface ReloadResult {
  magAmmo: number;
  reserveAmmo: number;
  reloaded: number;
}

export function computeReload(
  magAmmo: number,
  reserveAmmo: number,
  magCapacity: number = PISTOL_MAG_SIZE,
): ReloadResult {
  const needed = Math.max(0, magCapacity - magAmmo);
  if (needed === 0 || reserveAmmo <= 0) {
    return { magAmmo, reserveAmmo, reloaded: 0 };
  }
  const toLoad = Math.min(needed, reserveAmmo);
  return {
    magAmmo: magAmmo + toLoad,
    reserveAmmo: reserveAmmo - toLoad,
    reloaded: toLoad,
  };
}

export function computeExplosionDamage(
  distance: number,
  radius: number = EXPLOSION_RADIUS,
  maxDamage: number = EXPLOSION_MAX_DAMAGE,
): number {
  if (distance >= radius || radius <= 0) return 0;
  const t = 1 - Math.max(0, distance) / radius;
  return Math.round(maxDamage * (0.25 + 0.75 * t * t));
}

export interface EnemyTransitionInput {
  currentState: EnemyAIState;
  hp: number;
  distToPlayer: number;
  canSeePlayer: boolean;
  heardNoise: boolean;
  stateTimer: number;
  attackCooldown: number;
}

export interface EnemyTransitionOutput {
  nextState: EnemyAIState;
  resetTimer: boolean;
}

export const ENEMY_SIGHT_RANGE = 24;
export const ENEMY_HEAR_RANGE = 16;
export const ENEMY_MELEE_RANGE = 2.05;
export const ENEMY_ALERT_DURATION = 0.42;
export const ENEMY_WINDUP_DURATION = 0.38;
export const ENEMY_ATTACK_DURATION = 0.34;

export function stepEnemyStateMachine(input: EnemyTransitionInput): EnemyTransitionOutput {
  if (input.hp <= 0) {
    return {
      nextState: 'dead',
      resetTimer: input.currentState !== 'dead',
    };
  }

  switch (input.currentState) {
    case 'idle': {
      const spotted = input.canSeePlayer && input.distToPlayer <= ENEMY_SIGHT_RANGE;
      const heard = input.heardNoise && input.distToPlayer <= ENEMY_HEAR_RANGE;
      if (spotted || heard) {
        return { nextState: 'alert', resetTimer: true };
      }
      return { nextState: 'idle', resetTimer: false };
    }
    case 'alert': {
      if (input.stateTimer >= ENEMY_ALERT_DURATION) {
        return { nextState: 'chase', resetTimer: true };
      }
      return { nextState: 'alert', resetTimer: false };
    }
    case 'chase': {
      if (input.distToPlayer <= ENEMY_MELEE_RANGE && input.attackCooldown <= 0) {
        return { nextState: 'windup', resetTimer: true };
      }
      return { nextState: 'chase', resetTimer: false };
    }
    case 'windup': {
      if (input.stateTimer >= ENEMY_WINDUP_DURATION) {
        return { nextState: 'attack', resetTimer: true };
      }
      return { nextState: 'windup', resetTimer: false };
    }
    case 'attack': {
      if (input.stateTimer >= ENEMY_ATTACK_DURATION) {
        return { nextState: 'chase', resetTimer: true };
      }
      return { nextState: 'attack', resetTimer: false };
    }
    case 'dead':
      return { nextState: 'dead', resetTimer: false };
  }
}

export function selectAvailableWeapon(
  requested: WeaponId,
  hasWrench: boolean,
  hasPistol: boolean,
): WeaponId {
  if (requested === 'wrench' && hasWrench) return 'wrench';
  if (requested === 'pistol' && hasPistol) return 'pistol';
  if (hasPistol) return 'pistol';
  if (hasWrench) return 'wrench';
  return 'none';
}

export function formatRunTime(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatEtaCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getZoneNameByPosition(x: number, z: number): string {
  if (z >= 44 && x <= 2.15) return 'Transit Train';
  if (z >= 30) return 'Station Platform';
  if (z > 4.4) return 'Stronghold Lobby';
  if (z > -12) return 'Locker Room';
  if (z > -32) return 'Access Corridor';
  if (z > -52) return 'Storage Bay';
  if (z > -80) return 'Containment Lab';
  return 'Extraction Lift';
}

export function getZoneNameByZ(z: number): string {
  return getZoneNameByPosition(0, z);
}

export function serializeSaveData(data: SavedGameData): string {
  return JSON.stringify(data);
}

export function parseSaveData(raw: string | null): SavedGameData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedGameData>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.savedAt === 'string' &&
      typeof parsed.zoneName === 'string' &&
      parsed.position &&
      typeof parsed.position.x === 'number' &&
      typeof parsed.position.y === 'number' &&
      typeof parsed.position.z === 'number'
    ) {
      return parsed as SavedGameData;
    }
    return null;
  } catch {
    return null;
  }
}
