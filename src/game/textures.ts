import * as THREE from 'three';

export interface ProceduralTextureSet {
  concreteColor: THREE.CanvasTexture;
  concreteBump: THREE.CanvasTexture;
  floorTileColor: THREE.CanvasTexture;
  wallPanelColor: THREE.CanvasTexture;
  wallPanelBump: THREE.CanvasTexture;
  hazardColor: THREE.CanvasTexture;
  crateColor: THREE.CanvasTexture;
  grateColor: THREE.CanvasTexture;
  barrelColor: THREE.CanvasTexture;
  bulletDecal: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function configureTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  anisotropy: number,
  repeat = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (isColor) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.anisotropy = Math.min(8, Math.max(1, anisotropy));
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const rand = seededRand(199807);
  const created: THREE.CanvasTexture[] = [];

  // 1. Concrete Color + Bump
  const [concC, concCtx] = makeCanvas(256, 256);
  const [concBC, concBCtx] = makeCanvas(256, 256);
  concCtx.fillStyle = '#53585c';
  concCtx.fillRect(0, 0, 256, 256);
  concBCtx.fillStyle = '#808080';
  concBCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 3600; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = 1 + rand() * 3.5;
    const shade = Math.floor(66 + rand() * 34);
    concCtx.fillStyle = `rgba(${shade}, ${shade + 2}, ${shade + 4}, 0.28)`;
    concCtx.fillRect(x, y, r, r);

