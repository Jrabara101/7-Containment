import * as THREE from 'three';
import type { WeaponId } from './types';
import {
  PISTOL_DAMAGE,
  PISTOL_MAG_SIZE,
  PISTOL_START_RESERVE,
  WRENCH_DAMAGE,
  computeReload,
} from './rules';
import type { ProceduralTextureSet } from './textures';

const MAX_DECALS = 40;

export class WeaponManager {
  public viewRoot: THREE.Group;
  private wrenchGroup: THREE.Group;
  private pistolGroup: THREE.Group;
  private muzzleFlash: THREE.Mesh;
  private muzzleLight: THREE.PointLight;

  public activeWeapon: WeaponId = 'none';
  public hasWrench = false;
  public hasPistol = false;
  public magAmmo = PISTOL_MAG_SIZE;
  public reserveAmmo = PISTOL_START_RESERVE;
  public isReloading = false;

  private reloadTimer = 0;
  private attackCooldown = 0;
  private swingTimer = 0;
  private swingHitChecked = false;
  private recoilKick = 0;
  private muzzleTimer = 0;
  private bobPhase = 0;

  private decalPool: THREE.Mesh[] = [];
  private decalIndex = 0;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor(camera: THREE.Camera, scene: THREE.Scene, textures: ProceduralTextureSet) {
    this.viewRoot = new THREE.Group();
    camera.add(this.viewRoot);

    this.wrenchGroup = this.buildWrenchViewmodel();
    this.pistolGroup = this.buildPistolViewmodel();
    this.wrenchGroup.visible = false;
    this.pistolGroup.visible = false;
    this.viewRoot.add(this.wrenchGroup, this.pistolGroup);

    // Muzzle flash star mesh + light attached to pistol barrel tip
    const flashGeo = new THREE.OctahedronGeometry(0.085, 0);
    this.geometries.push(flashGeo);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd17a,
      transparent: true,
      opacity: 0.92,
    });
    this.materials.push(flashMat);
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0, 0.05, -0.36);
    this.muzzleFlash.visible = false;
    this.pistolGroup.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0xffb85c, 0, 7, 2);
    this.muzzleLight.position.set(0, 0.05, -0.4);
    this.pistolGroup.add(this.muzzleLight);

    // Pre-allocate bullet-hole decal pool with polygonOffset to avoid Z-fighting
    const decalGeo = new THREE.PlaneGeometry(0.18, 0.18);
    this.geometries.push(decalGeo);
    const decalMat = new THREE.MeshBasicMaterial({
      map: textures.bulletDecal,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(decalMat);

    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      scene.add(m);
      this.decalPool.push(m);
    }
  }

  private buildWrenchViewmodel(): THREE.Group {
    const g = new THREE.Group();
    g.position.set(0.32, -0.28, -0.52);

    const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.28, metalness: 0.88 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0xb73225, roughness: 0.65, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.45, metalness: 0.78 });
    this.materials.push(steelMat, gripMat, darkMat);

    const handleGeo = new THREE.BoxGeometry(0.055, 0.38, 0.045);
    const gripGeo = new THREE.BoxGeometry(0.068, 0.22, 0.058);
    const headGeo = new THREE.BoxGeometry(0.14, 0.09, 0.07);
    const jawGeo = new THREE.BoxGeometry(0.06, 0.08, 0.065);
    const nutGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8);
    this.geometries.push(handleGeo, gripGeo, headGeo, jawGeo, nutGeo);

    const handle = new THREE.Mesh(handleGeo, steelMat);
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.y = -0.1;
    const head = new THREE.Mesh(headGeo, steelMat);
    head.position.set(-0.02, 0.2, 0);
    const upperJaw = new THREE.Mesh(jawGeo, darkMat);
    upperJaw.position.set(-0.06, 0.27, 0);
    const wormNut = new THREE.Mesh(nutGeo, darkMat);
    wormNut.rotation.z = Math.PI * 0.5;
    wormNut.position.set(-0.02, 0.16, 0);

    g.add(handle, grip, head, upperJaw, wormNut);
    g.rotation.set(-0.35, -0.25, 0.18);
    return g;
  }

  private buildPistolViewmodel(): THREE.Group {
    const g = new THREE.Group();
    g.position.set(0.28, -0.24, -0.46);

    const slideMat = new THREE.MeshStandardMaterial({ color: 0x333a42, roughness: 0.26, metalness: 0.88 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e2328, roughness: 0.58, metalness: 0.4 });
    const sightMat = new THREE.MeshStandardMaterial({
      color: 0x4ef29e,
      emissive: 0x1fc972,
      emissiveIntensity: 1.4,
    });
    this.materials.push(slideMat, frameMat, sightMat);

    const slideGeo = new THREE.BoxGeometry(0.065, 0.07, 0.36);
    const frameGeo = new THREE.BoxGeometry(0.058, 0.045, 0.3);
    const gripGeo = new THREE.BoxGeometry(0.06, 0.18, 0.085);
    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10);
    const sightGeo = new THREE.BoxGeometry(0.014, 0.016, 0.018);
    this.geometries.push(slideGeo, frameGeo, gripGeo, barrelGeo, sightGeo);

    const slide = new THREE.Mesh(slideGeo, slideMat);
    slide.position.set(0, 0.045, -0.04);

    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 0, -0.02);

    const grip = new THREE.Mesh(gripGeo, frameMat);
    grip.position.set(0, -0.09, 0.08);
    grip.rotation.x = 0.24;

    const barrel = new THREE.Mesh(barrelGeo, slideMat);
    barrel.rotation.x = Math.PI * 0.5;
    barrel.position.set(0, 0.045, -0.23);

    const frontSight = new THREE.Mesh(sightGeo, sightMat);
    frontSight.position.set(0, 0.088, -0.19);

    g.add(slide, frame, grip, barrel, frontSight);
    return g;
  }

  public giveWrench(): void {
    this.hasWrench = true;
    if (this.activeWeapon === 'none') {
      this.switchWeapon('wrench');
    }
  }

  public givePistol(): void {
    this.hasPistol = true;
    this.switchWeapon('pistol');
  }

  public addAmmo(amount: number): void {
    this.reserveAmmo = Math.min(120, this.reserveAmmo + amount);
  }

  public switchWeapon(target: WeaponId): boolean {
    if (target === 'wrench' && !this.hasWrench) return false;
    if (target === 'pistol' && !this.hasPistol) return false;
    if (target === this.activeWeapon) return false;

    this.isReloading = false;
    this.reloadTimer = 0;
    this.swingTimer = 0;
    this.activeWeapon = target;
    this.wrenchGroup.visible = target === 'wrench';
    this.pistolGroup.visible = target === 'pistol';
    return true;
  }

  public startReload(onStartSound: () => void): boolean {
    if (this.activeWeapon !== 'pistol' || this.isReloading) return false;
    if (this.magAmmo >= PISTOL_MAG_SIZE || this.reserveAmmo <= 0) return false;
    this.isReloading = true;
    this.reloadTimer = 0.85;
    onStartSound();
    return true;
  }

  public tryFire(
    callbacks: {
      onWrenchSwing: () => void;
      onWrenchActiveFrame: (damage: number) => void;
      onPistolShot: (damage: number) => void;
      onEmptyClip: () => void;
      onReloadStart: () => void;
    },
  ): void {
    if (this.activeWeapon === 'none' || this.attackCooldown > 0 || this.isReloading) return;

    if (this.activeWeapon === 'wrench') {
      this.attackCooldown = 0.42;
      this.swingTimer = 0.32;
      this.swingHitChecked = false;
      callbacks.onWrenchSwing();
      return;
    }

    if (this.activeWeapon === 'pistol') {
      if (this.magAmmo <= 0) {
        this.attackCooldown = 0.2;
        callbacks.onEmptyClip();
        this.startReload(callbacks.onReloadStart);
        return;
      }
      this.magAmmo -= 1;
      this.attackCooldown = 0.22;
      this.recoilKick = 1.0;
      this.muzzleTimer = 0.055;
      this.muzzleFlash.visible = true;
      this.muzzleFlash.rotation.z = Math.random() * Math.PI;
      this.muzzleLight.intensity = 9;
      callbacks.onPistolShot(PISTOL_DAMAGE);
    }
  }

  public placeDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    const decal = this.decalPool[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % MAX_DECALS;

    decal.position.copy(point).addScaledVector(normal, 0.014);
    const lookTarget = point.clone().add(normal);
    decal.lookAt(lookTarget);
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.visible = true;
  }

  public resetDecals(): void {
    for (const d of this.decalPool) d.visible = false;
  }

  public update(
    dt: number,
    moveSpeedRatio: number,
    onWrenchHitFrame: (damage: number) => void,
  ): void {
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) {
        this.muzzleFlash.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        const res = computeReload(this.magAmmo, this.reserveAmmo, PISTOL_MAG_SIZE);
        this.magAmmo = res.magAmmo;
        this.reserveAmmo = res.reserveAmmo;
      }
    }

    // Walk bob
    if (moveSpeedRatio > 0.08) {
      this.bobPhase += dt * (7.5 + moveSpeedRatio * 4);
    }
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.012 * moveSpeedRatio;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * -0.014 * moveSpeedRatio;

    // Wrench swing animation + active hit check at swing apex
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      const t = 1 - this.swingTimer / 0.32;
      if (!this.swingHitChecked && t >= 0.38) {
        this.swingHitChecked = true;
        onWrenchHitFrame(WRENCH_DAMAGE);
      }
      const arc = Math.sin(t * Math.PI);
      this.wrenchGroup.position.set(0.32 - arc * 0.24 + bobX, -0.28 + arc * 0.06 + bobY, -0.52 - arc * 0.16);
      this.wrenchGroup.rotation.set(-0.35 - arc * 1.15, -0.25 + arc * 0.6, 0.18 + arc * 0.4);
    } else {
      this.wrenchGroup.position.set(0.34 + bobX, -0.3 + bobY, -0.54);
      this.wrenchGroup.rotation.set(-0.52, -0.32, 0.22);
    }

    // Pistol recoil & reload dip
    this.recoilKick = THREE.MathUtils.damp(this.recoilKick, 0, 18, dt);
    const reloadDip = this.isReloading ? Math.sin((1 - this.reloadTimer / 0.85) * Math.PI) * 0.22 : 0;
    const reloadTilt = this.isReloading ? Math.sin((1 - this.reloadTimer / 0.85) * Math.PI) * 0.65 : 0;

    this.pistolGroup.position.set(
      0.28 + bobX,
      -0.24 + bobY - reloadDip + this.recoilKick * 0.025,
      -0.46 + this.recoilKick * 0.07,
    );
    this.pistolGroup.rotation.set(this.recoilKick * 0.24 - reloadTilt, 0, reloadTilt * 0.4);
  }

  public dispose(scene: THREE.Scene): void {
    for (const d of this.decalPool) scene.remove(d);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
