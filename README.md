# Sector 7: Containment Breach

A retro-inspired 3D first-person shooter that runs entirely in the browser, built with React, Three.js and cannon-es.

You arrive by train at a locked-down industrial research facility. After a scripted arrival and a walk to the lobby, a containment breach turns the visit into a fight for survival.

## Features

- **3D first-person gameplay** — Three.js rendering with cannon-es physics and procedurally generated textures
- **Story mode** — scripted train arrival, escort and lobby sequence with timed intercom dialogue and animated NPCs
- **Combat** — wrench and pistol, enemy AI (idle → alert → chase → attack), explosions, and ammo / health / armor pickups
- **HUD and menus** — React + Tailwind overlay with pause menu and settings (mouse sensitivity, volume)
- **Save system** — save progress at the in-game console (stored in the browser)
- **Audio** — custom sound engine

## Tech stack

React 19 · TypeScript · Three.js · cannon-es · Vite · Tailwind CSS

## Run locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Type-check with `tsc` |

## Project structure

```
src/
  App.tsx              React root, wires the game engine to the UI
  components/          HUD and menu overlays
  game/
    engine.ts          Main game loop, rendering, particles
    level.ts           Facility level construction
    story.ts           Story stages, train transit, intercom dialogue
    player.ts          First-person controller
    enemies.ts         Enemy AI
    weapons.ts         Wrench and pistol
    physics.ts         cannon-es world setup
    textures.ts        Procedural textures
    audio.ts           Sound engine
    rules.ts           Game rules, damage, save serialization
```
