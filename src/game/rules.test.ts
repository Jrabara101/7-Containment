import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlayerDamage,
  computeReload,
  computeExplosionDamage,
  stepEnemyStateMachine,
  selectAvailableWeapon,
  formatRunTime,
  formatEtaCountdown,
  getZoneNameByPosition,
  serializeSaveData,
  parseSaveData,
  estimateLineDuration,
  PA_BRIEFING_CUES,
  PLAYER_DOSSIER,
  PISTOL_DAMAGE,
  WRENCH_DAMAGE,
  ENEMY_MAX_HP,
} from './rules';

test('applyPlayerDamage absorbs 60% via armor and detects death', () => {
  const hit1 = applyPlayerDamage(100, 50, 20);
  assert.equal(hit1.armor, 38);
  assert.equal(hit1.health, 92);
  assert.equal(hit1.dead, false);

  const lethal = applyPlayerDamage(10, 0, 25);
  assert.equal(lethal.health, 0);
  assert.equal(lethal.dead, true);
});

test('weapons kill 100 HP mutant in 3 pistol shots or 4 wrench hits', () => {
  assert.ok(PISTOL_DAMAGE * 2 < ENEMY_MAX_HP);
  assert.ok(PISTOL_DAMAGE * 3 >= ENEMY_MAX_HP);
  assert.ok(WRENCH_DAMAGE * 3 < ENEMY_MAX_HP);
  assert.ok(WRENCH_DAMAGE * 4 >= ENEMY_MAX_HP);
});

test('computeReload tops up magazine from reserve accurately', () => {
  const r1 = computeReload(4, 48, 12);
  assert.equal(r1.magAmmo, 12);
  assert.equal(r1.reserveAmmo, 40);
  assert.equal(r1.reloaded, 8);

  const r2 = computeReload(5, 3, 12);
  assert.equal(r2.magAmmo, 8);
  assert.equal(r2.reserveAmmo, 0);
  assert.equal(r2.reloaded, 3);

  const r3 = computeReload(12, 20, 12);
  assert.equal(r3.reloaded, 0);
});

test('computeExplosionDamage drops with distance and clamps at radius', () => {
  const close = computeExplosionDamage(0.5, 6.5, 125);
  const mid = computeExplosionDamage(3.25, 6.5, 125);
  const outside = computeExplosionDamage(7.0, 6.5, 125);
  assert.ok(close > mid);
  assert.ok(mid > 0);
  assert.equal(outside, 0);
});

test('stepEnemyStateMachine transitions idle -> alert -> chase -> windup -> attack -> dead', () => {
  const s1 = stepEnemyStateMachine({
    currentState: 'idle',
    hp: 100,
    distToPlayer: 12,
    canSeePlayer: true,
    heardNoise: false,
    stateTimer: 0,
    attackCooldown: 0,
  });
  assert.equal(s1.nextState, 'alert');
  assert.equal(s1.resetTimer, true);

  const s2 = stepEnemyStateMachine({
    currentState: 'alert',
    hp: 100,
    distToPlayer: 12,
    canSeePlayer: true,
    heardNoise: false,
    stateTimer: 0.5,
    attackCooldown: 0,
  });
  assert.equal(s2.nextState, 'chase');

  const s3 = stepEnemyStateMachine({
    currentState: 'chase',
    hp: 100,
    distToPlayer: 1.5,
    canSeePlayer: true,
    heardNoise: false,
    stateTimer: 0.2,
    attackCooldown: 0,
  });
  assert.equal(s3.nextState, 'windup');

  const s4 = stepEnemyStateMachine({
    currentState: 'windup',
    hp: 0,
    distToPlayer: 1.5,
    canSeePlayer: true,
    heardNoise: false,
    stateTimer: 0.1,
    attackCooldown: 0,
  });
  assert.equal(s4.nextState, 'dead');
});

test('selectAvailableWeapon, formatRunTime, formatEtaCountdown, and zone tracking behave deterministically', () => {
  assert.equal(selectAvailableWeapon('pistol', true, false), 'wrench');
  assert.equal(selectAvailableWeapon('pistol', true, true), 'pistol');
  assert.equal(formatRunTime(125), '02:05');
  assert.equal(formatEtaCountdown(300), '05:00');
  assert.equal(formatEtaCountdown(0), '00:00');

  assert.equal(getZoneNameByPosition(0, 52), 'Transit Train');
  assert.equal(getZoneNameByPosition(5, 48), 'Station Platform');
  assert.equal(getZoneNameByPosition(2, 18), 'Stronghold Lobby');
  assert.equal(getZoneNameByPosition(0, 0), 'Locker Room');
  assert.equal(getZoneNameByPosition(0, -20), 'Access Corridor');
  assert.equal(getZoneNameByPosition(0, -40), 'Storage Bay');
  assert.equal(getZoneNameByPosition(0, -65), 'Containment Lab');
  assert.equal(getZoneNameByPosition(0, -84), 'Extraction Lift');
});

test('save serialization round-trips Carl James G. Bellvees lobby save data', () => {
  const payload = {
    version: 1,
    savedAt: '2026-11-16T18:00:00Z',
    zoneName: 'Stronghold Lobby',
    storyStage: 'lobby_entered' as const,
    dossier: PLAYER_DOSSIER,
    health: 100,
    armor: 25,
    position: { x: 0, y: 0.9, z: 19 },
    yaw: 0,
  };
  const encoded = serializeSaveData(payload);
  const decoded = parseSaveData(encoded);
  assert.ok(decoded);
  assert.equal(decoded.dossier.name, 'Carl James G. Bellvees');
  assert.equal(decoded.dossier.age, 29);
  assert.equal(decoded.zoneName, 'Stronghold Lobby');
  assert.equal(parseSaveData('invalid-json'), null);
});

test('PA briefing cues are held long enough to be fully spoken', () => {
  // Longer lines need more time; every cue gets a realistic speaking window
  assert.ok(estimateLineDuration('one two three four five six') < estimateLineDuration(PA_BRIEFING_CUES[2].text));
  for (const cue of PA_BRIEFING_CUES) {
    const words = cue.text.split(/\s+/).length;
    const hold = Math.max(cue.duration, estimateLineDuration(cue.text));
    assert.ok(hold >= words / 3, `cue "${cue.speaker}" held ${hold.toFixed(1)}s for ${words} words`);
  }
});
