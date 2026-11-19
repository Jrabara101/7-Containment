import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, COL_DOOR, COL_PLAYER, COL_PROP, COL_WORLD } from './physics';
import type { DynamicProp } from './level';

export interface PlayerInputState {
  keys: Set<string>;
  jumpBufferTimer: number;
  yaw: number;
  pitch: number;
  mouseSensitivity: number;
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wishDir = new THREE.Vector3();
const _holdTarget = new THREE.Vector3();
const _rayFrom = new CANNON.Vec3();
const _rayTo = new CANNON.Vec3();
const _rayResult = new CANNON.RaycastResult();

export class PlayerController {
  public body: CANNON.Body;
  public camera: THREE.PerspectiveCamera;
  public input: PlayerInputState;

  public grounded = false;
  public coyoteTimer = 0;
  public isCrouching = false;
  public isSprinting = false;
  public speedRatio = 0;
  public trauma = 0;
  public heldProp: DynamicProp | null = null;

  private eyeOffset = 0.72;
  private stepDist = 0;
  private prevPos = new THREE.Vector3();
  private physics: PhysicsWorld;
  private pitchKick = 0;

  constructor(physics: PhysicsWorld, camera: THREE.PerspectiveCamera) {
    this.physics = physics;
    this.camera = camera;
    this.input = {
      keys: new Set<string>(),
      jumpBufferTimer: 0,
      yaw: 0,
      pitch: 0,
      mouseSensitivity: 1.0,
    };

    this.body = new CANNON.Body({
      mass: 75,
      material: physics.playerMat,
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0.0,
      collisionFilterGroup: COL_PLAYER,
      collisionFilterMask: COL_WORLD | COL_PROP | COL_DOOR,
    });
    // Two stacked spheres form a clean frictionless capsule-like hull
    this.body.addShape(new CANNON.Sphere(0.38), new CANNON.Vec3(0, -0.46, 0));
    this.body.addShape(new CANNON.Sphere(0.38), new CANNON.Vec3(0, 0.42, 0));
    this.resetSpawn();
    physics.world.addBody(this.body);
  }

  public resetSpawn(x = 0, y = 0.9, z = 50.2, yaw = 0): void {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.input.yaw = yaw;
    this.input.pitch = 0;
    this.trauma = 0;
    this.pitchKick = 0;
    this.heldProp = null;
    this.eyeOffset = 0.72;
    this.prevPos.set(x, y, z);
    this.syncCamera(0);
  }

  public addRecoil(amount: number): void {
    this.pitchKick = Math.min(0.14, this.pitchKick + amount);
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  public getPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.body.position.x, this.body.position.y - 0.84, this.body.position.z);
  }

