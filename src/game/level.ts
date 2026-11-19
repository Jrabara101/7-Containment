import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, COL_DOOR, COL_PLAYER, COL_PROP, COL_WORLD } from './physics';
import { ProceduralTextureSet } from './textures';
import type { PickupType } from './types';

export interface SlidingDoor {
  leftMesh: THREE.Mesh;
  rightMesh: THREE.Mesh;
  leftBody: CANNON.Body;
  rightBody: CANNON.Body;
  centerZ: number;
  halfGap: number;
  openAmount: number;
  wasOpen: boolean;
}

export interface DynamicProp {
  id: string;
  mesh: THREE.Group;
  body: CANNON.Body;
  kind: 'crate' | 'vent' | 'barrel';
  halfExtent: number;
  hp: number;
  exploded: boolean;
}

export interface PickupItem {
  id: string;
  type: PickupType;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
  amount: number;
  baseY: number;
}

export interface CorridorBreachState {
  triggered: boolean;
  timer: number;
  ventMesh: THREE.Group;
  ventBody: CANNON.Body;
  corridorLights: THREE.PointLight[];
  corridorStripMats: THREE.MeshStandardMaterial[];
}

export interface LevelBuildResult {
  group: THREE.Group;
  staticMeshes: THREE.Object3D[];
  doors: SlidingDoor[];
  props: DynamicProp[];
  pickups: PickupItem[];
  breach: CorridorBreachState;
  lockerFlickerLight: THREE.PointLight;
  lockerTubeMat: THREE.MeshStandardMaterial;
  roomLights: THREE.PointLight[];
  elevatorZone: { minX: number; maxX: number; minZ: number; maxZ: number };
  dispose: () => void;
}

