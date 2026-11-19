import * as CANNON from 'cannon-es';

// Collision filter groups
export const COL_WORLD = 1 << 0;
export const COL_PLAYER = 1 << 1;
export const COL_PROP = 1 << 2;
export const COL_ENEMY = 1 << 3;
export const COL_DOOR = 1 << 4;

export class PhysicsWorld {
  public world: CANNON.World;
  public defaultMat: CANNON.Material;
  public playerMat: CANNON.Material;
  public propMat: CANNON.Material;

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -20, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    (this.world.solver as CANNON.GSSolver).iterations = 8;

    this.defaultMat = new CANNON.Material('default');
    this.playerMat = new CANNON.Material('player');
    this.propMat = new CANNON.Material('prop');

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.playerMat, this.defaultMat, {
        friction: 0.0,
        restitution: 0.0,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.playerMat, this.propMat, {
        friction: 0.05,
        restitution: 0.0,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.propMat, this.defaultMat, {
        friction: 0.55,
        restitution: 0.15,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.propMat, this.propMat, {
        friction: 0.5,
        restitution: 0.15,
      }),
    );
  }

  public addStaticBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    rotX = 0,
    group = COL_WORLD,
  ): CANNON.Body {
    const body = new CANNON.Body({
      mass: 0,
      material: this.defaultMat,
      collisionFilterGroup: group,
      collisionFilterMask: COL_PLAYER | COL_PROP | COL_ENEMY,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(sx * 0.5, sy * 0.5, sz * 0.5)));
    body.position.set(cx, cy, cz);
    if (rotX !== 0) {
      body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), rotX);
    }
    this.world.addBody(body);
    return body;
  }

  public step(dt: number): void {
    this.world.step(1 / 60, dt, 8);
  }

  public dispose(): void {
    while (this.world.bodies.length > 0) {
      this.world.removeBody(this.world.bodies[0]);
    }
  }
}