    const bShade = Math.floor(95 + rand() * 70);
    concBCtx.fillStyle = `rgba(${bShade}, ${bShade}, ${bShade}, 0.35)`;
    concBCtx.fillRect(x, y, r, r);
  }
  // Expansion seams
  concCtx.strokeStyle = 'rgba(22, 24, 27, 0.55)';
  concCtx.lineWidth = 2;
  concCtx.strokeRect(1, 1, 254, 254);
  concCtx.beginPath();
  concCtx.moveTo(0, 128);
  concCtx.lineTo(256, 128);
  concCtx.moveTo(128, 0);
  concCtx.lineTo(128, 256);
  concCtx.stroke();

  concBCtx.strokeStyle = '#303030';
  concBCtx.lineWidth = 3;
  concBCtx.strokeRect(1, 1, 254, 254);

  const concreteColor = configureTexture(concC, true, maxAnisotropy);
  const concreteBump = configureTexture(concBC, false, maxAnisotropy);
  created.push(concreteColor, concreteBump);

  // 2. Locker / Lab Tiled Concrete Floor
  const [tileC, tileCtx] = makeCanvas(256, 256);
  tileCtx.fillStyle = '#474e53';
  tileCtx.fillRect(0, 0, 256, 256);
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const v = 64 + Math.floor((rand() - 0.5) * 14);
      tileCtx.fillStyle = `rgb(${v}, ${v + 5}, ${v + 8})`;
      tileCtx.fillRect(gx * 64 + 2, gy * 64 + 2, 60, 60);
    }
  }
  for (let i = 0; i < 1200; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const s = Math.floor(50 + rand() * 40);
    tileCtx.fillStyle = `rgba(${s}, ${s}, ${s}, 0.22)`;
    tileCtx.fillRect(x, y, 2, 2);
  }
  tileCtx.strokeStyle = '#25292d';
  tileCtx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    tileCtx.beginPath();
    tileCtx.moveTo(i, 0);
    tileCtx.lineTo(i, 256);
    tileCtx.moveTo(0, i);
    tileCtx.lineTo(256, i);
    tileCtx.stroke();
  }
  const floorTileColor = configureTexture(tileC, true, maxAnisotropy);
  created.push(floorTileColor);

  // 3. Industrial Metal Wall Panels + Bump
  const [wallC, wallCtx] = makeCanvas(256, 256);
  const [wallBC, wallBCtx] = makeCanvas(256, 256);
  wallCtx.fillStyle = '#4e585f';
  wallCtx.fillRect(0, 0, 256, 256);
  wallBCtx.fillStyle = '#858585';
  wallBCtx.fillRect(0, 0, 256, 256);

  // Lower dark wainscoting band
  wallCtx.fillStyle = '#31383d';
  wallCtx.fillRect(0, 176, 256, 80);
  // Subtle ochre industrial stripe
  wallCtx.fillStyle = '#9c7129';
  wallCtx.fillRect(0, 168, 256, 8);

  // Panel seams & rivets
  wallCtx.strokeStyle = '#23282c';
  wallCtx.lineWidth = 3;
  wallCtx.strokeRect(2, 2, 124, 252);
  wallCtx.strokeRect(130, 2, 124, 252);

  wallBCtx.strokeStyle = '#2b2b2b';
  wallBCtx.lineWidth = 4;
  wallBCtx.strokeRect(2, 2, 124, 252);
  wallBCtx.strokeRect(130, 2, 124, 252);

  // Rivet dots
  const rivetPositions = [
    [12, 12], [114, 12], [12, 158], [114, 158],
    [140, 12], [242, 12], [140, 158], [242, 158],
    [12, 190], [114, 190], [140, 190], [242, 190],
  ];
  for (const [rx, ry] of rivetPositions) {
    wallCtx.fillStyle = '#6c7780';
    wallCtx.beginPath();
    wallCtx.arc(rx, ry, 2.6, 0, Math.PI * 2);
    wallCtx.fill();

    wallBCtx.fillStyle = '#d4d4d4';
    wallBCtx.beginPath();
    wallBCtx.arc(rx, ry, 2.8, 0, Math.PI * 2);
    wallBCtx.fill();
  }

  // Brushed metal streaks & wear
  for (let i = 0; i < 650; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const w = 6 + rand() * 26;
    const alpha = 0.05 + rand() * 0.08;
    wallCtx.fillStyle = rand() > 0.5 ? `rgba(210,220,230,${alpha})` : `rgba(20,24,28,${alpha})`;
    wallCtx.fillRect(x, y, w, 1.5);
  }
  const wallPanelColor = configureTexture(wallC, true, maxAnisotropy);
  const wallPanelBump = configureTexture(wallBC, false, maxAnisotropy);
  created.push(wallPanelColor, wallPanelBump);

  // 4. Hazard Stripes
  const [hazC, hazCtx] = makeCanvas(256, 256);
  hazCtx.fillStyle = '#d89b1c';
  hazCtx.fillRect(0, 0, 256, 256);
  hazCtx.fillStyle = '#191b1d';
  for (let i = -256; i < 512; i += 48) {
    hazCtx.beginPath();
    hazCtx.moveTo(i, 0);
    hazCtx.lineTo(i + 24, 0);
    hazCtx.lineTo(i - 232, 256);
    hazCtx.lineTo(i - 256, 256);
    hazCtx.closePath();
    hazCtx.fill();
  }
  for (let i = 0; i < 900; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    hazCtx.fillStyle = `rgba(28, 28, 28, ${0.1 + rand() * 0.2})`;
    hazCtx.fillRect(x, y, 3, 2);
  }
  const hazardColor = configureTexture(hazC, true, maxAnisotropy);
  created.push(hazardColor);

  // 5. Cargo Crate Texture
  const [crateC, crateCtx] = makeCanvas(256, 256);
  crateCtx.fillStyle = '#7b5b38';
  crateCtx.fillRect(0, 0, 256, 256);
  // Plank lines
  for (let y = 0; y < 256; y += 32) {
    crateCtx.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.08})`;
    crateCtx.fillRect(0, y, 256, 30);
    crateCtx.strokeStyle = '#3b2817';
    crateCtx.lineWidth = 2;
    crateCtx.beginPath();
    crateCtx.moveTo(0, y);
    crateCtx.lineTo(256, y);
    crateCtx.stroke();
  }
  // Outer frame + diagonal brace
  crateCtx.strokeStyle = '#4c341e';
  crateCtx.lineWidth = 24;
  crateCtx.strokeRect(12, 12, 232, 232);
  crateCtx.beginPath();
  crateCtx.moveTo(16, 16);
  crateCtx.lineTo(240, 240);
  crateCtx.stroke();
  crateCtx.strokeStyle = '#2b1c10';
  crateCtx.lineWidth = 3;
  crateCtx.strokeRect(24, 24, 208, 208);
  // Stencil mark
  crateCtx.fillStyle = 'rgba(220, 198, 130, 0.72)';
  crateCtx.font = 'bold 20px monospace';
  crateCtx.fillText('S7-CARGO', 78, 134);
  const crateColor = configureTexture(crateC, true, maxAnisotropy);
  created.push(crateColor);

  // 6. Catwalk Metal Grate
  const [grateC, grateCtx] = makeCanvas(128, 128);
  grateCtx.fillStyle = '#373e44';
  grateCtx.fillRect(0, 0, 128, 128);
  grateCtx.fillStyle = '#1b1f23';
  for (let x = 6; x < 128; x += 16) {
    for (let y = 6; y < 128; y += 16) {
      grateCtx.fillRect(x, y, 10, 10);
    }
  }
  grateCtx.strokeStyle = '#5c666f';
  grateCtx.lineWidth = 2;
  grateCtx.strokeRect(1, 1, 126, 126);
  const grateColor = configureTexture(grateC, true, maxAnisotropy);
  created.push(grateColor);

  // 7. Explosive Barrel Texture
  const [barC, barCtx] = makeCanvas(256, 256);
  barCtx.fillStyle = '#a8221e';
  barCtx.fillRect(0, 0, 256, 256);
  // Subtle grime gradient
  for (let i = 0; i < 600; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    barCtx.fillStyle = `rgba(30, 8, 8, ${0.08 + rand() * 0.14})`;
    barCtx.fillRect(x, y, 4, 2);
  }
  // Warning yellow stripe
  barCtx.fillStyle = '#e0a922';
  barCtx.fillRect(0, 96, 256, 40);
  barCtx.fillStyle = '#1c1816';
  barCtx.font = 'bold 20px monospace';
  barCtx.fillText('FLAMMABLE', 64, 123);
  const barrelColor = configureTexture(barC, true, maxAnisotropy);
  created.push(barrelColor);

  // 8. Bullet Hole Decal
  const [decC, decCtx] = makeCanvas(64, 64);
  decCtx.clearRect(0, 0, 64, 64);
  const rad = decCtx.createRadialGradient(32, 32, 2, 32, 32, 28);
  rad.addColorStop(0, 'rgba(10, 10, 12, 0.96)');
  rad.addColorStop(0.28, 'rgba(28, 26, 24, 0.85)');
  rad.addColorStop(0.55, 'rgba(60, 56, 52, 0.35)');
  rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  decCtx.fillStyle = rad;
  decCtx.beginPath();
  decCtx.arc(32, 32, 28, 0, Math.PI * 2);
  decCtx.fill();
  const bulletDecal = configureTexture(decC, true, maxAnisotropy, false);
  created.push(bulletDecal);

  // 9. Soft Radial Contact Shadow
  const [shadC, shadCtx] = makeCanvas(64, 64);
  const sRad = shadCtx.createRadialGradient(32, 32, 4, 32, 32, 30);
  sRad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  sRad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
  sRad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shadCtx.fillStyle = sRad;
  shadCtx.fillRect(0, 0, 64, 64);
  const contactShadow = configureTexture(shadC, true, 1, false);
  created.push(contactShadow);

  return {
    concreteColor,
    concreteBump,
    floorTileColor,
    wallPanelColor,
    wallPanelBump,
    hazardColor,
    crateColor,
    grateColor,
    barrelColor,
    bulletDecal,
    contactShadow,
    dispose: () => {
      for (const tex of created) tex.dispose();
    },
  };
}
