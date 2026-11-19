import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, COL_DOOR, COL_WORLD } from './physics';
import { ProceduralTextureSet } from './textures';
import { estimateLineDuration, formatEtaCountdown, PA_BRIEFING_CUES } from './rules';
import type { StoryStage } from './types';

interface QueuedLine {
  speaker: string | null;
  text: string;
  chime: boolean;
  minDuration: number;
  onDone?: () => void;
}

/** Pause between the end of one line and the start of the next. */
const LINE_GAP_SECONDS = 0.6;

interface NpcActor {
  group: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  head: THREE.Mesh;
  role: 'police' | 'scientist';
  phase: number;
}

export interface StoryCallbacks {
  onIntercomCue: (speaker: string | null, line: string | null, playChime: boolean) => void;
  onDoorOpenSound: () => void;
  onBanner: (text: string, duration?: number) => void;
  /** True while the intercom voice is still speaking (or has speech queued). */
  isVoiceBusy: () => boolean;
}

export class StoryManager {
  public stage: StoryStage = 'train_transit';
  public etaSeconds = 300; // Starts at 5:00 ETA display
  public saveConsolePos = new THREE.Vector3(0, 1.0, 17.5);
  public intercomSpeaker: string | null = null;
  public intercomLine: string | null = null;

  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private group = new THREE.Group();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private texturesToDispose: THREE.Texture[] = [];
  private lights: THREE.PointLight[] = [];

  // Train transit animation
  private tunnelGroup = new THREE.Group();
  private tunnelShutter: THREE.Mesh;
  private trainSpeed = 28;
  private transitStarted = false;
  private currentCueIndex = -1;

  // Dialogue queue: each line is held until it has been fully spoken/read
  private lineQueue: QueuedLine[] = [];
  private activeLine: QueuedLine | null = null;
  private activeLineTimer = 0;
  private lineGapTimer = 0;
  private etaCanvas!: HTMLCanvasElement;
  private etaCtx!: CanvasRenderingContext2D;
  private etaTexture!: THREE.CanvasTexture;
  private lastEtaLabel = '';

  // Train side boarding doors (X = +2.0, Z = +48)
  private trainDoorLeft!: THREE.Mesh;
  private trainDoorRight!: THREE.Mesh;
  private trainDoorLeftBody!: CANNON.Body;
  private trainDoorRightBody!: CANNON.Body;
  private trainDoorOpen = 0;

  // Stronghold Door (Z = +30, X = +5.5)
  private strongholdLeftMesh!: THREE.Mesh;
  private strongholdRightMesh!: THREE.Mesh;
  private strongholdLeftBody!: CANNON.Body;
  private strongholdRightBody!: CANNON.Body;
  private strongholdOpen = 0;
  private strongholdWasOpen = false;
  private lobbyEnteredAnnounced = false;

  // Save console screen texture
  private saveCanvas!: HTMLCanvasElement;
  private saveCtx!: CanvasRenderingContext2D;
  private saveTexture!: THREE.CanvasTexture;

  // NPCs
  private escortOfficer!: NpcActor;
  private escortWaypointIndex = 0;
  private escortWaypoints = [
    new THREE.Vector3(3.1, 0, 47.4),
    new THREE.Vector3(5.5, 0, 41.5),
    new THREE.Vector3(5.5, 0, 33.2),
    new THREE.Vector3(7.6, 0, 31.8),
  ];
  private lobbyNpcs: NpcActor[] = [];
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
    this.tunnelShutter = new THREE.Mesh();

    this.buildTrainAndPlatform(textures);
    this.buildStrongholdLobby(textures);
    this.buildCharacters();

