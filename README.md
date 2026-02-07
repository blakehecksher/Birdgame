# Hawk & Pigeon

A web-based 3D multiplayer chase game built with Three.js and WebRTC. Two players compete in 1v1 matches: one as a pigeon trying to eat and survive, one as a hawk trying to hunt them down.

## Current Status

Phase 1 MVP is complete and networking hardening for sharing with friends is implemented.
For the latest implementation details and handoff notes, see `PROJECT_STATUS.md`.

## Prerequisites

You need Node.js (version 18+ recommended) to run this project.

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Open your browser:
   - Navigate to `http://localhost:3000`
   - Click anywhere on the canvas to start

## Controls

- `W/S` Move forward/backward
- `A/D` Strafe left/right
- `Space` Ascend
- `Shift` Descend
- `Mouse` Look around (click canvas to lock pointer)

## Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Deployment

GitHub Pages deployment is configured.

```bash
npm run deploy
```

Full publish steps (including first-time repo setup) are in `DEPLOYMENT.md`.

## Game Specification

For full game design and mechanics, see `Birdgame Spec.md`.

## License

Private project