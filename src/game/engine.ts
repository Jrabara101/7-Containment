import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SoundEngine } from './audio';
import { EnemyManager } from './enemies';
import { buildFacilityLevel, LevelBuildResult, DynamicProp } from './level';
import { PhysicsWorld } from './physics';
import { PlayerController } from './player';
import {
  applyPlayerDamage,
  computeExplosionDamage,
  getZoneNameByPosition,
  INTERCOM_SPEECH_RATE,
  parseSaveData,
  PLAYER_DOSSIER,
  PLAYER_MAX_ARMOR,
  PLAYER_MAX_HEALTH,
  SAVE_STORAGE_KEY,
  serializeSaveData,
} from './rules';
import { StoryManager } from './story';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import type { GameOutcome, GamePhase, GameSettings, HudSnapshot, SavedGameData, WeaponId } from './types';
import { WeaponManager } from './weapons';

interface ParticleSlot {
  active: boolean;
  life: number;
  maxLife: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  color: THREE.Color;
}

const PARTICLE_POOL_SIZE = 96;
const _tmpVec = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();
const _cratePos = new THREE.Vector3();
const _storyPlayerPos = new THREE.Vector3();
const _hudPlayerPos = new THREE.Vector3();
const _tmpMat = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();

export class GameEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private keyDirLight: THREE.DirectionalLight;

  private textures: ProceduralTextureSet;
  private sound: SoundEngine;
  private physics!: PhysicsWorld;
  private level!: LevelBuildResult;
  private story!: StoryManager;
  private player!: PlayerController;
  private weapons!: WeaponManager;
  private enemies!: EnemyManager;

  // Pooled particle ring buffer (InstancedMesh)
  private particleMesh: THREE.InstancedMesh;
  private particleGeo: THREE.BoxGeometry;
  private particleMat: THREE.MeshBasicMaterial;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;

  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  // Game State
  public phase: GamePhase = 'title';
  public outcome: GameOutcome = 'none';
  private health = PLAYER_MAX_HEALTH;
  private armor = 0;
  private elapsedSeconds = 0;
  private enemiesKilled = 0;
  private damageTaken = 0;
  private damageFlash = 0;
  private hitstopTimer = 0;
  private pointerLocked = false;
  private bannerText: string | null = null;
  private bannerTimer = 0;
  private flickerTimer = 0;
  private titleTourTime = 0;
  private dragLookActive = false;
  private lastHudPush = 0;
  private noiseAlertTimer = 0;
  private noiseOrigin = new THREE.Vector3();
  private savedTimestamp: string | null = null;

  private settings: GameSettings;
  private onHudUpdate: (snapshot: HudSnapshot) => void;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialSettings: GameSettings,
    onHudUpdate: (snapshot: HudSnapshot) => void,
  ) {
    this.container = container;
    this.settings = { ...initialSettings };
    this.onHudUpdate = onHudUpdate;

    // Detect Software WebGL cleanly via renderer string
    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090c0f);
    this.scene.fog = new THREE.FogExp2(0x090c0f, 0.024);

    // Mandatory studio environment reflection map
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(
      72,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.1,
      140,
    );
    this.scene.add(this.camera);

    // Warm/cool contrast rig (1 directional shadow caster + cool hemisphere fill)
    const hemi = new THREE.HemisphereLight(0x88b4cc, 0x2a241e, 0.72);
    this.scene.add(hemi);

    this.keyDirLight = new THREE.DirectionalLight(0xffe6c7, 0.85);
    this.keyDirLight.position.set(6, 16, 4);
    this.keyDirLight.castShadow = !this.isSoftwareGl;
    this.keyDirLight.shadow.mapSize.set(1024, 1024);
    this.keyDirLight.shadow.camera.near = 1;
    this.keyDirLight.shadow.camera.far = 45;
    this.keyDirLight.shadow.camera.left = -16;
    this.keyDirLight.shadow.camera.right = 16;
    this.keyDirLight.shadow.camera.top = 16;
    this.keyDirLight.shadow.camera.bottom = -16;
    this.keyDirLight.shadow.bias = -0.0005;
    this.scene.add(this.keyDirLight);
    this.scene.add(this.keyDirLight.target);

    // Procedural Textures & Sound
    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.sound = new SoundEngine();
    this.sound.setVolume(this.settings.masterVolume, this.settings.muted);

    // Pooled InstancedMesh particles
    this.particleGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    this.particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(this.particleGeo, this.particleMat, PARTICLE_POOL_SIZE);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 0.4,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scale: 0,
        color: new THREE.Color(0xffaa44),
      });
      _tmpMat.makeScale(0, 0, 0);
      this.particleMesh.setMatrixAt(i, _tmpMat);
      this.particleMesh.setColorAt(i, this.particles[i].color);
    }
    this.scene.add(this.particleMesh);

    // Build initial world
    this.buildWorld();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Bind events
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.pushHud(true);
    this.updateTitleCamera(0);
    this.renderer.render(this.scene, this.camera);
    this.clock.start();
    this.scheduleNextFrame();
  }

  private buildWorld(): void {
    // Dispose old world if restarting
    if (this.enemies) this.enemies.dispose();
    if (this.weapons) {
      this.camera.remove(this.weapons.viewRoot);
      this.weapons.dispose(this.scene);
    }
    if (this.story) this.story.dispose();
    if (this.level) {
      for (const l of this.level.roomLights) this.scene.remove(l);
      this.level.dispose();
    }
    if (this.physics) this.physics.dispose();

    this.physics = new PhysicsWorld();
    this.level = buildFacilityLevel(this.scene, this.physics, this.textures, this.isSoftwareGl);
    this.story = new StoryManager(this.scene, this.physics, this.textures, this.isSoftwareGl);
    this.player = new PlayerController(this.physics, this.camera);
    this.player.input.mouseSensitivity = this.settings.mouseSensitivity;
    this.weapons = new WeaponManager(this.camera, this.scene, this.textures);
    this.enemies = new EnemyManager(this.scene, this.physics, this.textures, this.isSoftwareGl);

    this.health = PLAYER_MAX_HEALTH;
    this.armor = 0;
    this.elapsedSeconds = 0;
    this.enemiesKilled = 0;
    this.damageTaken = 0;
    this.damageFlash = 0;
    this.hitstopTimer = 0;
    this.bannerText = null;
    this.bannerTimer = 0;
    this.noiseAlertTimer = 0;
    this.sound.stopAllLoops();

    const existingSave = parseSaveData(window.localStorage.getItem(SAVE_STORAGE_KEY));
    this.savedTimestamp = existingSave ? existingSave.savedAt : null;

    for (const p of this.particles) p.active = false;
  }

  public startNewGame(): void {
    this.sound.unlock();
    this.buildWorld();
    this.phase = 'playing';
    this.outcome = 'none';
    this.showBanner('TRANSIT CARRIAGE 04 — APPROACHING SECTOR 7 TERMINAL', 4.0);
    document.body.dataset.state = 'playing';
    this.requestPointerLock();
    this.pushHud(true);
  }

  public loadSavedLobby(): boolean {
    const save = parseSaveData(window.localStorage.getItem(SAVE_STORAGE_KEY));
    if (!save) return false;
    this.sound.unlock();
    this.buildWorld();
    this.story.jumpToLobbySavedState();
    this.player.resetSpawn(save.position.x, save.position.y, save.position.z, save.yaw);
    this.health = save.health;
    this.armor = save.armor;
    this.savedTimestamp = save.savedAt;
    this.phase = 'playing';
    this.outcome = 'none';
    this.showBanner('LOADED LOBBY SAVE — PROCEED TO AIRLOCK OR EXPLORE LOBBY', 4.0);
    document.body.dataset.state = 'playing';
    this.requestPointerLock();
    this.pushHud(true);
    return true;
  }

  public skipTransit(): void {
    if (this.phase !== 'playing') return;
    this.story.skipTransit({
      onIntercomCue: (speaker, line, chime) => this.handleIntercomCue(speaker, line, chime),
      onDoorOpenSound: () => this.sound.playDoorHiss(),
      onBanner: (text, dur) => this.showBanner(text, dur),
      isVoiceBusy: () => this.isVoiceBusy(),
    });
    this.pushHud(true);
  }

  public resumeGame(): void {
    if (this.phase !== 'paused') return;
    this.sound.unlock();
    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.requestPointerLock();
    this.pushHud(true);
  }

  public pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.player.input.keys.clear();
    this.sound.stopAllLoops();
    document.body.dataset.state = 'paused';
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.pushHud(true);
  }

  public returnToTitle(): void {
    this.buildWorld();
    this.phase = 'title';
    this.outcome = 'none';
    document.body.dataset.state = 'title';
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.pushHud(true);
  }

  public updateSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.player.input.mouseSensitivity = next.mouseSensitivity;
    this.sound.setVolume(next.masterVolume, next.muted);
  }

  public requestPointerLock(): void {
    try {
      const el = this.renderer.domElement;
      if (document.pointerLockElement !== el && el.requestPointerLock) {
        const res = el.requestPointerLock() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      }
    } catch {
      // Headless browsers may reject PointerLock; drag-look fallback stays active
    }
  }

  private showBanner(text: string, duration = 3.0): void {
    this.bannerText = text;
    this.bannerTimer = duration;
    this.pushHud(true);
  }

  private handleResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.render(this.scene, this.camera);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyM') {
      this.updateSettings({ ...this.settings, muted: !this.settings.muted });
      this.pushHud(true);
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.phase === 'playing') {
        e.preventDefault();
        this.pauseGame();
      } else if (this.phase === 'paused') {
        e.preventDefault();
        this.resumeGame();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    const k = this.player.input.keys;
    if (!k.has(e.code)) {
      if (e.code === 'Space') {
        this.player.input.jumpBufferTimer = 0.14;
      } else if (e.code === 'KeyR') {
        this.weapons.startReload(() => this.sound.playReload());
        this.pushHud(true);
      } else if (e.code === 'Digit1') {
        if (this.weapons.switchWeapon('wrench')) this.pushHud(true);
      } else if (e.code === 'Digit2') {
        if (this.weapons.switchWeapon('pistol')) this.pushHud(true);
      } else if (e.code === 'KeyF') {
        if (this.story.stage === 'train_transit') {
          this.skipTransit();
        }
      } else if (e.code === 'KeyE') {
        if (this.isNearSaveConsole()) {
          this.saveAtConsole();
        } else {
          this.handleInteractProp();
        }
      }
    }
    k.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.player.input.keys.delete(e.code);
  };

  private onWindowBlur = () => {
    this.player.input.keys.clear();
    this.dragLookActive = false;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.phase !== 'playing') return;
    if (e.button !== 0) return;

    // Ignore clicks on UI buttons
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, [role="dialog"]')) return;

    this.sound.unlock();
    if (!this.pointerLocked) {
      this.requestPointerLock();
      this.dragLookActive = true;
    }

    if (this.player.heldProp) {
      if (this.player.throwHeldProp()) {
        this.sound.playWrenchSwing();
        this.pushHud(true);
      }
      return;
    }

    this.triggerPrimaryAttack();
  };

  private onMouseUp = () => {
    this.dragLookActive = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.phase !== 'playing') return;
    if (!this.pointerLocked && !this.dragLookActive) return;

    const sens = 0.0022 * this.settings.mouseSensitivity;
    this.player.input.yaw -= e.movementX * sens;
    this.player.input.pitch = THREE.MathUtils.clamp(
      this.player.input.pitch - e.movementY * sens,
      -Math.PI * 0.45,
      Math.PI * 0.45,
    );
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    this.pushHud(true);
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private handleInteractProp(): void {
    if (this.player.heldProp) {
      this.player.heldProp = null;
      this.pushHud(true);
      return;
    }

    const nearest = this.findLookedAtCrate();
    if (nearest) {
      this.player.heldProp = nearest;
      this.sound.playPickup();
      this.pushHud(true);
    }
  }

  private findLookedAtCrate(): DynamicProp | null {
    this.player.getForwardDirection(_tmpDir);
    let best: DynamicProp | null = null;
    let bestDist = 3.2;

    for (const p of this.level.props) {
      if (p.kind !== 'crate' || p.exploded) continue;
      _cratePos.set(p.body.position.x, p.body.position.y, p.body.position.z);
      _tmpVec.subVectors(_cratePos, this.camera.position);
      const d = _tmpVec.length();
      if (d > bestDist) continue;
      _tmpVec.normalize();
      if (_tmpVec.dot(_tmpDir) > 0.82) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  private triggerPrimaryAttack(): void {
    this.weapons.tryFire({
      onWrenchSwing: () => {
        this.sound.playWrenchSwing();
      },
      onWrenchActiveFrame: (damage) => {
        this.executeMeleeHit(damage);
      },
      onPistolShot: (damage) => {
        this.sound.playGunshot();
        this.player.addRecoil(0.032);
        this.player.addTrauma(0.16);
        this.noiseAlertTimer = 0.25;
        this.noiseOrigin.copy(this.camera.position);
        this.executeHitscanShot(damage);
        this.pushHud(true);
      },
      onEmptyClip: () => {
        this.sound.playDryFire();
      },
      onReloadStart: () => {
        this.sound.playReload();
        this.pushHud(true);
      },
    });
  }

  private executeMeleeHit(damage: number): void {
    this.player.getForwardDirection(_tmpDir);
    this.raycaster.set(this.camera.position, _tmpDir);
    this.raycaster.far = 2.65;

    // 1. Check enemies
    const enemyHits = this.raycaster.intersectObjects(this.enemies.getAllHitboxMeshes(), false);
    if (enemyHits.length > 0) {
      const hit = enemyHits[0];
      const enemyId = hit.object.userData.enemyId as string;
      this.sound.playWrenchHit(false);
      this.spawnBurst(hit.point, 10, 0xaa2218);
      this.hitstopTimer = 0.045;
      this.player.addTrauma(0.22);
      this.enemies.damageEnemy(
        enemyId,
        damage,
        _tmpDir,
        8.5,
        () => {
          this.enemiesKilled += 1;
          this.pushHud(true);
        },
        () => this.sound.playEnemyHit(),
        () => this.sound.playEnemyDeath(),
      );
      return;
    }

    // 2. Check physics props (crates / barrels)
    const propMeshes: THREE.Object3D[] = [];
    for (const p of this.level.props) {
      if (!p.exploded) propMeshes.push(p.mesh);
    }
    const propHits = this.raycaster.intersectObjects(propMeshes, true);
    if (propHits.length > 0) {
      const hit = propHits[0];
      const prop = this.findPropByObject(hit.object);
      if (prop) {
        this.sound.playWrenchHit(prop.kind !== 'crate');
        this.spawnBurst(hit.point, 7, 0xe0b262);
        prop.body.wakeUp();
        prop.body.applyImpulse(
          new CANNON.Vec3(_tmpDir.x * 160, _tmpDir.y * 80 + 40, _tmpDir.z * 160),
        );
        if (prop.kind === 'barrel') {
          prop.hp -= damage;
          if (prop.hp <= 0) this.detonateBarrel(prop);
        }
        return;
      }
    }

    // 3. Check walls
    const wallHits = this.raycaster.intersectObjects(this.level.staticMeshes, false);
    if (wallHits.length > 0) {
      this.sound.playWrenchHit(true);
      this.spawnBurst(wallHits[0].point, 6, 0xffd27a);
    }
  }

  private executeHitscanShot(damage: number): void {
    this.player.getForwardDirection(_tmpDir);
    this.raycaster.set(this.camera.position, _tmpDir);
    this.raycaster.far = 90;

    // Collect raycast candidates: static world + enemies + dynamic props
    const enemyMeshes = this.enemies.getAllHitboxMeshes();
    const propMeshes: THREE.Object3D[] = [];
    for (const p of this.level.props) {
      if (!p.exploded) propMeshes.push(p.mesh);
    }

    const allTargets: THREE.Object3D[] = [
      ...this.level.staticMeshes,
      ...enemyMeshes,
      ...propMeshes,
    ];

    const hits = this.raycaster.intersectObjects(allTargets, true);
    if (hits.length === 0) return;

    const hit = hits[0];
    const obj = hit.object;

    // Hit Enemy
    if (obj.userData.enemyId) {
      const enemyId = obj.userData.enemyId as string;
      this.spawnBurst(hit.point, 12, 0xc82218);
      this.hitstopTimer = 0.035;
      this.enemies.damageEnemy(
        enemyId,
        damage,
        _tmpDir,
        10,
        () => {
          this.enemiesKilled += 1;
          this.pushHud(true);
        },
        () => this.sound.playEnemyHit(),
        () => this.sound.playEnemyDeath(),
      );
      return;
    }

    // Hit Dynamic Prop
    const prop = this.findPropByObject(obj);
    if (prop) {
      this.spawnBurst(hit.point, 8, 0xffcf70);
      prop.body.wakeUp();
      prop.body.applyImpulse(
        new CANNON.Vec3(_tmpDir.x * 110, _tmpDir.y * 55 + 25, _tmpDir.z * 110),
      );
      if (prop.kind === 'barrel') {
        prop.hp -= damage;
        if (prop.hp <= 0) {
          this.detonateBarrel(prop);
        }
      }
      return;
    }

    // Hit Static Wall/Floor -> Bullet hole decal + spark burst
    if (hit.face) {
      const worldNormal = hit.face.normal
        .clone()
        .transformDirection(obj.matrixWorld)
        .normalize();
      this.weapons.placeDecal(hit.point, worldNormal);
    }
    this.spawnBurst(hit.point, 6, 0xffd780);
  }

  private findPropByObject(obj: THREE.Object3D): DynamicProp | null {
    let curr: THREE.Object3D | null = obj;
    while (curr) {
      const match = this.level.props.find((p) => p.mesh === curr);
      if (match) return match;
      curr = curr.parent;
    }
    return null;
  }

  private detonateBarrel(barrel: DynamicProp): void {
    if (barrel.exploded) return;
    barrel.exploded = true;
    barrel.mesh.visible = false;
    this.physics.world.removeBody(barrel.body);

    const origin = new THREE.Vector3(
      barrel.body.position.x,
      barrel.body.position.y,
      barrel.body.position.z,
    );

    this.sound.playExplosion();
    this.spawnBurst(origin, 28, 0xff6b22, 1.9);
    this.player.addTrauma(0.68);
    this.hitstopTimer = 0.055;

    // Damage nearby enemies
    for (const enemy of this.enemies.enemies) {
      if (enemy.state === 'dead') continue;
      const d = enemy.position.distanceTo(origin);
      const dmg = computeExplosionDamage(d);
      if (dmg > 0) {
        _tmpDir.subVectors(enemy.position, origin).setY(0.2).normalize();
        this.enemies.damageEnemy(
          enemy.id,
          dmg,
          _tmpDir,
          16,
          () => {
            this.enemiesKilled += 1;
            this.pushHud(true);
          },
          () => this.sound.playEnemyHit(),
          () => this.sound.playEnemyDeath(),
        );
      }
    }

    // Damage player if too close
    this.player.getPosition(_tmpPos);
    const pDist = _tmpPos.distanceTo(origin);
    const pDmg = computeExplosionDamage(pDist, 6.5, 65);
    if (pDmg > 0) {
      this.applyDamageToPlayer(pDmg);
    }

    // Chain-detonate nearby barrels & knock crates
    for (const other of this.level.props) {
      if (other.exploded || other === barrel) continue;
      const op = new THREE.Vector3(
        other.body.position.x,
        other.body.position.y,
        other.body.position.z,
      );
      const d = op.distanceTo(origin);
      if (d < 6.0) {
        _tmpDir.subVectors(op, origin).normalize();
        other.body.wakeUp();
        other.body.applyImpulse(new CANNON.Vec3(_tmpDir.x * 260, 140, _tmpDir.z * 260));
        if (other.kind === 'barrel' && d < 4.5) {
          this.detonateBarrel(other);
        }
      }
    }
  }

  private applyDamageToPlayer(rawDmg: number): void {
    if (this.phase !== 'playing') return;
    const res = applyPlayerDamage(this.health, this.armor, rawDmg);
    this.health = res.health;
    this.armor = res.armor;
    this.damageTaken += res.healthLoss;
    this.damageFlash = 1.0;
    this.player.addTrauma(0.42);
    this.sound.playPlayerHurt();

    if (res.dead) {
      this.phase = 'gameover';
      this.outcome = 'defeat';
      this.sound.stopAllLoops();
      document.body.dataset.state = 'gameover';
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
    this.pushHud(true);
  }

  private spawnBurst(
    origin: THREE.Vector3,
    count: number,
    hexColor: number,
    speedScale = 1.0,
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;

      slot.active = true;
      slot.life = 0;
      slot.maxLife = 0.25 + Math.random() * 0.35;
      slot.pos.copy(origin);
      slot.vel.set(
        (Math.random() - 0.5) * 8 * speedScale,
        (Math.random() * 5 + 1.5) * speedScale,
        (Math.random() - 0.5) * 8 * speedScale,
      );
      slot.scale = (0.7 + Math.random() * 1.1) * speedScale;
      slot.color.setHex(hexColor);
      this.particleMesh.setColorAt(this.particleCursor === 0 ? PARTICLE_POOL_SIZE - 1 : this.particleCursor - 1, slot.color);
    }
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _tmpMat.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _tmpMat);
        continue;
      }
      p.vel.y -= 16 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const s = p.scale * (1 - p.life / p.maxLife);
      _tmpScale.set(s, s, s);
      _tmpQuat.identity();
      _tmpMat.compose(p.pos, _tmpQuat, _tmpScale);
      this.particleMesh.setMatrixAt(i, _tmpMat);
    }
    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateDoorsAndTriggers(dt: number, playerPos: THREE.Vector3): void {
    // 1. Sliding automatic doors
    for (const door of this.level.doors) {
      const near = Math.abs(playerPos.z - door.centerZ) < 4.5 && Math.abs(playerPos.x) < 3.6;
      const targetOpen = near ? 1 : 0;
      if (near && !door.wasOpen) {
        this.sound.playDoorHiss();
      }
      door.wasOpen = near;
      door.openAmount = THREE.MathUtils.damp(door.openAmount, targetOpen, 7, dt);

      const offset = door.openAmount * (door.halfGap * 1.85);
      const lx = -door.halfGap * 0.5 - offset;
      const rx = door.halfGap * 0.5 + offset;

      door.leftMesh.position.x = lx;
      door.rightMesh.position.x = rx;
      door.leftBody.position.x = lx;
      door.rightBody.position.x = rx;
    }

    // 2. Locker Room flickering fluorescent light
    this.flickerTimer += dt;
    const flick =
      Math.sin(this.flickerTimer * 23) * Math.sin(this.flickerTimer * 7.3) > 0.65
        ? 0.28
        : 1.0;
    this.level.lockerFlickerLight.intensity = 18 * flick;
    this.level.lockerTubeMat.emissiveIntensity = 1.6 * flick;

    // 3. Corridor Scripted Breach Event (Z < -16.5)
    const breach = this.level.breach;
    if (!breach.triggered && playerPos.z < -16.5) {
      breach.triggered = true;
      breach.timer = 0;
      this.sound.playAlarmBurst(6);
      this.sound.playVentClatter();
      this.player.addTrauma(0.55);
      this.showBanner('CONTAINMENT BREACH DETECTED — PROCEED TO EXTRACTION', 4.0);

      // Release ceiling vent cover into dynamic cannon-es physics!
      const vb = breach.ventBody;
      vb.mass = 12;
      vb.type = CANNON.Body.DYNAMIC;
      vb.updateMassProperties();
      vb.wakeUp();
      vb.velocity.set(-0.6, -2.5, 1.4);
      vb.angularVelocity.set(4.5, 1.2, -3.2);
    }

    if (breach.triggered) {
      breach.timer += dt;
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(breach.timer * 8.5));
      for (const l of breach.corridorLights) {
        l.color.setHex(0xff281c);
        l.intensity = 22 * pulse;
      }
      for (const m of breach.corridorStripMats) {
        m.color.setHex(0xff4234);
        m.emissive.setHex(0xff1e10);
        m.emissiveIntensity = 2.0 * pulse;
      }
    }

    // Sync vent cover mesh to its physics body
    const vb = breach.ventBody;
    breach.ventMesh.position.set(vb.position.x, vb.position.y, vb.position.z);
    breach.ventMesh.quaternion.set(vb.quaternion.x, vb.quaternion.y, vb.quaternion.z, vb.quaternion.w);

    // 4. Pickups bobbing & collection
    for (const p of this.level.pickups) {
      if (p.collected) continue;
      p.mesh.rotation.y += dt * 1.4;
      p.mesh.position.y = p.baseY + Math.sin(this.flickerTimer * 2.6) * 0.06;

      const dx = playerPos.x - p.position.x;
      const dz = playerPos.z - p.position.z;
      const dy = Math.abs(playerPos.y - p.baseY);
      if (dx * dx + dz * dz < 1.65 && dy < 1.8) {
        if (p.type === 'health' && this.health >= PLAYER_MAX_HEALTH) continue;
        if (p.type === 'armor' && this.armor >= PLAYER_MAX_ARMOR) continue;

        p.collected = true;
        p.mesh.visible = false;
        this.sound.playPickup();

        if (p.type === 'wrench') {
          this.weapons.giveWrench();
          this.showBanner('PIPE WRENCH ACQUIRED [1] — LEFT CLICK TO SWING', 3.5);
        } else if (p.type === 'pistol') {
          this.weapons.givePistol();
          this.showBanner('9MM SERVICE PISTOL [2] — [R] TO RELOAD', 3.5);
        } else if (p.type === 'ammo') {
          this.weapons.addAmmo(p.amount);
          this.showBanner(`+${p.amount} PISTOL AMMO`, 2.0);
        } else if (p.type === 'health') {
          this.health = Math.min(PLAYER_MAX_HEALTH, this.health + p.amount);
          this.showBanner(`+${p.amount} HEALTH`, 2.0);
        } else if (p.type === 'armor') {
          this.armor = Math.min(PLAYER_MAX_ARMOR, this.armor + p.amount);
          this.showBanner(`+${p.amount} ARMOR`, 2.0);
        }
        this.pushHud(true);
      }
    }

    // 5. Exit Elevator Victory Zone
    const ez = this.level.elevatorZone;
    if (
      playerPos.x >= ez.minX &&
      playerPos.x <= ez.maxX &&
      playerPos.z >= ez.minZ &&
      playerPos.z <= ez.maxZ
    ) {
      this.phase = 'gameover';
      this.outcome = 'victory';
      this.sound.stopAllLoops();
      this.sound.playVictory();
      document.body.dataset.state = 'gameover';
      if (document.pointerLockElement) document.exitPointerLock?.();
      this.pushHud(true);
    }
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => {
        if (!this.disposed) this.tick();
      });
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 16);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateTitleCamera(t: number): void {
    this.camera.position.set(
      Math.sin(t * 0.35) * 0.5,
      1.68 + Math.sin(t * 0.6) * 0.04,
      53.2 + Math.cos(t * 0.25) * 0.4,
    );
    this.camera.lookAt(0, 1.55, 44.2);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, this.isSoftwareGl ? 0.1 : 0.05);

    if (this.phase === 'title') {
      // Atmospheric gentle camera tour inside Locker Room
      this.titleTourTime += dt;
      this.flickerTimer += dt;
      const flick = Math.sin(this.flickerTimer * 19) * Math.sin(this.flickerTimer * 6.1) > 0.72 ? 0.3 : 1.0;
      this.level.lockerFlickerLight.intensity = 18 * flick;
      this.level.lockerTubeMat.emissiveIntensity = 1.6 * flick;
      this.updateTitleCamera(this.titleTourTime);
    } else if (this.phase === 'playing') {
      this.elapsedSeconds += dt;
      if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 2.8);
      if (this.bannerTimer > 0) {
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) this.bannerText = null;
      }
      if (this.noiseAlertTimer > 0) this.noiseAlertTimer -= dt;

      // Simulation hitstop (freezes physics/AI briefly on heavy hits while camera shake continues)
      if (this.hitstopTimer > 0) {
        this.hitstopTimer -= dt;
        this.player.syncCamera(dt);
      } else {
        this.physics.step(dt);
        this.player.update(dt, (sprint) => this.sound.playFootstep(sprint));

        // Sync dynamic props (crates, barrels)
        for (const prop of this.level.props) {
          if (prop.exploded) continue;
          prop.mesh.position.set(prop.body.position.x, prop.body.position.y, prop.body.position.z);
          prop.mesh.quaternion.set(
            prop.body.quaternion.x,
            prop.body.quaternion.y,
            prop.body.quaternion.z,
            prop.body.quaternion.w,
          );
        }

        this.player.getPosition(_tmpPos);
        this.updateDoorsAndTriggers(dt, _tmpPos);
        _storyPlayerPos.copy(_tmpPos);
        this.story.update(dt, _storyPlayerPos, {
          onIntercomCue: (speaker, line, chime) => this.handleIntercomCue(speaker, line, chime),
          onDoorOpenSound: () => this.sound.playDoorHiss(),
          onBanner: (text, dur) => this.showBanner(text, dur),
          isVoiceBusy: () => this.isVoiceBusy(),
        });

        // Track key shadow frustum around player
        this.keyDirLight.position.set(_tmpPos.x + 6, 16, _tmpPos.z + 4);
        this.keyDirLight.target.position.set(_tmpPos.x, 0, _tmpPos.z - 6);

        this.enemies.update(
          dt,
          _tmpPos,
          this.noiseAlertTimer > 0,
          this.noiseOrigin,
          this.level.staticMeshes,
          (dmg) => this.applyDamageToPlayer(dmg),
          () => this.sound.playEnemyGrowl(),
        );
      }

      this.weapons.update(dt, this.player.speedRatio, (dmg) => this.executeMeleeHit(dmg));
      this.updateParticles(dt);

      const now = performance.now();
      if (now - this.lastHudPush >= 100) {
        this.lastHudPush = now;
        this.pushHud(false);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  };

  private handleIntercomCue(speaker: string | null, line: string | null, chime: boolean): void {
    if (chime) this.sound.playPaChime();
    if (line && !this.settings.muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(line);
        utter.rate = INTERCOM_SPEECH_RATE;
        utter.pitch = 0.92;
        utter.volume = Math.min(1, this.settings.masterVolume * 0.75);
        window.speechSynthesis.speak(utter);
      } catch {
        // Ignore if speech synthesis is unavailable
      }
    }
    this.pushHud(true);
  }

  /** True while the intercom voice is still speaking a line. */
  private isVoiceBusy(): boolean {
    if (this.settings.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    try {
      return window.speechSynthesis.speaking || window.speechSynthesis.pending;
    } catch {
      return false;
    }
  }

  private isNearSaveConsole(): boolean {
    this.player.getPosition(_hudPlayerPos);
    const dx = _hudPlayerPos.x - this.story.saveConsolePos.x;
    const dz = _hudPlayerPos.z - this.story.saveConsolePos.z;
    return dx * dx + dz * dz < 11.5 && _hudPlayerPos.z > 4.4;
  }

  private saveAtConsole(): void {
    this.player.getPosition(_hudPlayerPos);
    const nowIso = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const payload: SavedGameData = {
      version: 1,
      savedAt: nowIso,
      zoneName: 'Stronghold Lobby',
      storyStage: 'lobby_entered',
      dossier: PLAYER_DOSSIER,
      health: this.health,
      armor: this.armor,
      position: {
        x: _hudPlayerPos.x,
        y: this.player.body.position.y,
        z: _hudPlayerPos.z,
      },
      yaw: this.player.input.yaw,
    };
    window.localStorage.setItem(SAVE_STORAGE_KEY, serializeSaveData(payload));
    this.savedTimestamp = nowIso;
    this.story.updateSaveConsoleScreen(true);
    this.sound.playSaveConfirm();
    this.showBanner(`GAME SAVED IN LOBBY CONSOLE (${nowIso}) — PROCEED THROUGH AIRLOCK`, 4.5);
    this.pushHud(true);
  }

  private pushHud(force: boolean): void {
    if (!force && this.disposed) return;
    this.player.getPosition(_hudPlayerPos);
    const nearSave = this.phase === 'playing' && this.isNearSaveConsole();
    const lookedCrate = this.phase === 'playing' && !this.player.heldProp ? this.findLookedAtCrate() : null;
    const interactPrompt = nearSave
      ? '[E] Save Game at Security Console'
      : this.player.heldProp
        ? '[E] Drop Crate  ·  [Click] Throw'
        : lookedCrate
          ? '[E] Grab Crate'
          : null;

    this.onHudUpdate({
      phase: this.phase,
      outcome: this.outcome,
      health: this.health,
      armor: this.armor,
      activeWeapon: this.weapons.activeWeapon as WeaponId,
      hasWrench: this.weapons.hasWrench,
      hasPistol: this.weapons.hasPistol,
      magAmmo: this.weapons.magAmmo,
      reserveAmmo: this.weapons.reserveAmmo,
      isReloading: this.weapons.isReloading,
      holdingProp: this.player.heldProp !== null,
      interactPrompt,
      bannerText: this.bannerText,
      enemiesKilled: this.enemiesKilled,
      totalEnemies: this.enemies.enemies.length,
      elapsedSeconds: this.elapsedSeconds,
      damageTaken: this.damageTaken,
      damageFlash: this.damageFlash,
      pointerLocked: this.pointerLocked,
      zoneName: getZoneNameByPosition(_hudPlayerPos.x, _hudPlayerPos.z),
      storyStage: this.story.stage,
      etaSeconds: this.story.etaSeconds,
      intercomSpeaker: this.story.intercomSpeaker,
      intercomLine: this.story.intercomLine,
      showDossierCard: this.story.stage === 'train_transit',
      savedTimestamp: this.savedTimestamp,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.unbindEvents();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (this.enemies) this.enemies.dispose();
    if (this.weapons) this.weapons.dispose(this.scene);
    if (this.story) this.story.dispose();
    if (this.level) this.level.dispose();
    if (this.physics) this.physics.dispose();

    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.textures.dispose();
    this.sound.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