    scene.add(this.group);
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private addBox(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    skipPhysics = false,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(sx, sy, sz)), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = !this.isSoftwareGl;
    m.receiveShadow = true;
    this.group.add(m);
    if (!skipPhysics) {
      this.physics.addStaticBox(cx, cy, cz, sx, sy, sz, 0, COL_WORLD);
    }
    return m;
  }

  private makeScreenTexture(
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture] {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.texturesToDispose.push(tex);
    return [canvas, ctx, tex];
  }

  private buildTrainAndPlatform(textures: ProceduralTextureSet): void {
    const hullMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b444c, roughness: 0.48, metalness: 0.55 }),
    );
    const darkMetal = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: 0.52, metalness: 0.7 }),
    );
    const floorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: textures.floorTileColor,
        roughness: 0.78,
        metalness: 0.08,
      }),
    );
    const seatMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x7a3428, roughness: 0.75, metalness: 0.05 }),
    );
    const glassMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x8cc2d8,
        roughness: 0.12,
        metalness: 0.05,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    const hazardMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.hazardColor, roughness: 0.65 }),
    );
    const concMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: textures.concreteColor,
        bumpMap: textures.concreteBump,
        bumpScale: 0.02,
        roughness: 0.85,
      }),
    );
    const wallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: textures.wallPanelColor,
        bumpMap: textures.wallPanelBump,
        bumpScale: 0.02,
        roughness: 0.62,
        metalness: 0.3,
      }),
    );

    // =====================================================
    // TRANSIT TRAIN CARRIAGE (X: -2.0 to +2.0, Z: +44 to +58)
    // =====================================================
    this.addBox(0, -0.25, 51, 4.2, 0.5, 14.4, floorMat, true);
    // Unified seam-free ground collider across Train -> Platform -> Lobby -> Facility
    this.physics.addStaticBox(0, -0.25, -15, 28, 0.5, 148, 0, COL_WORLD);
    this.addBox(0, 3.4, 51, 4.2, 0.3, 14.4, darkMetal); // Roof
    this.addBox(0, 1.6, 43.9, 4.2, 3.2, 0.4, hullMat); // Front bulkhead
    this.addBox(0, 1.6, 58.1, 4.2, 3.2, 0.4, hullMat); // Rear bulkhead

    // Left carriage wall (with windows)
    this.addBox(-2.05, 0.5, 51, 0.2, 1.0, 14.2, hullMat);
    this.addBox(-2.05, 2.8, 51, 0.2, 1.0, 14.2, hullMat);
    for (const mz of [45.5, 48.5, 51.5, 54.5, 57.2]) {
      this.addBox(-2.05, 1.65, mz, 0.22, 1.35, 0.35, darkMetal);
    }
    const leftGlass = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.06, 1.3, 13.4)), glassMat);
    leftGlass.position.set(-2.05, 1.65, 51);
    this.group.add(leftGlass);

    // Right carriage wall (with Boarding Door gap at Z: 46.6..49.4)
    // Front section Z: 44.0..46.6
    this.addBox(2.05, 1.6, 45.3, 0.22, 3.2, 2.6, hullMat);
    // Rear section Z: 49.4..58.0 (lower + upper + mullions + glass)
    this.addBox(2.05, 0.5, 53.7, 0.2, 1.0, 8.6, hullMat);
    this.addBox(2.05, 2.8, 53.7, 0.2, 1.0, 8.6, hullMat);
    for (const mz of [51.0, 54.0, 57.0]) {
      this.addBox(2.05, 1.65, mz, 0.22, 1.35, 0.35, darkMetal);
    }
    const rightGlass = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.06, 1.3, 8.2)), glassMat);
    rightGlass.position.set(2.05, 1.65, 53.7);
    this.group.add(rightGlass);

    // Door header above train boarding door (Z: 46.6..49.4)
    this.addBox(2.05, 2.8, 48.0, 0.24, 1.0, 2.8, hullMat);
    this.addBox(2.05, 2.32, 48.0, 0.26, 0.14, 2.8, hazardMat, true);

    // Sliding Train Boarding Doors
    const tLeafGeo = this.trackGeo(new THREE.BoxGeometry(0.14, 2.3, 1.4));
    this.trainDoorLeft = new THREE.Mesh(tLeafGeo, darkMetal);
    this.trainDoorRight = new THREE.Mesh(tLeafGeo, darkMetal);
    this.trainDoorLeft.position.set(2.05, 1.15, 47.3);
    this.trainDoorRight.position.set(2.05, 1.15, 48.7);
    this.group.add(this.trainDoorLeft, this.trainDoorRight);

    const makeTrainDoorBody = (zPos: number) => {
      const b = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        material: this.physics.defaultMat,
        collisionFilterGroup: COL_DOOR,
        collisionFilterMask: 0xffff,
      });
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.14, 1.15, 0.7)));
      b.position.set(2.05, 1.15, zPos);
      this.physics.world.addBody(b);
      return b;
    };
    this.trainDoorLeftBody = makeTrainDoorBody(47.3);
    this.trainDoorRightBody = makeTrainDoorBody(48.7);

    // Interior benches & handrails
    this.addBox(-1.55, 0.42, 52.8, 0.75, 0.16, 7.2, seatMat);
    this.addBox(1.55, 0.42, 54.1, 0.75, 0.16, 6.2, seatMat);
    const railGeo = this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 12.2, 8));
    const railMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xc2c8cc, roughness: 0.25, metalness: 0.9 }));
    for (const rx of [-0.9, 0.9]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.rotation.x = Math.PI * 0.5;
      rail.position.set(rx, 2.45, 51);
      this.group.add(rail);
    }

    // PA Speaker unit & Digital ETA Sign at front bulkhead (Z = 44.2)
    const speakerBox = this.addBox(0, 2.82, 44.22, 0.65, 0.26, 0.16, darkMetal, true);
    const speakerLed = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(0.04, 8, 8)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0xffa62b, emissive: 0xff8800, emissiveIntensity: 2.0 })),
    );
    speakerLed.position.set(0.22, 2.82, 44.32);
    this.group.add(speakerBox, speakerLed);

    const [etaC, etaCtx, etaTex] = this.makeScreenTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#0c1116';
      ctx.fillRect(0, 0, w, h);
    });
    this.etaCanvas = etaC;
    this.etaCtx = etaCtx;
    this.etaTexture = etaTex;
    this.updateEtaDisplay('ETA 05:00');

    const etaSign = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(2.2, 0.52)),
      this.trackMat(new THREE.MeshBasicMaterial({ map: this.etaTexture })),
    );
    etaSign.position.set(0, 2.35, 44.14);
    this.group.add(etaSign);

    // Dossier plaque on front bulkhead
    const [, , dossierTex] = this.makeScreenTexture(512, 192, (ctx, w, h) => {
      ctx.fillStyle = '#141a20';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e6a23c';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#e6a23c';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('PASSENGER DOSSIER // SECTOR 7', 24, 38);
      ctx.fillStyle = '#f0ebe1';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('CARL JAMES G. BELLVEES  (AGE 29)', 24, 84);
      ctx.fillStyle = '#9ec4d8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('PART-TIME INSPECTOR SECURITY & SCIENTIST', 24, 124);
      ctx.fillStyle = '#a8b0b6';
      ctx.font = '16px monospace';
      ctx.fillText('CLEARANCE: SUBLEVEL COLLIDER AUDIT', 24, 160);
    });
    const dossierSign = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(1.9, 0.72)),
      this.trackMat(new THREE.MeshBasicMaterial({ map: dossierTex })),
    );
    dossierSign.position.set(0, 1.55, 44.14);
    this.group.add(dossierSign);

    // Train ceiling light
    const trainLight = new THREE.PointLight(0xd2e8f5, 14, 16, 1.5);
    trainLight.position.set(0, 2.95, 50.5);
    this.scene.add(trainLight);
    this.lights.push(trainLight);

    // Scrolling Tunnel Ribs & Lights outside windows
    const ribMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x1a2026, roughness: 0.9 }));
    const lampMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xffaa3b, emissive: 0xff8818, emissiveIntensity: 2.2 }),
    );
    for (let i = 0; i < 12; i++) {
      const zOff = i * 4.5 - 10;
      const ribL = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.4, 4.0, 0.45)), ribMat);
      ribL.position.set(-3.2, 1.6, zOff);
      const lampL = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.15, 0.25, 0.8)), lampMat);
      lampL.position.set(-2.95, 2.2, zOff);
      this.tunnelGroup.add(ribL, lampL);
    }
    // Dark tunnel shutter hiding platform outside right window while in transit
    this.tunnelShutter = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.2, 4.2, 22)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.95 })),
    );
    this.tunnelShutter.position.set(2.45, 1.8, 51);
    this.tunnelGroup.add(this.tunnelShutter);
    this.tunnelGroup.position.set(0, 0, 44);
    this.group.add(this.tunnelGroup);

    // =====================================================
    // STATION PLATFORM & RECESSED RAIL BAY (X: -3.6 to +10.0, Z: +30 to +58)
    // =====================================================
    this.addBox(6.1, -0.25, 44, 8.2, 0.5, 28, concMat, true);
    this.addBox(6.1, 4.85, 44, 8.2, 0.5, 28, darkMetal);
    this.addBox(10.3, 2.3, 44, 0.6, 4.6, 28, wallMat); // Outer right platform wall
    this.addBox(6.1, 2.3, 58.2, 8.2, 4.6, 0.6, wallMat); // Rear platform wall
    // Platform safety hazard edge along train track
    this.addBox(2.35, 0.02, 44, 0.45, 0.04, 27.6, hazardMat, true);
    // Invisible guard rail along track drop-off north of train (keeps boarding door Z:46.6..49.4 open)
    this.physics.addStaticBox(1.9, 0.8, 36.9, 0.2, 1.6, 13.8, 0, COL_WORLD);

    // Enclosed Rail Bay to the left of the platform (prevents open void past train front)
    this.addBox(-0.8, -0.85, 44, 5.8, 0.4, 28, darkMetal, true); // Track bed
    this.addBox(-0.8, 4.85, 44, 5.8, 0.5, 28, darkMetal); // Track bay ceiling
    this.addBox(-3.7, 2.1, 44, 0.5, 5.6, 28, wallMat); // Left tunnel wall
    this.addBox(-0.8, 2.1, 58.2, 5.8, 5.6, 0.6, wallMat); // Rear tunnel wall
    this.addBox(-1.1, -0.58, 44, 0.14, 0.14, 27.6, hullMat, true); // Left steel rail
    this.addBox(1.1, -0.58, 44, 0.14, 0.14, 27.6, hullMat, true); // Right steel rail

    const platLight = new THREE.PointLight(0xffe0b2, 22, 24, 1.4);
    platLight.position.set(6.0, 4.1, 42);
    const platGateLight = new THREE.PointLight(0xd9efff, 16, 18, 1.4);
    platGateLight.position.set(5.5, 4.1, 33.0);
    this.scene.add(platLight, platGateLight);
    this.lights.push(platLight, platGateLight);

    // Stronghold Door Partition at Z = 30.0 (Platform X: 2.0..10.0, Door X: 3.7..7.3)
    this.addBox(2.85, 2.3, 30.0, 1.7, 4.6, 0.8, wallMat); // Left of door
    this.addBox(8.65, 2.3, 30.0, 2.7, 4.6, 0.8, wallMat); // Right of door
    this.addBox(5.5, 3.9, 30.0, 3.6, 1.4, 0.8, wallMat); // Above door
    this.addBox(5.5, 3.12, 30.0, 3.7, 0.16, 0.92, hazardMat, true);

    const [, , strongholdSignTex] = this.makeScreenTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#12181d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e6a23c';
      ctx.font = 'bold 30px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STRONGHOLD LOBBY // SEC-07', w / 2, 60);
    });
    const shSign = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(3.2, 0.56)),
      this.trackMat(new THREE.MeshBasicMaterial({ map: strongholdSignTex })),
    );
    shSign.position.set(5.5, 3.65, 30.45);
    this.group.add(shSign);

    const shLeafGeo = this.trackGeo(new THREE.BoxGeometry(1.8, 3.04, 0.2));
    const shLeafMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x4c5862, roughness: 0.36, metalness: 0.78 }));
    this.strongholdLeftMesh = new THREE.Mesh(shLeafGeo, shLeafMat);
    this.strongholdRightMesh = new THREE.Mesh(shLeafGeo, shLeafMat);
    this.strongholdLeftMesh.position.set(4.6, 1.52, 30.0);
    this.strongholdRightMesh.position.set(6.4, 1.52, 30.0);
    this.group.add(this.strongholdLeftMesh, this.strongholdRightMesh);

    const makeShBody = (xPos: number) => {
      const b = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        material: this.physics.defaultMat,
        collisionFilterGroup: COL_DOOR,
        collisionFilterMask: 0xffff,
      });
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 1.52, 0.15)));
      b.position.set(xPos, 1.52, 30.0);
      this.physics.world.addBody(b);
      return b;
    };
    this.strongholdLeftBody = makeShBody(4.6);
    this.strongholdRightBody = makeShBody(6.4);
  }

  private buildStrongholdLobby(textures: ProceduralTextureSet): void {
    const floorMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.floorTileColor, roughness: 0.7, metalness: 0.1 }),
    );
    const wallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: textures.wallPanelColor,
        bumpMap: textures.wallPanelBump,
        bumpScale: 0.02,
        roughness: 0.6,
        metalness: 0.3,
      }),
    );
    const darkMetal = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2a3137, roughness: 0.44, metalness: 0.76 }),
    );
    const deskTopMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x56626c, roughness: 0.32, metalness: 0.65 }),
    );
    const screenGlow = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x45e8a6, emissive: 0x1fc482, emissiveIntensity: 1.4 }),
    );
    const amberGlow = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf0ad4e, emissive: 0xd9841e, emissiveIntensity: 1.3 }),
    );

    // STRONGHOLD LOBBY (X: -6.4 to +10.4, Z: +4.4 to +30.0, Height: 5.0)
    this.addBox(2.0, -0.25, 17.2, 16.8, 0.5, 25.6, floorMat, true);
    this.addBox(2.0, 5.25, 17.2, 16.8, 0.5, 25.6, darkMetal);
    this.addBox(-6.6, 2.5, 17.2, 0.6, 5.0, 25.6, wallMat); // Left Lobby wall
    this.addBox(10.6, 2.5, 17.2, 0.6, 5.0, 25.6, wallMat); // Right Lobby wall
    // Close Z = +30 wall to the left of the platform (X: -6.4..+2.0)
    this.addBox(-2.2, 2.5, 30.0, 8.8, 5.0, 0.8, wallMat);
    // Close Z = +4.4 wall extension on right side (X: +6.0..+10.4) and upper transom above Airlock (Y: 4.2..5.0)
    this.addBox(8.4, 2.5, 4.4, 4.8, 5.0, 0.8, wallMat);
    this.addBox(-0.2, 4.6, 4.4, 13.6, 0.8, 0.8, wallMat, true);

    // Lobby Ceiling Beams
    for (const bz of [9, 15, 21, 26]) {
      this.addBox(2.0, 4.88, bz, 16.4, 0.24, 0.35, darkMetal, true);
    }

    // Lobby Lights
    const lobbyLight1 = new THREE.PointLight(0xd9f0ff, 34, 30, 1.3);
    lobbyLight1.position.set(2.0, 4.4, 20.5);
    const lobbyLight2 = new THREE.PointLight(0xffe1b5, 28, 28, 1.35);
    lobbyLight2.position.set(0.0, 4.4, 10.5);
    this.scene.add(lobbyLight1, lobbyLight2);
    this.lights.push(lobbyLight1, lobbyLight2);

    // Central Security & Save Console Desk (X = 0, Z = +17.5)
    this.addBox(0, 0.52, 17.5, 3.2, 1.04, 1.1, darkMetal);
    this.addBox(0, 1.08, 17.5, 3.35, 0.08, 1.22, deskTopMat, true);

    // Save Terminal Unit on top of desk
    this.addBox(0, 1.42, 17.45, 0.78, 0.58, 0.42, darkMetal, true);
    const [sCanvas, sCtx, sTex] = this.makeScreenTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = '#091a12';
      ctx.fillRect(0, 0, w, h);
    });
    this.saveCanvas = sCanvas;
    this.saveCtx = sCtx;
    this.saveTexture = sTex;
    this.updateSaveConsoleScreen(false);

    const saveScreen = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(0.66, 0.44)),
      this.trackMat(new THREE.MeshBasicMaterial({ map: this.saveTexture })),
    );
    saveScreen.position.set(0, 1.44, 17.68);
    const saveBeacon = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.16, 0.08, 0.16)),
      screenGlow,
    );
    saveBeacon.position.set(0, 1.76, 17.45);
    this.group.add(saveScreen, saveBeacon);

    // Left Scientist Workstation (X = -4.3, Z = +17.5)
    this.addBox(-4.3, 0.5, 17.5, 2.2, 1.0, 1.1, darkMetal);
    this.addBox(-4.8, 1.32, 17.3, 0.65, 0.48, 0.14, screenGlow, true);
    this.addBox(-3.9, 1.32, 17.3, 0.65, 0.48, 0.14, amberGlow, true);

    // Right Scientist & Security Telemetry Station (X = +7.5, Z = +15.5)
    this.addBox(7.5, 0.5, 15.5, 2.2, 1.0, 1.2, darkMetal);
    this.addBox(7.1, 1.32, 15.3, 0.7, 0.5, 0.14, screenGlow, true);
    this.addBox(8.0, 1.32, 15.3, 0.6, 0.45, 0.14, amberGlow, true);
  }

  private createNpc(role: 'police' | 'scientist', x: number, z: number, yaw: number): NpcActor {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;

    const skinMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xd9b391, roughness: 0.7 }));
    const darkPants = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x1c232c, roughness: 0.75 }));
    const torsoMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: role === 'police' ? 0x223b5c : 0xe4e8eb,
        roughness: role === 'police' ? 0.55 : 0.65,
      }),
    );
    const accentMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: role === 'police' ? 0xe6a23c : 0x3982a8,
        roughness: 0.35,
        metalness: 0.65,
      }),
    );

    const legGeo = this.trackGeo(new THREE.BoxGeometry(0.19, 0.82, 0.2));
    const leftLeg = new THREE.Mesh(legGeo, darkPants);
    leftLeg.position.set(-0.14, 0.41, 0);
    const rightLeg = new THREE.Mesh(legGeo, darkPants);
    rightLeg.position.set(0.14, 0.41, 0);

    const torso = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.52, 0.74, 0.32)), torsoMat);
    torso.position.set(0, 1.18, 0);

    const head = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.3, 0.32, 0.3)), skinMat);
    head.position.set(0, 1.72, 0);

    const armGeo = this.trackGeo(new THREE.BoxGeometry(0.15, 0.62, 0.16));
    const leftArm = new THREE.Mesh(armGeo, torsoMat);
    leftArm.position.set(-0.36, 1.18, 0);
    const rightArm = new THREE.Mesh(armGeo, torsoMat);
    rightArm.position.set(0.36, 1.18, 0);

    if (role === 'police') {
      const cap = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.34, 0.12, 0.36)), torsoMat);
      cap.position.set(0, 1.9, 0.03);
      const badge = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.09, 0.1, 0.04)), accentMat);
      badge.position.set(0.14, 1.32, 0.17);
      g.add(cap, badge);
    } else {
      const coatHem = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.54, 0.32, 0.34)), torsoMat);
      coatHem.position.set(0, 0.72, 0);
      const goggles = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.28, 0.08, 0.06)), accentMat);
      goggles.position.set(0, 1.75, 0.16);
      g.add(coatHem, goggles);
    }

    g.add(leftLeg, rightLeg, torso, head, leftArm, rightArm);
    this.group.add(g);

    return { group: g, leftArm, rightArm, leftLeg, rightLeg, head, role, phase: Math.random() * 6 };
  }

  private buildCharacters(): void {
    // Escort Officer waiting visibly right outside the Train Door
    this.escortOfficer = this.createNpc('police', 3.1, 47.4, -Math.PI * 0.42);

    // Lobby Scientists working at stations
    this.lobbyNpcs.push(this.createNpc('scientist', -4.3, 18.6, Math.PI));
    this.lobbyNpcs.push(this.createNpc('scientist', 7.4, 16.6, Math.PI));

    // Lobby Police Officers on guard
    this.lobbyNpcs.push(this.createNpc('police', 2.4, 22.8, Math.PI * 0.12));
    this.lobbyNpcs.push(this.createNpc('police', -3.1, 9.2, -Math.PI * 0.25));
  }

  private updateEtaDisplay(label: string): void {
    if (label === this.lastEtaLabel) return;
    this.lastEtaLabel = label;
    const ctx = this.etaCtx;
    const w = this.etaCanvas.width;
    const h = this.etaCanvas.height;
    ctx.fillStyle = '#0c1116';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e6a23c';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#a0aab2';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT STOP: SECTOR 7 STRONGHOLD', w / 2, 42);
    ctx.fillStyle = label.includes('ARRIVED') ? '#3ee08f' : '#ffb84d';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(label, w / 2, 102);
    this.etaTexture.needsUpdate = true;
  }

  public updateSaveConsoleScreen(saved: boolean): void {
    const ctx = this.saveCtx;
    const w = this.saveCanvas.width;
    const h = this.saveCanvas.height;
    ctx.fillStyle = saved ? '#0b2216' : '#0b151e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = saved ? '#3ee08f' : '#e6a23c';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = saved ? '#3ee08f' : '#e6a23c';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(saved ? 'SAVE CONFIRMED' : 'SAVE CONSOLE', w / 2, 46);
    ctx.fillStyle = '#e8e2d5';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('BELLVEES, C.J.G.', w / 2, 86);
    ctx.fillStyle = '#9ec4d8';
    ctx.font = '15px monospace';
    ctx.fillText(saved ? 'LOBBY LOGGED' : 'PRESS [E] TO SAVE', w / 2, 124);
    this.saveTexture.needsUpdate = true;
  }

  /** Queues a dialogue line. It plays after every earlier line has finished. */
  private queueLine(
    speaker: string | null,
    text: string,
    chime: boolean,
    minDuration?: number,
    onDone?: () => void,
  ): void {
    this.lineQueue.push({
      speaker,
      text,
      chime,
      minDuration: Math.max(minDuration ?? 0, estimateLineDuration(text)),
      onDone,
    });
  }

  private clearDialogue(): void {
    this.lineQueue = [];
    this.activeLine = null;
    this.activeLineTimer = 0;
    this.lineGapTimer = 0;
  }

  /** Advances the dialogue queue. A line ends only when its hold time has elapsed AND the voice is silent. */
  private updateDialogue(dt: number, callbacks: StoryCallbacks): void {
    if (this.activeLine) {
      this.activeLineTimer += dt;
      const line = this.activeLine;
      const holdDone = this.activeLineTimer >= line.minDuration;
      // Safety cap in case the browser never reports the end of speech
      const capHit = this.activeLineTimer >= line.minDuration * 2.5 + 6;
      if ((holdDone && !callbacks.isVoiceBusy()) || capHit) {
        this.activeLine = null;
        this.lineGapTimer = LINE_GAP_SECONDS;
        line.onDone?.();
      }
      return;
    }

    if (this.lineGapTimer > 0) {
      this.lineGapTimer -= dt;
      return;
    }

    const next = this.lineQueue.shift();
    if (next) {
      this.activeLine = next;
      this.activeLineTimer = 0;
      this.intercomSpeaker = next.speaker;
      this.intercomLine = next.text;
      callbacks.onIntercomCue(next.speaker, next.text, next.chime);
    }
  }

  /** Progress through the current PA cue, 0..1 (by hold time). */
  private activeCueProgress(): number {
    if (!this.activeLine) return 1;
    return Math.min(1, this.activeLineTimer / this.activeLine.minDuration);
  }

  public skipTransit(callbacks: StoryCallbacks): void {
    if (this.stage !== 'train_transit') return;
    this.clearDialogue();
    this.etaSeconds = 0;
    this.trainSpeed = 0;
    this.arriveAtStation(callbacks);
    // Start Vance's line immediately (it interrupts the skipped PA voice)
    this.updateDialogue(0, callbacks);
  }

  private arriveAtStation(callbacks: StoryCallbacks): void {
    if (this.stage !== 'train_transit') return;
    this.stage = 'train_arrived';
    this.etaSeconds = 0;
    this.trainSpeed = 0;
    this.tunnelShutter.visible = false;
    this.updateEtaDisplay('ARRIVED // SEC-07');
    callbacks.onDoorOpenSound();
    this.queueLine(
      'OFFICER VANCE // PLATFORM BRAVO',
      'Inspector Bellvees? Door is open. Follow me to the Stronghold Lobby—stay sharp.',
      true,
    );
    callbacks.onBanner('TRAIN ARRIVED — FOLLOW OFFICER VANCE TO STRONGHOLD DOOR', 4.5);
  }

  public jumpToLobbySavedState(): void {
    this.stage = 'lobby_entered';
    this.etaSeconds = 0;
    this.trainSpeed = 0;
    this.tunnelShutter.visible = false;
    this.trainDoorOpen = 1;
    this.strongholdOpen = 1;
    this.lobbyEnteredAnnounced = true;
    this.escortWaypointIndex = this.escortWaypoints.length;
    const endWp = this.escortWaypoints[this.escortWaypoints.length - 1];
    this.escortOfficer.group.position.copy(endWp);
    this.escortOfficer.group.rotation.y = -Math.PI * 0.5;
    this.updateEtaDisplay('ARRIVED // SEC-07');
    this.updateSaveConsoleScreen(true);
    this.clearDialogue();
    this.intercomSpeaker = null;
    this.intercomLine = null;
  }

  public update(dt: number, playerPos: THREE.Vector3, callbacks: StoryCallbacks): void {
    // 1. Train Transit & PA Briefing Cues
    if (this.stage === 'train_transit') {
      if (!this.transitStarted) {
        this.transitStarted = true;
        const lastIndex = PA_BRIEFING_CUES.length - 1;
        PA_BRIEFING_CUES.forEach((cue, i) => {
          this.queueLine(cue.speaker, cue.text, true, cue.duration, () => {
            this.currentCueIndex = i + 1;
            // The train arrives only after the final PA cue has finished speaking
            if (i === lastIndex) this.arriveAtStation(callbacks);
          });
        });
        this.currentCueIndex = 0;
      }
    }

    this.updateDialogue(dt, callbacks);

    if (this.stage === 'train_transit') {
      // ETA counts down 05:00 -> 04:42 during the briefing, then brakes to 00:00 during the final cue
      const lastIndex = PA_BRIEFING_CUES.length - 1;
      const cueIdx = Math.max(0, this.currentCueIndex);
      if (cueIdx < lastIndex) {
        const progress = (cueIdx + this.activeCueProgress()) / lastIndex;
        this.etaSeconds = 300 - Math.min(1, progress) * 18;
        this.trainSpeed = 28;
      } else {
        const brakeT = this.activeCueProgress();
        this.etaSeconds = Math.max(0, 282 * (1 - brakeT));
        this.trainSpeed = Math.max(0, 28 * (1 - brakeT));
      }
      this.updateEtaDisplay(`ETA ${formatEtaCountdown(this.etaSeconds)}`);

      // Scroll tunnel rings past windows
      this.tunnelGroup.position.z += this.trainSpeed * dt;
      if (this.tunnelGroup.position.z > 52) {
        this.tunnelGroup.position.z -= 13.5;
      }
      // Keep tunnel shutter pinned next to carriage right windows while moving
      this.tunnelShutter.position.z = 51 - (this.tunnelGroup.position.z - 44);
    }

    // 2. Train Boarding Door Animation
    const targetTrainDoor = this.stage !== 'train_transit' ? 1 : 0;
    this.trainDoorOpen = THREE.MathUtils.damp(this.trainDoorOpen, targetTrainDoor, 5.5, dt);
    const tdOff = this.trainDoorOpen * 1.25;
    this.trainDoorLeft.position.z = 47.3 - tdOff;
    this.trainDoorRight.position.z = 48.7 + tdOff;
    this.trainDoorLeftBody.position.z = 47.3 - tdOff;
    this.trainDoorRightBody.position.z = 48.7 + tdOff;

    // 3. Police Officer Escort Behavior
    if (this.stage === 'train_arrived' && playerPos.x > 1.3) {
      this.stage = 'escort_walking';
      this.escortWaypointIndex = 1;
      callbacks.onBanner('FOLLOW OFFICER VANCE TO THE STRONGHOLD DOOR', 3.5);
    }

    if (this.stage === 'escort_walking') {
      const targetWp = this.escortWaypoints[this.escortWaypointIndex];
      if (targetWp) {
        const pos = this.escortOfficer.group.position;
        const distToPlayer = pos.distanceTo(playerPos);
        const dx = targetWp.x - pos.x;
        const dz = targetWp.z - pos.z;
        const distToWp = Math.hypot(dx, dz);

        if (distToWp < 0.25) {
          this.escortWaypointIndex++;
          if (this.escortWaypointIndex >= this.escortWaypoints.length) {
            this.queueLine(
              'OFFICER VANCE // STRONGHOLD GATE',
              'Stronghold Lobby is just ahead. Scientists are standing by—log your arrival at the Security Console.',
              false,
            );
          }
        } else if (distToPlayer < 8.5 || this.escortWaypointIndex === this.escortWaypoints.length - 1) {
          const speed = 3.1;
          pos.x += (dx / distToWp) * speed * dt;
          pos.z += (dz / distToWp) * speed * dt;
          this.escortOfficer.group.rotation.y = Math.atan2(dx, dz);
          this.escortOfficer.phase += dt * 9;
          this.escortOfficer.leftLeg.rotation.x = Math.sin(this.escortOfficer.phase) * 0.5;
          this.escortOfficer.rightLeg.rotation.x = -Math.sin(this.escortOfficer.phase) * 0.5;
          this.escortOfficer.leftArm.rotation.x = -Math.sin(this.escortOfficer.phase) * 0.35;
          this.escortOfficer.rightArm.rotation.x = Math.sin(this.escortOfficer.phase) * 0.35;
        } else {
          // Wait and look back toward player
          this.escortOfficer.leftLeg.rotation.x = 0;
          this.escortOfficer.rightLeg.rotation.x = 0;
          this.escortOfficer.group.rotation.y = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z);
        }
      } else {
        this.escortOfficer.leftLeg.rotation.x = 0;
        this.escortOfficer.rightLeg.rotation.x = 0;
        this.escortOfficer.leftArm.rotation.x = 0;
        this.escortOfficer.rightArm.rotation.x = 0;
        this.escortOfficer.group.rotation.y = Math.atan2(
          playerPos.x - this.escortOfficer.group.position.x,
          playerPos.z - this.escortOfficer.group.position.z,
        );
      }
    }

    // 4. Stronghold Door Opening (Z = 30, X = 5.5)
    const nearStronghold =
      Math.abs(playerPos.z - 30.0) < 6.0 && Math.abs(playerPos.x - 5.5) < 4.5;
    if (nearStronghold && !this.strongholdWasOpen) {
      callbacks.onDoorOpenSound();
    }
    this.strongholdWasOpen = nearStronghold;
    this.strongholdOpen = THREE.MathUtils.damp(this.strongholdOpen, nearStronghold ? 1 : 0, 6.5, dt);
    const shOff = this.strongholdOpen * 1.65;
    this.strongholdLeftMesh.position.x = 4.6 - shOff;
    this.strongholdRightMesh.position.x = 6.4 + shOff;
    this.strongholdLeftBody.position.x = 4.6 - shOff;
    this.strongholdRightBody.position.x = 6.4 + shOff;

    // 5. Lobby Entry Detection
    if (!this.lobbyEnteredAnnounced && playerPos.z < 29.4 && playerPos.z > 4.4) {
      this.lobbyEnteredAnnounced = true;
      this.stage = 'lobby_entered';
      this.queueLine(
        'SECTOR 7 LOBBY // DISPATCH',
        'You are now in the Stronghold Lobby. Approach the central Security Console and press [E] to save your mission progress.',
        true,
      );
      callbacks.onBanner('YOU ARE NOW IN THE LOBBY — SAVE AT THE SECURITY CONSOLE [E]', 5.0);
    }

    if (playerPos.z <= 4.4 && this.stage !== 'train_transit' && this.stage !== 'facility_breach') {
      this.stage = 'facility_breach';
      // Let any line in progress finish, then hide the intercom panel
      this.queueLine(null, '', false, 0, () => {
        this.intercomSpeaker = null;
        this.intercomLine = null;
        callbacks.onIntercomCue(null, null, false);
      });
    }

    // 6. Animate Lobby Scientists & Police Officers at their stations
    for (const npc of this.lobbyNpcs) {
      npc.phase += dt * 2.2;
      if (npc.role === 'scientist') {
        npc.leftArm.rotation.x = -0.75 + Math.sin(npc.phase * 3.1) * 0.14;
        npc.rightArm.rotation.x = -0.75 + Math.cos(npc.phase * 3.4) * 0.14;
        npc.head.rotation.y = Math.sin(npc.phase * 0.6) * 0.18;
      } else {
        npc.head.rotation.y = Math.sin(npc.phase * 0.45) * 0.25;
      }
    }
  }

  public dispose(): void {
    for (const l of this.lights) this.scene.remove(l);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.texturesToDispose) t.dispose();
    this.scene.remove(this.group);
  }
}
