import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, COL_ENEMY, COL_PROP, COL_WORLD } from './physics';
import {
  ENEMY_MAX_HP,
  ENEMY_MELEE_RANGE,
  stepEnemyStateMachine,
} from './rules';
import type { EnemyAIState } from './types';
import type { ProceduralTextureSet } from './textures';

export interface EnemyInstance {
  id: string;
  group: THREE.Group;
  hitboxes: THREE.Mesh[];
  torso: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  eyeMeshes: THREE.Mesh[];
  shadowDisc: THREE.Mesh;
  bodyMaterials: THREE.MeshStandardMaterial[];
  eyeMaterial: THREE.MeshStandardMaterial;
  hp: number;
  state: EnemyAIState;
  stateTimer: number;
  attackCooldown: number;
  attackHitDelivered: boolean;
  hitFlashTimer: number;
  position: THREE.Vector3;
  yaw: number;
  patrolAnchor: THREE.Vector3;
  patrolPhase: number;
  ragdollBody: CANNON.Body | null;
  ragdollTimer: number;
}

const _toPlayer = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _steerDir = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _rightVec = new THREE.Vector3();

export class EnemyManager {
  public enemies: EnemyInstance[] = [];
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private geometries: THREE.BufferGeometry[] = [];
  private sharedMaterials: THREE.Material[] = [];
  private raycaster = new THREE.Raycaster();
  private isSoftwareGl: boolean;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    textures: ProceduralTextureSet,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.physics = physics;
    this.isSoftwareGl = isSoftwareGl;
    this.spawnInitialRoster(textures);
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private createMutantMesh(textures: ProceduralTextureSet): {
    group: THREE.Group;
    hitboxes: THREE.Mesh[];
    torso: THREE.Mesh;
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
    eyeMeshes: THREE.Mesh[];
    shadowDisc: THREE.Mesh;
    bodyMaterials: THREE.MeshStandardMaterial[];
    eyeMaterial: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();

    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x5c6855,
      roughness: 0.78,
      metalness: 0.08,
    });
    const carapaceMat = new THREE.MeshStandardMaterial({
      color: 0x353c34,
      roughness: 0.45,
      metalness: 0.35,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x9b9484,
      roughness: 0.62,
      metalness: 0.1,
    });
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      emissive: 0xff2a00,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    // Legs (pivoted near hip Y=0.82)
    const legGeo = this.trackGeo(new THREE.BoxGeometry(0.24, 0.82, 0.26));
    const leftLeg = new THREE.Mesh(legGeo, fleshMat);
    leftLeg.position.set(-0.22, 0.41, 0);
    leftLeg.castShadow = !this.isSoftwareGl;

    const rightLeg = new THREE.Mesh(legGeo, fleshMat);
    rightLeg.position.set(0.22, 0.41, 0);
    rightLeg.castShadow = !this.isSoftwareGl;

    // Hunched Torso
    const torso = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.66, 0.76, 0.44)), fleshMat);
    torso.position.set(0, 1.12, -0.06);
    torso.rotation.x = 0.26;
    torso.castShadow = !this.isSoftwareGl;
    torso.receiveShadow = true;

    // Spine / Shoulder Carapace Ridge (secondary silhouette)
    const hump = new THREE.Mesh(this.trackGeo(new THREE.DodecahedronGeometry(0.32, 0)), carapaceMat);
    hump.position.set(0, 1.44, -0.18);
    hump.scale.set(1.15, 0.85, 1.1);
    hump.castShadow = !this.isSoftwareGl;

    // Forward-craning Head + Jaw + Glowing Optic Eyes (accent details)
    const head = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.38, 0.34, 0.4)), fleshMat);
    head.position.set(0, 1.56, 0.22);
    head.rotation.x = 0.14;
    head.castShadow = !this.isSoftwareGl;

    const jaw = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.32, 0.12, 0.28)), boneMat);
    jaw.position.set(0, 1.38, 0.26);

    const eyeGeo = this.trackGeo(new THREE.SphereGeometry(0.055, 8, 8));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMaterial);
    eyeL.position.set(-0.1, 1.59, 0.41);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMaterial);
    eyeR.position.set(0.1, 1.59, 0.41);

    // Articulated Clawed Arms
    const buildArm = (side: -1 | 1): THREE.Group => {
      const armPivot = new THREE.Group();
      armPivot.position.set(side * 0.44, 1.36, 0.05);
      const upper = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.18, 0.62, 0.18)), fleshMat);
      upper.position.set(0, -0.26, 0.08);
      upper.rotation.x = -0.32;
      const forearm = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.16, 0.52, 0.18)), carapaceMat);
      forearm.position.set(0, -0.68, 0.22);
      forearm.rotation.x = -0.45;
      const claw = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.08, 0.24, 5)), boneMat);
      claw.position.set(0, -0.94, 0.36);
      claw.rotation.x = Math.PI * 0.85;
      armPivot.add(upper, forearm, claw);
      return armPivot;
    };
    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.sharedMaterials.push(shadowMat);
    const shadowDisc = new THREE.Mesh(this.trackGeo(new THREE.CircleGeometry(0.65, 16)), shadowMat);
    shadowDisc.rotation.x = -Math.PI * 0.5;
    shadowDisc.position.y = 0.015;

    group.add(leftLeg, rightLeg, torso, hump, head, jaw, eyeL, eyeR, leftArm, rightArm, shadowDisc);

    // Collect hitboxes and tag them for fast raycasting
    const hitboxes: THREE.Mesh[] = [torso, head, hump, leftLeg, rightLeg];
    return {
      group,
      hitboxes,
      torso,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      eyeMeshes: [eyeL, eyeR],
      shadowDisc,
      bodyMaterials: [fleshMat, carapaceMat, boneMat],
      eyeMaterial,
    };
  }

  private spawnInitialRoster(textures: ProceduralTextureSet): void {
    // 2 enemies in Storage Room + 3 enemies in Containment Lab = 5 total
    const spawns: Array<{ id: string; x: number; y: number; z: number; yaw: number }> = [
      { id: 'mutant-storage-1', x: -3.2, y: 0, z: -43.5, yaw: 0.2 },
      { id: 'mutant-storage-2', x: 3.8, y: 0, z: -48.0, yaw: -0.35 },
      { id: 'mutant-lab-1', x: 1.5, y: 0, z: -61.5, yaw: 0.1 },
      { id: 'mutant-lab-2', x: -4.8, y: 0, z: -70.0, yaw: 0.4 },
      { id: 'mutant-lab-3', x: 4.5, y: 0, z: -75.5, yaw: -0.4 },
    ];

    spawns.forEach((sp, idx) => {
      const built = this.createMutantMesh(textures);
      built.group.position.set(sp.x, sp.y, sp.z);
      built.group.rotation.y = sp.yaw;

      const instance: EnemyInstance = {
        id: sp.id,
        ...built,
        hp: ENEMY_MAX_HP,
        state: 'idle',
        stateTimer: 0,
        attackCooldown: 0,
        attackHitDelivered: false,
        hitFlashTimer: 0,
        position: new THREE.Vector3(sp.x, sp.y, sp.z),
        yaw: sp.yaw,
        patrolAnchor: new THREE.Vector3(sp.x, sp.y, sp.z),
        patrolPhase: idx * 1.7,
        ragdollBody: null,
        ragdollTimer: 0,
      };

      for (const hb of built.hitboxes) {
        hb.userData.enemyId = sp.id;
      }

      this.scene.add(built.group);
      this.enemies.push(instance);
    });
  }

  public getAllHitboxMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const e of this.enemies) {
      if (e.state !== 'dead') {
        meshes.push(...e.hitboxes);
      }
    }
    return meshes;
  }

  public damageEnemy(
    enemyId: string,
    damage: number,
    impulseDir: THREE.Vector3,
    impulseStrength: number,
    onKill: () => void,
    onHitAudio: () => void,
    onDeathAudio: () => void,
  ): boolean {
    const enemy = this.enemies.find((e) => e.id === enemyId);
    if (!enemy || enemy.state === 'dead') return false;

    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.08;
    for (const m of enemy.bodyMaterials) {
      m.emissive.setHex(0xdd2211);
      m.emissiveIntensity = 1.6;
    }

    // Wake up idle mutants on damage
    if (enemy.state === 'idle') {
      enemy.state = 'chase';
      enemy.stateTimer = 0;
    }

    // Knockback nudge while alive
    if (enemy.hp > 0) {
      enemy.position.x += impulseDir.x * (impulseStrength * 0.035);
      enemy.position.z += impulseDir.z * (impulseStrength * 0.035);
      onHitAudio();
      return false;
    }

    // Death -> switch to cannon-es ragdoll collapse!
    enemy.state = 'dead';
    enemy.stateTimer = 0;
    enemy.eyeMaterial.emissiveIntensity = 0.1;
    enemy.eyeMaterial.color.setHex(0x3a1410);
    enemy.shadowDisc.visible = false;

    const ragdoll = new CANNON.Body({
      mass: 65,
      material: this.physics.propMat,
      linearDamping: 0.3,
      angularDamping: 0.45,
      collisionFilterGroup: COL_ENEMY,
      collisionFilterMask: COL_WORLD | COL_PROP,
    });
    ragdoll.addShape(new CANNON.Box(new CANNON.Vec3(0.36, 0.72, 0.28)));
    ragdoll.position.set(enemy.position.x, enemy.position.y + 0.9, enemy.position.z);
    ragdoll.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), enemy.yaw);

    // Apply dramatic backward tumble impulse
    ragdoll.velocity.set(
      impulseDir.x * impulseStrength * 0.45,
      2.6,
      impulseDir.z * impulseStrength * 0.45,
    );
    ragdoll.angularVelocity.set(
      (Math.random() - 0.5) * 4 + impulseDir.z * 3.5,
      (Math.random() - 0.5) * 2.5,
      -impulseDir.x * 3.5,
    );

    this.physics.world.addBody(ragdoll);
    enemy.ragdollBody = ragdoll;
    onDeathAudio();
    onKill();
    return true;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    heardNoise: boolean,
    noiseOrigin: THREE.Vector3 | null,
    levelColliders: THREE.Object3D[],
    onMeleeHitPlayer: (dmg: number) => void,
    onEnemyGrowl: () => void,
  ): void {
    for (const enemy of this.enemies) {
      // Hit flash decay
      if (enemy.hitFlashTimer > 0) {
        enemy.hitFlashTimer -= dt;
        if (enemy.hitFlashTimer <= 0) {
          for (const m of enemy.bodyMaterials) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0;
          }
        }
      }

      if (enemy.state === 'dead') {
        if (enemy.ragdollBody) {
          enemy.ragdollTimer += dt;
          // Sync group visually to physics torso body (offset -0.9 local Y so skeleton pivots around torso center)
          enemy.group.position.set(
            enemy.ragdollBody.position.x,
            enemy.ragdollBody.position.y - 0.72,
            enemy.ragdollBody.position.z,
          );
          enemy.group.quaternion.set(
            enemy.ragdollBody.quaternion.x,
            enemy.ragdollBody.quaternion.y,
            enemy.ragdollBody.quaternion.z,
            enemy.ragdollBody.quaternion.w,
          );
        }
        continue;
      }

      enemy.stateTimer += dt;
      if (enemy.attackCooldown > 0) enemy.attackCooldown -= dt;

      _toPlayer.subVectors(playerPos, enemy.position);
      const flatDist = Math.hypot(_toPlayer.x, _toPlayer.z);
      const yDiff = Math.abs(playerPos.y - enemy.position.y);

      // Line of sight raycast against static level geometry
      let canSee = false;
      if (flatDist < 26 && yDiff < 4.5) {
        _rayOrigin.set(enemy.position.x, enemy.position.y + 1.45, enemy.position.z);
        _rayDir.set(
          playerPos.x - _rayOrigin.x,
          playerPos.y + 1.1 - _rayOrigin.y,
          playerPos.z - _rayOrigin.z,
        );
        const rayLen = _rayDir.length();
        if (rayLen > 0.05) {
          _rayDir.divideScalar(rayLen);
          this.raycaster.set(_rayOrigin, _rayDir);
          this.raycaster.far = rayLen - 0.35;
          const hits = this.raycaster.intersectObjects(levelColliders, false);
          canSee = hits.length === 0;
        }
      }

      let heard = false;
      if (heardNoise && noiseOrigin) {
        heard = enemy.position.distanceTo(noiseOrigin) < 18;
      }

      const prevState = enemy.state;
      const transition = stepEnemyStateMachine({
        currentState: enemy.state,
        hp: enemy.hp,
        distToPlayer: flatDist,
        canSeePlayer: canSee,
        heardNoise: heard,
        stateTimer: enemy.stateTimer,
        attackCooldown: enemy.attackCooldown,
      });

      if (transition.resetTimer) enemy.stateTimer = 0;
      enemy.state = transition.nextState;

      if (prevState === 'idle' && enemy.state === 'alert') {
        onEnemyGrowl();
      }

      if (enemy.state === 'windup' && prevState !== 'windup') {
        enemy.attackHitDelivered = false;
      }

      // Target yaw towards player when active
      const targetYaw = Math.atan2(_toPlayer.x, _toPlayer.z);

      if (enemy.state === 'idle') {
        enemy.patrolPhase += dt * 1.4;
        const bob = Math.sin(enemy.patrolPhase) * 0.03;
        enemy.torso.position.y = 1.12 + bob;
        enemy.leftArm.rotation.x = Math.sin(enemy.patrolPhase) * 0.1;
        enemy.rightArm.rotation.x = -Math.sin(enemy.patrolPhase) * 0.1;
      } else if (enemy.state === 'alert') {
        enemy.yaw = lerpAngle(enemy.yaw, targetYaw, 1 - Math.exp(-10 * dt));
        enemy.leftArm.rotation.x = -0.8;
        enemy.rightArm.rotation.x = -0.8;
        enemy.eyeMaterial.emissiveIntensity = 3.2;
      } else if (enemy.state === 'chase') {
        enemy.eyeMaterial.emissiveIntensity = 2.2;
        enemy.yaw = lerpAngle(enemy.yaw, targetYaw, 1 - Math.exp(-8 * dt));

        // Obstacle-avoiding steering: test forward, +38deg, -38deg feelers
        _steerDir.set(_toPlayer.x, 0, _toPlayer.z).normalize();
        const moveDir = this.computeSteeredDirection(enemy.position, _steerDir, levelColliders);
        const speed = 3.9;
        enemy.position.x += moveDir.x * speed * dt;
        enemy.position.z += moveDir.z * speed * dt;

        // Gait walk animation
        const gait = enemy.stateTimer * 10;
        enemy.leftLeg.rotation.x = Math.sin(gait) * 0.55;
        enemy.rightLeg.rotation.x = -Math.sin(gait) * 0.55;
        enemy.leftArm.rotation.x = -0.5 + Math.cos(gait) * 0.35;
        enemy.rightArm.rotation.x = -0.5 - Math.cos(gait) * 0.35;
      } else if (enemy.state === 'windup') {
        enemy.yaw = lerpAngle(enemy.yaw, targetYaw, 1 - Math.exp(-12 * dt));
        enemy.eyeMaterial.emissiveIntensity = 4.0;
        const p = Math.min(1, enemy.stateTimer / 0.38);
        enemy.leftArm.rotation.x = -1.6 * p;
        enemy.rightArm.rotation.x = -1.6 * p;
        enemy.leftLeg.rotation.x = 0;
        enemy.rightLeg.rotation.x = 0;
      } else if (enemy.state === 'attack') {
        const p = Math.min(1, enemy.stateTimer / 0.34);
        enemy.leftArm.rotation.x = -1.6 + p * 2.1;
        enemy.rightArm.rotation.x = -1.6 + p * 2.1;
        if (!enemy.attackHitDelivered && p >= 0.35) {
          enemy.attackHitDelivered = true;
          enemy.attackCooldown = 0.9;
          if (flatDist <= ENEMY_MELEE_RANGE + 0.45 && yDiff < 2.1) {
            onMeleeHitPlayer(16);
          }
        }
      }

      enemy.group.position.copy(enemy.position);
      enemy.group.rotation.y = enemy.yaw;
    }
  }

  private computeSteeredDirection(
    origin: THREE.Vector3,
    desiredDir: THREE.Vector3,
    colliders: THREE.Object3D[],
  ): THREE.Vector3 {
    _rayOrigin.set(origin.x, origin.y + 0.9, origin.z);
    const angles = [0, 0.65, -0.65, 1.2, -1.2];
    for (const a of angles) {
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      _probeDir.set(
        desiredDir.x * cos - desiredDir.z * sin,
        0,
        desiredDir.x * sin + desiredDir.z * cos,
      );
      this.raycaster.set(_rayOrigin, _probeDir);
      this.raycaster.far = 1.45;
      if (this.raycaster.intersectObjects(colliders, false).length === 0) {
        return _rightVec.copy(_probeDir);
      }
    }
    return _rightVec.copy(desiredDir).multiplyScalar(0.3);
  }

  public dispose(): void {
    for (const e of this.enemies) {
      for (const m of e.bodyMaterials) m.dispose();
      e.eyeMaterial.dispose();
      this.scene.remove(e.group);
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.sharedMaterials) m.dispose();
    this.enemies = [];
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