  public getForwardDirection(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, -1).applyEuler(this.camera.rotation);
    return out.normalize();
  }

  public update(
    dt: number,
    onFootstep: (sprint: boolean) => void,
  ): void {
    // Ground probe
    _rayFrom.set(this.body.position.x, this.body.position.y - 0.4, this.body.position.z);
    _rayTo.set(this.body.position.x, this.body.position.y - 0.96, this.body.position.z);
    _rayResult.reset();
    this.physics.world.raycastClosest(
      _rayFrom,
      _rayTo,
      { collisionFilterMask: COL_WORLD | COL_PROP | COL_DOOR, skipBackfaces: true },
      _rayResult,
    );
    this.grounded = _rayResult.hasHit && this.body.velocity.y <= 3.5;

    if (this.grounded) {
      this.coyoteTimer = 0.1;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    if (this.input.jumpBufferTimer > 0) {
      this.input.jumpBufferTimer = Math.max(0, this.input.jumpBufferTimer - dt);
    }

    // Crouch / Sprint state
    const k = this.input.keys;
    this.isCrouching = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    const wantsSprint = k.has('ShiftLeft') || k.has('ShiftRight');
    this.isSprinting = wantsSprint && !this.isCrouching;

    const maxSpeed = this.isCrouching ? 3.4 : this.isSprinting ? 9.0 : 5.8;

    // Input direction in XZ plane from yaw
    const fInput = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const sInput = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    _forward.set(-Math.sin(this.input.yaw), 0, -Math.cos(this.input.yaw));
    _right.set(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw));

    _wishDir.set(0, 0, 0);
    _wishDir.addScaledVector(_forward, fInput);
    _wishDir.addScaledVector(_right, sInput);
    if (_wishDir.lengthSq() > 0.001) {
      _wishDir.normalize();
    }

    const vx = this.body.velocity.x;
    const vz = this.body.velocity.z;
    const targetVx = _wishDir.x * maxSpeed;
    const targetVz = _wishDir.z * maxSpeed;

    const rate = this.grounded ? (_wishDir.lengthSq() > 0.001 ? 14 : 11) : 3.2;
    const alpha = 1 - Math.exp(-rate * dt);

    this.body.velocity.x = vx + (targetVx - vx) * alpha;
    this.body.velocity.z = vz + (targetVz - vz) * alpha;

    // Jump execution (coyote + input buffer)
    if (this.input.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.body.velocity.y = 7.2;
      this.coyoteTimer = 0;
      this.input.jumpBufferTimer = 0;
      this.grounded = false;
    }

    // Hard safety floor clamp so player never tunnels below facility
    if (this.body.position.y < 0.84) {
      this.body.position.y = 0.85;
      if (this.body.velocity.y < 0) this.body.velocity.y = 0;
    }

    // Horizontal speed ratio & distance-synced footsteps
    const horizSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    this.speedRatio = Math.min(1, horizSpeed / 8.5);
    const moved = Math.hypot(
      this.body.position.x - this.prevPos.x,
      this.body.position.z - this.prevPos.z,
    );
    this.prevPos.set(this.body.position.x, this.body.position.y, this.body.position.z);

    if (this.grounded && horizSpeed > 0.8) {
      this.stepDist += moved;
      const stride = this.isSprinting ? 2.1 : 1.75;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        onFootstep(this.isSprinting);
      }
    }

    // Held prop spring pull in front of player camera
    if (this.heldProp) {
      if (this.heldProp.exploded) {
        this.heldProp = null;
      } else {
        this.getForwardDirection(_forward);
        _holdTarget
          .copy(this.camera.position)
          .addScaledVector(_forward, 1.85);
        _holdTarget.y = Math.max(0.55, _holdTarget.y - 0.1);
        const pb = this.heldProp.body;
        pb.wakeUp();
        pb.velocity.set(
          (_holdTarget.x - pb.position.x) * 14,
          (_holdTarget.y - pb.position.y) * 14,
          (_holdTarget.z - pb.position.z) * 14,
        );
        pb.angularVelocity.scale(0.8, pb.angularVelocity);
      }
    }

    this.syncCamera(dt);
  }

  public throwHeldProp(): boolean {
    if (!this.heldProp) return false;
    const prop = this.heldProp;
    this.heldProp = null;
    this.getForwardDirection(_forward);
    prop.body.wakeUp();
    prop.body.velocity.set(
      _forward.x * 16 + this.body.velocity.x * 0.4,
      _forward.y * 16 + 3.2,
      _forward.z * 16 + this.body.velocity.z * 0.4,
    );
    return true;
  }

  public syncCamera(dt: number): void {
    const targetEye = this.isCrouching ? 0.25 : 0.72;
    this.eyeOffset = dt > 0 ? THREE.MathUtils.damp(this.eyeOffset, targetEye, 14, dt) : targetEye;

    this.pitchKick = dt > 0 ? THREE.MathUtils.damp(this.pitchKick, 0, 14, dt) : 0;
    this.trauma = dt > 0 ? Math.max(0, this.trauma - dt * 1.45) : 0;
    const shake = this.trauma * this.trauma;
    const shakeX = (Math.random() * 2 - 1) * 0.045 * shake;
    const shakeY = (Math.random() * 2 - 1) * 0.045 * shake;
    const shakeRoll = (Math.random() * 2 - 1) * 0.03 * shake;

    this.camera.position.set(
      this.body.position.x + shakeX,
      this.body.position.y + this.eyeOffset + shakeY,
      this.body.position.z,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.input.yaw;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.input.pitch + this.pitchKick,
      -Math.PI * 0.46,
      Math.PI * 0.46,
    );
    this.camera.rotation.z = shakeRoll;
  }
}