export function buildFacilityLevel(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): LevelBuildResult {
  const group = new THREE.Group();
  const staticMeshes: THREE.Object3D[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const doors: SlidingDoor[] = [];
  const props: DynamicProp[] = [];
  const pickups: PickupItem[] = [];
  const roomLights: THREE.PointLight[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Shared PBR Materials
  const floorTileTex = textures.floorTileColor.clone();
  floorTileTex.repeat.set(4, 5);
  floorTileTex.needsUpdate = true;

  const concColorTex = textures.concreteColor.clone();
  concColorTex.repeat.set(6, 6);
  concColorTex.needsUpdate = true;

  const wallColorTex = textures.wallPanelColor.clone();
  wallColorTex.repeat.set(4, 1);
  wallColorTex.needsUpdate = true;

  const lockerFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: floorTileTex,
      bumpMap: textures.concreteBump,
      bumpScale: 0.015,
      roughness: 0.72,
      metalness: 0.08,
    }),
  );

  const concreteFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concColorTex,
      bumpMap: textures.concreteBump,
      bumpScale: 0.02,
      roughness: 0.85,
      metalness: 0.05,
    }),
  );

  const wallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallColorTex,
      bumpMap: textures.wallPanelBump,
      bumpScale: 0.025,
      roughness: 0.62,
      metalness: 0.32,
    }),
  );

  const ceilingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262b30,
      roughness: 0.82,
      metalness: 0.2,
    }),
  );

  const darkSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2e353b,
      roughness: 0.42,
      metalness: 0.78,
    }),
  );

  const trimSteelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x525d66,
      roughness: 0.34,
      metalness: 0.82,
    }),
  );

  const hazardMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.hazardColor,
      roughness: 0.65,
      metalness: 0.15,
    }),
  );

  const grateMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.grateColor,
      roughness: 0.48,
      metalness: 0.72,
    }),
  );

  const crateMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.crateColor,
      roughness: 0.8,
      metalness: 0.06,
    }),
  );

  const barrelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.barrelColor,
      roughness: 0.45,
      metalness: 0.55,
    }),
  );

  const shadowDiscGeo = trackGeo(new THREE.CircleGeometry(0.55, 16));
  const shadowDiscMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    }),
  );

  // Helper to create solid wall / floor / ceiling box with physics
  const addSolidBox = (
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    options?: {
      castShadow?: boolean;
      receiveShadow?: boolean;
      rotX?: number;
      skipPhysics?: boolean;
      uvRepeat?: [number, number];
    },
  ): THREE.Mesh => {
    const geo = trackGeo(new THREE.BoxGeometry(sx, sy, sz));
    if (options?.uvRepeat) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * options.uvRepeat[0], uv.getY(i) * options.uvRepeat[1]);
      }
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    if (options?.rotX) mesh.rotation.x = options.rotX;
    mesh.castShadow = options?.castShadow ?? !isSoftwareGl;
    mesh.receiveShadow = options?.receiveShadow ?? true;
    group.add(mesh);
    staticMeshes.push(mesh);

    if (!options?.skipPhysics) {
      physics.addStaticBox(cx, cy, cz, sx, sy, sz, options?.rotX ?? 0, COL_WORLD);
    }
    return mesh;
  };

  // Helper to build doorway partition wall + jambs + sliding doors
  const addDoorPartition = (
    zCenter: number,
    roomWidth: number,
    roomHeight: number,
    doorWidth: number,
    doorHeight: number,
  ) => {
    const wallThick = 0.8;
    const halfRoom = roomWidth * 0.5;
    const halfDoor = doorWidth * 0.5;
    const sideWidth = halfRoom - halfDoor;

    // Left & right solid wall sections
    if (sideWidth > 0.05) {
      addSolidBox(-halfDoor - sideWidth * 0.5, roomHeight * 0.5, zCenter, sideWidth, roomHeight, wallThick, wallMat);
      addSolidBox(halfDoor + sideWidth * 0.5, roomHeight * 0.5, zCenter, sideWidth, roomHeight, wallThick, wallMat);
    }
    // Header lintel above door
    const headerH = roomHeight - doorHeight;
    if (headerH > 0.05) {
      addSolidBox(0, doorHeight + headerH * 0.5, zCenter, doorWidth, headerH, wallThick, wallMat);
    }

    // Jamb frames on both sides + top trim (composite doorway framing)
    addSolidBox(-halfDoor + 0.08, doorHeight * 0.5, zCenter, 0.16, doorHeight, wallThick + 0.14, darkSteelMat, {
      skipPhysics: true,
    });
    addSolidBox(halfDoor - 0.08, doorHeight * 0.5, zCenter, 0.16, doorHeight, wallThick + 0.14, darkSteelMat, {
      skipPhysics: true,
    });
    addSolidBox(0, doorHeight - 0.08, zCenter, doorWidth + 0.2, 0.16, wallThick + 0.18, hazardMat, {
      skipPhysics: true,
    });

    // Twin sliding door leaves
    const leafW = doorWidth * 0.5;
    const leafGeo = trackGeo(new THREE.BoxGeometry(leafW, doorHeight - 0.16, 0.18));
    const leftMesh = new THREE.Mesh(leafGeo, trimSteelMat);
    const rightMesh = new THREE.Mesh(leafGeo, trimSteelMat);
    leftMesh.position.set(-leafW * 0.5, (doorHeight - 0.16) * 0.5, zCenter);
    rightMesh.position.set(leafW * 0.5, (doorHeight - 0.16) * 0.5, zCenter);
    leftMesh.castShadow = !isSoftwareGl;
    rightMesh.castShadow = !isSoftwareGl;
    leftMesh.receiveShadow = true;
    rightMesh.receiveShadow = true;
    group.add(leftMesh, rightMesh);
    staticMeshes.push(leftMesh, rightMesh);

    const makeDoorBody = (xPos: number) => {
      const b = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        material: physics.defaultMat,
        collisionFilterGroup: COL_DOOR,
        collisionFilterMask: 0xffff,
      });
      b.addShape(new CANNON.Box(new CANNON.Vec3(leafW * 0.5, (doorHeight - 0.16) * 0.5, 0.14)));
      b.position.set(xPos, (doorHeight - 0.16) * 0.5, zCenter);
      physics.world.addBody(b);
      return b;
    };

    const leftBody = makeDoorBody(-leafW * 0.5);
    const rightBody = makeDoorBody(leafW * 0.5);

    doors.push({
      leftMesh,
      rightMesh,
      leftBody,
      rightBody,
      centerZ: zCenter,
      halfGap: leafW,
      openAmount: 0,
      wasOpen: false,
    });
  };

  // Helper to build a composite ceiling fluorescent fixture
  const addLightFixture = (
    x: number,
    y: number,
    z: number,
    tubeMat: THREE.MeshStandardMaterial,
  ) => {
    const fix = new THREE.Group();
    fix.position.set(x, y, z);

    const housing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.7, 0.08, 0.42)), darkSteelMat);
    const endL = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.14, 0.44)), trimSteelMat);
    endL.position.x = -0.82;
    const endR = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.14, 0.44)), trimSteelMat);
    endR.position.x = 0.82;
    const tube = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.54, 10)), tubeMat);
    tube.rotation.z = Math.PI * 0.5;
    tube.position.y = -0.05;

    fix.add(housing, endL, endR, tube);
    group.add(fix);
  };

  // Helper to create composite 6-part Locker
  const addLockerUnit = (x: number, z: number, rotY: number) => {
    const locker = new THREE.Group();
    locker.position.set(x, 0, z);
    locker.rotation.y = rotY;

    const lockerPaint = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b4a52, roughness: 0.55, metalness: 0.45 }),
    );
    const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.95, 2.2, 0.65)), lockerPaint);
    body.position.y = 1.1;
    body.castShadow = !isSoftwareGl;
    body.receiveShadow = true;

    const doorPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.84, 2.02, 0.04)), trimSteelMat);
    doorPanel.position.set(0, 1.1, 0.32);

    const topCap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.0, 0.08, 0.7)), darkSteelMat);
    topCap.position.set(0, 2.24, 0);

    const ventSlit = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.5, 0.16, 0.03)), darkSteelMat);
    ventSlit.position.set(0, 1.85, 0.34);

    const handle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.05, 0.18, 0.06)), hazardMat);
    handle.position.set(0.3, 1.1, 0.36);

    const shadow = new THREE.Mesh(shadowDiscGeo, shadowDiscMat);
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.set(0, 0.015, 0);
    shadow.scale.set(1.2, 1.0, 1);

    locker.add(body, doorPanel, topCap, ventSlit, handle, shadow);
    group.add(locker);
    staticMeshes.push(body);
    physics.addStaticBox(x, 1.1, z, 0.96, 2.2, 0.68, 0, COL_WORLD);
  };

  // Helper to create composite Bench
  const addBench = (x: number, z: number) => {
    const bench = new THREE.Group();
    bench.position.set(x, 0, z);

    const seatMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x6f5236, roughness: 0.78, metalness: 0.08 }),
    );
    const seat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.4, 0.09, 0.72)), seatMat);
    seat.position.y = 0.56;
    seat.castShadow = !isSoftwareGl;
    seat.receiveShadow = true;

    const legGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.52, 0.62));
    const legL = new THREE.Mesh(legGeo, darkSteelMat);
    legL.position.set(-0.95, 0.26, 0);
    const legR = new THREE.Mesh(legGeo, darkSteelMat);
    legR.position.set(0.95, 0.26, 0);

    const brace = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.9, 0.06, 0.08)), darkSteelMat);
    brace.position.set(0, 0.2, 0);

    bench.add(seat, legL, legR, brace);
    group.add(bench);
    staticMeshes.push(seat);
    physics.addStaticBox(x, 0.3, z, 2.4, 0.6, 0.74, 0, COL_WORLD);
  };

  // Helper to build grabbable physics crate (composite 4-part)
  const addCrate = (id: string, x: number, y: number, z: number, size = 0.92) => {
    const crateGroup = new THREE.Group();
    crateGroup.position.set(x, y, z);

    const core = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(size, size, size)), crateMat);
    core.castShadow = !isSoftwareGl;
    core.receiveShadow = true;

    const rimH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(size + 0.03, 0.1, size + 0.03)), darkSteelMat);
    rimH.position.y = size * 0.42;
    const rimB = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(size + 0.03, 0.1, size + 0.03)), darkSteelMat);
    rimB.position.y = -size * 0.42;
    const band = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(size + 0.02, 0.09, size + 0.02)), hazardMat);

    crateGroup.add(core, rimH, rimB, band);
    group.add(crateGroup);

    const body = new CANNON.Body({
      mass: 18,
      material: physics.propMat,
      linearDamping: 0.18,
      angularDamping: 0.35,
      collisionFilterGroup: COL_PROP,
      collisionFilterMask: COL_WORLD | COL_PLAYER | COL_PROP | COL_DOOR,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size * 0.5, size * 0.5, size * 0.5)));
    body.position.set(x, y, z);
    physics.world.addBody(body);

    props.push({
      id,
      mesh: crateGroup,
      body,
      kind: 'crate',
      halfExtent: size * 0.5,
      hp: 999,
      exploded: false,
    });
  };

  // Helper to build explosive red barrel (composite 5-part)
  const addExplosiveBarrel = (id: string, x: number, y: number, z: number) => {
    const barrelGroup = new THREE.Group();
    barrelGroup.position.set(x, y, z);

    const cyl = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.42, 0.42, 1.24, 16)), barrelMat);
    cyl.castShadow = !isSoftwareGl;
    cyl.receiveShadow = true;

    const ringGeo = trackGeo(new THREE.TorusGeometry(0.425, 0.028, 8, 18));
    const ringTop = new THREE.Mesh(ringGeo, darkSteelMat);
    ringTop.rotation.x = Math.PI * 0.5;
    ringTop.position.y = 0.58;
    const ringMid = new THREE.Mesh(ringGeo, darkSteelMat);
    ringMid.rotation.x = Math.PI * 0.5;
    ringMid.position.y = 0.18;
    const ringBot = new THREE.Mesh(ringGeo, darkSteelMat);
    ringBot.rotation.x = Math.PI * 0.5;
    ringBot.position.y = -0.58;

    const cap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10)), hazardMat);
    cap.position.set(0.18, 0.64, 0.1);

    barrelGroup.add(cyl, ringTop, ringMid, ringBot, cap);
    group.add(barrelGroup);

    const body = new CANNON.Body({
      mass: 32,
      material: physics.propMat,
      linearDamping: 0.25,
      angularDamping: 0.45,
      collisionFilterGroup: COL_PROP,
      collisionFilterMask: COL_WORLD | COL_PLAYER | COL_PROP | COL_DOOR,
    });
    body.addShape(new CANNON.Cylinder(0.43, 0.43, 1.24, 10));
    body.position.set(x, y, z);
    physics.world.addBody(body);

    props.push({
      id,
      mesh: barrelGroup,
      body,
      kind: 'barrel',
      halfExtent: 0.62,
      hp: 30,
      exploded: false,
    });
  };

  // Helper to build composite Pickup Item
  const addPickup = (id: string, type: PickupType, x: number, y: number, z: number, amount: number) => {
    const pGroup = new THREE.Group();
    pGroup.position.set(x, y, z);

    const shadow = new THREE.Mesh(shadowDiscGeo, shadowDiscMat);
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.y = -y + 0.015;
    shadow.scale.setScalar(0.75);
    pGroup.add(shadow);

    const visual = new THREE.Group();
    pGroup.add(visual);

    if (type === 'wrench') {
      const steel = trackMat(new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.3, metalness: 0.88 }));
      const redGrip = trackMat(new THREE.MeshStandardMaterial({ color: 0xb73225, roughness: 0.65, metalness: 0.1 }));
      const shaft = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.62, 0.06, 0.09)), steel);
      const grip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.075, 0.105)), redGrip);
      grip.position.x = -0.14;
      const head = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 0.08, 0.22)), steel);
      head.position.set(0.28, 0, 0.03);
      const jaw = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.075, 0.14)), trimSteelMat);
      jaw.position.set(0.33, 0, -0.05);
      visual.add(shaft, grip, head, jaw);
    } else if (type === 'pistol') {
      const gunMetal = trackMat(new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.28, metalness: 0.88 }));
      const slide = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.09, 0.08)), gunMetal);
      slide.position.y = 0.06;
      const frame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.34, 0.06, 0.07)), trimSteelMat);
      const grip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.1, 0.2, 0.072)), darkSteelMat);
      grip.position.set(-0.11, -0.1, 0);
      grip.rotation.z = -0.22;
      const sight = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.03, 0.03, 0.03)), hazardMat);
      sight.position.set(0.18, 0.115, 0);
      visual.add(slide, frame, grip, sight);
    } else if (type === 'ammo') {
      const brass = trackMat(new THREE.MeshStandardMaterial({ color: 0xd4a438, roughness: 0.32, metalness: 0.82 }));
      const box = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.24, 0.3)), darkSteelMat);
      const stripe = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.44, 0.06, 0.31)), brass);
      stripe.position.y = 0.04;
      const clasp = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.1, 0.32)), hazardMat);
      visual.add(box, stripe, clasp);
    } else if (type === 'health') {
      const whiteMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe8edf0, roughness: 0.42, metalness: 0.1 }));
      const crossMat = trackMat(new THREE.MeshStandardMaterial({
        color: 0xd93829,
        emissive: 0x601008,
        emissiveIntensity: 0.6,
        roughness: 0.35,
      }));
      const caseMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.48, 0.24, 0.34)), whiteMat);
      const crossH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.03, 0.08)), crossMat);
      crossH.position.y = 0.13;
      const crossV = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.03, 0.22)), crossMat);
      crossV.position.y = 0.13;
      const handle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.05, 0.04)), darkSteelMat);
      handle.position.set(0, 0.02, 0.18);
      visual.add(caseMesh, crossH, crossV, handle);
    } else if (type === 'armor') {
      const armorMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2f6a96, roughness: 0.38, metalness: 0.65 }));
      const plate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.44, 0.42, 0.22)), armorMat);
      const chest = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.22, 0.26)), trimSteelMat);
      chest.position.y = 0.05;
      const badge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.1, 0.28)), hazardMat);
      visual.add(plate, chest, badge);
    }

    group.add(pGroup);
    pickups.push({
      id,
      type,
      mesh: pGroup,
      position: new THREE.Vector3(x, y, z),
      collected: false,
      amount,
      baseY: y,
    });
  };

  // =========================================================
  // 1. LOCKER ROOM (Z: +4 to -12, X: -6 to +6, Height: 4.2)
  // =========================================================
  addSolidBox(0, -0.25, -4, 12, 0.5, 16, lockerFloorMat, { skipPhysics: true }); // Floor top at Y=0
  addSolidBox(0, 4.45, -4, 12, 0.5, 16, ceilingMat, { castShadow: false });
  addDoorPartition(4.4, 12.8, 4.2, 3.2, 3.0); // Airlock door from Stronghold Lobby
  addSolidBox(-6.4, 2.1, -4, 0.8, 4.2, 16, wallMat); // Left wall
  addSolidBox(6.4, 2.1, -4, 0.8, 4.2, 16, wallMat); // Right wall

  // Locker banks flush along left & right walls
  for (let i = 0; i < 4; i++) {
    addLockerUnit(-5.3, -1 - i * 1.4, Math.PI * 0.5);
    addLockerUnit(5.3, -1 - i * 1.4, -Math.PI * 0.5);
  }
  // Center bench with the Pipe Wrench clearly visible from spawn!
  addBench(0, -4.6);
  addPickup('pickup-wrench', 'wrench', 0, 0.72, -4.6, 1);
  addPickup('pickup-armor-locker', 'armor', -4.2, 0.35, -8.5, 35);

  // Overhead steel ceiling beams in Locker Room
  for (const bz of [-1.5, -4.5, -7.5, -10.5]) {
    addSolidBox(0, 4.12, bz, 12, 0.18, 0.24, darkSteelMat, { skipPhysics: true, castShadow: false });
  }

  // Flickering fluorescent fixtures
  const lockerTubeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9f1f5,
      emissive: 0xc2edf5,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  );
  addLightFixture(0, 4.15, -1.5, lockerTubeMat);
  addLightFixture(0, 4.15, -7.5, lockerTubeMat);

  const lockerFlickerLight = new THREE.PointLight(0xcbeeff, 18, 22, 1.5);
  lockerFlickerLight.position.set(0, 3.6, -4.5);
  scene.add(lockerFlickerLight);
  roomLights.push(lockerFlickerLight);

  // Door 1 at Z = -12
  addDoorPartition(-12, 12, 4.2, 3.2, 3.0);

  // =========================================================
  // 2. CORRIDOR (Z: -12 to -32, X: -2.4 to +2.4, Height: 3.8)
  // =========================================================
  addSolidBox(0, -0.25, -22, 5.2, 0.5, 20, concreteFloorMat, { skipPhysics: true });
  addSolidBox(0, 4.05, -22, 5.2, 0.5, 20, ceilingMat, { castShadow: false });
  addSolidBox(-2.8, 1.9, -22, 0.8, 3.8, 20, wallMat);
  addSolidBox(2.8, 1.9, -22, 0.8, 3.8, 20, wallMat);

  // Overhead conduit pipes running along corridor
  const pipeGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 19.2, 10));
  const pipeL = new THREE.Mesh(pipeGeo, trimSteelMat);
  pipeL.rotation.x = Math.PI * 0.5;
  pipeL.position.set(-2.0, 3.35, -22);
  const pipeR = new THREE.Mesh(pipeGeo, trimSteelMat);
  pipeR.rotation.x = Math.PI * 0.5;
  pipeR.position.set(2.0, 3.35, -22);
  group.add(pipeL, pipeR);

  // Corridor Emergency Lights (start calm amber, turn pulsing crimson on breach)
  const corridorStripMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd0d8dc,
      emissive: 0xaabcc4,
      emissiveIntensity: 1.1,
    }),
  );
  addLightFixture(0, 3.74, -17, corridorStripMat);
  addLightFixture(0, 3.74, -26, corridorStripMat);

  const corLight1 = new THREE.PointLight(0xbcd0d8, 14, 18, 1.6);
  corLight1.position.set(0, 3.3, -17);
  const corLight2 = new THREE.PointLight(0xbcd0d8, 14, 18, 1.6);
  corLight2.position.set(0, 3.3, -26);
  scene.add(corLight1, corLight2);
  roomLights.push(corLight1, corLight2);

  // Overhead Vent Shaft + Detachable Vent Cover at Z = -20.5
  const ductCollar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.3, 0.25, 1.3)), darkSteelMat);
  ductCollar.position.set(0.4, 3.7, -20.5);
  group.add(ductCollar);

  const ventGroup = new THREE.Group();
  ventGroup.position.set(0.4, 3.55, -20.5);
  const ventFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.18, 0.08, 1.18)), trimSteelMat);
  ventGroup.add(ventFrame);
  for (let s = -2; s <= 2; s++) {
    const slat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.96, 0.04, 0.08)), darkSteelMat);
    slat.position.set(0, -0.02, s * 0.2);
    slat.rotation.x = 0.28;
    ventGroup.add(slat);
  }
  group.add(ventGroup);

  const ventBody = new CANNON.Body({
    mass: 0, // Static/kinematic until breach event releases it!
    material: physics.propMat,
    collisionFilterGroup: COL_PROP,
    collisionFilterMask: COL_WORLD | COL_PLAYER | COL_PROP,
  });
  ventBody.addShape(new CANNON.Box(new CANNON.Vec3(0.58, 0.06, 0.58)));
  ventBody.position.set(0.4, 3.55, -20.5);
  physics.world.addBody(ventBody);

  // Door 2 at Z = -32
  addDoorPartition(-32, 18, 5.5, 3.2, 3.0);

  // =========================================================
  // 3. STORAGE ROOM (Z: -32 to -52, X: -9 to +9, Height: 5.5)
  // =========================================================
  addSolidBox(0, -0.25, -42, 18, 0.5, 20, concreteFloorMat, { skipPhysics: true });
  addSolidBox(0, 5.75, -42, 18, 0.5, 20, ceilingMat, { castShadow: false });
  addSolidBox(-9.4, 2.75, -42, 0.8, 5.5, 20, wallMat);
  addSolidBox(9.4, 2.75, -42, 0.8, 5.5, 20, wallMat);

  // Shelving Racks along side walls
  const addShelfRack = (x: number, z: number) => {
    const rack = new THREE.Group();
    rack.position.set(x, 0, z);
    const postGeo = trackGeo(new THREE.BoxGeometry(0.12, 3.4, 0.12));
    const postOffsets = [
      [-1.1, -0.55], [1.1, -0.55], [-1.1, 0.55], [1.1, 0.55],
    ];
    for (const [px, pz] of postOffsets) {
      const p = new THREE.Mesh(postGeo, darkSteelMat);
      p.position.set(px, 1.7, pz);
      rack.add(p);
    }
    const shelfGeo = trackGeo(new THREE.BoxGeometry(2.3, 0.08, 1.2));
    for (const sy of [0.35, 1.4, 2.45, 3.35]) {
      const s = new THREE.Mesh(shelfGeo, trimSteelMat);
      s.position.y = sy;
      s.castShadow = !isSoftwareGl;
      s.receiveShadow = true;
      rack.add(s);
    }
    group.add(rack);
    physics.addStaticBox(x, 1.7, z, 2.35, 3.4, 1.25, 0, COL_WORLD);
  };
  addShelfRack(-6.8, -37.5);
  addShelfRack(-6.8, -45.5);
  addShelfRack(6.8, -37.5);
  addShelfRack(6.8, -45.5);

  // Supply table in center-front of Storage Room holding Pistol + Ammo
  addSolidBox(0, 0.42, -37.5, 2.2, 0.84, 1.1, darkSteelMat);
  addPickup('pickup-pistol', 'pistol', -0.45, 1.0, -37.5, 1);
  addPickup('pickup-ammo-1', 'ammo', 0.45, 1.0, -37.5, 24);
  addPickup('pickup-health-1', 'health', -6.8, 0.55, -41.5, 30);

  // Stacked grabbable physics crates in Storage Room
  addCrate('crate-s1', -3.4, 0.48, -39.5);
  addCrate('crate-s2', -2.35, 0.48, -39.5);
  addCrate('crate-s3', -2.9, 1.42, -39.5);
  addCrate('crate-s4', 3.4, 0.48, -41.2);
  addCrate('crate-s5', 3.4, 1.42, -41.2);
  addCrate('crate-s6', -3.6, 0.48, -46.8);

  const storageTubeMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xf0e4c8, emissive: 0xe6c88a, emissiveIntensity: 1.5 }),
  );
  addLightFixture(-3.5, 5.42, -40, storageTubeMat);
  addLightFixture(3.5, 5.42, -45, storageTubeMat);

  const storageLight = new THREE.PointLight(0xffdfb0, 28, 30, 1.35);
  storageLight.position.set(0, 4.8, -42);
  scene.add(storageLight);
  roomLights.push(storageLight);

  // Door 3 at Z = -52
  addDoorPartition(-52, 24, 7.0, 3.6, 3.2);

  // =========================================================
  // 4. CONTAINMENT LAB (Z: -52 to -80, X: -12 to +12, Height: 7.0)
  // =========================================================
  addSolidBox(0, -0.25, -66, 24, 0.5, 28, concreteFloorMat, { skipPhysics: true });
  addSolidBox(0, 7.25, -66, 24, 0.5, 28, ceilingMat, { castShadow: false });
  addSolidBox(-12.4, 3.5, -66, 0.8, 7.0, 28, wallMat);
  addSolidBox(12.4, 3.5, -66, 0.8, 7.0, 28, wallMat);

  // Elevated Steel Catwalks (Left X: -11.6 to -7.6, Right X: 7.6 to 11.6, Y = 2.4, Z = -61 to -77)
  const addCatwalkSide = (side: -1 | 1) => {
    const xCenter = side * 9.6;
    // Flat deck
    addSolidBox(xCenter, 2.3, -69, 4.0, 0.22, 16.0, grateMat);
    // Support columns
    for (const pz of [-62, -69, -76]) {
      addSolidBox(side * 7.8, 1.1, pz, 0.35, 2.2, 0.35, darkSteelMat);
    }
    // Safety railing posts & top rail along inner edge
    const railX = side * 7.7;
    for (const pz of [-61.5, -65, -69, -73, -76.5]) {
      addSolidBox(railX, 2.9, pz, 0.08, 1.0, 0.08, hazardMat, { skipPhysics: true });
    }
    addSolidBox(railX, 3.35, -69, 0.08, 0.08, 15.6, hazardMat);

    // Sloped ramp from Z = -55.5 (Y=0) to Z = -61.0 (Y=2.3)
    // Length ~6.0m, pitch atan2(2.3, 5.5) ~= 0.396 rad
    const rampAngle = Math.atan2(2.3, 5.5);
    addSolidBox(xCenter, 1.15, -58.25, 3.6, 0.22, 6.0, grateMat, {
      rotX: rampAngle,
    });
  };
  addCatwalkSide(-1);
  addCatwalkSide(1);

  // Central Containment Bio-Tanks (2 composite multi-part cylinders flanking center aisle)
  const tankGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x55d8b8,
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  );
  const tankCoreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x22e6a8,
      emissive: 0x16b884,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    }),
  );
  const addContainmentTank = (x: number, z: number) => {
    const tank = new THREE.Group();
    tank.position.set(x, 0, z);
    const base = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.25, 1.35, 0.65, 16)), darkSteelMat);
    base.position.y = 0.325;
    const cap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.25, 1.25, 0.55, 16)), darkSteelMat);
    cap.position.y = 4.05;
    const core = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.45, 0.45, 3.1, 12)), tankCoreMat);
    core.position.y = 2.2;
    const glass = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.05, 1.05, 3.2, 18)), tankGlassMat);
    glass.position.y = 2.2;
    glass.renderOrder = 2;
    tank.add(base, cap, core, glass);
    group.add(tank);
    staticMeshes.push(base, cap);
    physics.addStaticBox(x, 2.2, z, 2.2, 4.4, 2.2, 0, COL_WORLD);
  };
  addContainmentTank(-3.4, -64.5);
  addContainmentTank(3.4, -71.5);

  // Explosive Red Barrels placed near combat lanes
  addExplosiveBarrel('barrel-1', -1.2, 0.65, -62.5);
  addExplosiveBarrel('barrel-2', 2.8, 0.65, -66.5);
  addExplosiveBarrel('barrel-3', -2.4, 0.65, -73.0);
  addExplosiveBarrel('barrel-4', 9.2, 3.05, -68.5); // On right catwalk!

  // Lab Pickups
  addPickup('pickup-ammo-lab1', 'ammo', -9.6, 2.75, -66, 24);
  addPickup('pickup-health-lab1', 'health', 9.6, 2.75, -65, 35);
  addPickup('pickup-armor-lab1', 'armor', -9.6, 2.75, -74, 40);
  addPickup('pickup-health-lab2', 'health', 0, 0.35, -77.5, 30);

  const labLight1 = new THREE.PointLight(0x8be2d0, 30, 32, 1.3);
  labLight1.position.set(0, 5.8, -62);
  const labLight2 = new THREE.PointLight(0xffb478, 28, 32, 1.3);
  labLight2.position.set(0, 5.8, -73);
  scene.add(labLight1, labLight2);
  roomLights.push(labLight1, labLight2);

  // Door 4 at Z = -80 (Elevator Blast Door)
  addDoorPartition(-80, 24, 7.0, 4.0, 3.2);

  // =========================================================
  // 5. EXIT ELEVATOR BAY (Z: -80 to -88, X: -3.5 to +3.5, Height: 4.0)
  // =========================================================
  addSolidBox(0, -0.25, -84, 7.4, 0.5, 8.2, concreteFloorMat, { skipPhysics: true });
  addSolidBox(0, 4.25, -84, 7.4, 0.5, 8.2, ceilingMat, { castShadow: false });
  addSolidBox(-3.9, 2.0, -84, 0.8, 4.0, 8.2, wallMat);
  addSolidBox(3.9, 2.0, -84, 0.8, 4.0, 8.2, wallMat);
  addSolidBox(0, 2.0, -88.4, 7.8, 4.0, 0.8, wallMat);

  // Extraction floor pad (elevated slightly by 0.03 to prevent Z-fighting)
  const padMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x214a35,
      emissive: 0x18a35a,
      emissiveIntensity: 0.75,
      roughness: 0.4,
    }),
  );
  addSolidBox(0, 0.03, -84.8, 3.6, 0.06, 3.6, padMat, { skipPhysics: true });
  addSolidBox(0, 0.02, -84.8, 4.1, 0.04, 4.1, hazardMat, { skipPhysics: true });

  // Elevator extraction console
  addSolidBox(2.3, 0.65, -85.8, 0.8, 1.3, 0.7, darkSteelMat);
  const screenMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x26e383, emissive: 0x14b862, emissiveIntensity: 1.5 }),
  );
  addSolidBox(2.3, 1.15, -85.42, 0.55, 0.35, 0.08, screenMat, { skipPhysics: true });

  const elevatorLight = new THREE.PointLight(0x4ef29e, 18, 16, 1.4);
  elevatorLight.position.set(0, 3.4, -84.5);
  scene.add(elevatorLight);
  roomLights.push(elevatorLight);

  scene.add(group);

  return {
    group,
    staticMeshes,
    doors,
    props,
    pickups,
    breach: {
      triggered: false,
      timer: 0,
      ventMesh: ventGroup,
      ventBody,
      corridorLights: [corLight1, corLight2],
      corridorStripMats: [corridorStripMat],
    },
    lockerFlickerLight,
    lockerTubeMat,
    roomLights,
    elevatorZone: { minX: -2.6, maxX: 2.6, minZ: -87.4, maxZ: -82.5 },
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      scene.remove(group);
    },
  };
}
