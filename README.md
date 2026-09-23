# RoadHaul

Mobile-first logistics and truck simulation game: take a contract, load the cargo, drive, deliver, earn credits, upgrade your truck and grow your company.

**Status:** Phase 1 (driving prototype). You can drive the first truck around a 2.4 km test track, on a phone or a desktop. Cargo and missions come next (see [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md)).

**Controls:**
- **Phone:** drag the steering wheel (bottom left) with one thumb and press the pedals (bottom right) with the other. Hold the brake while stopped to reverse. The round button switches between the chase and cabin cameras.
- **Keyboard:** arrow keys or WASD, Space to brake, C to switch camera.

Built with TypeScript, [three.js](https://threejs.org) and Vite. It runs in the browser and targets Android first ([why not Unity](docs/adr/0001-web-stack-typescript-threejs.md)).

## Play

**https://keremcan534.github.io/roadhaul/** always runs the latest `main`. It works on phones and desktops, and `?debug` at the end of the URL shows FPS.
Every push to `main` redeploys it through [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). This needs one-time repository settings: public visibility (or a paid plan) and *Settings → Pages → Source: GitHub Actions*.

## Quick start

Requires Node.js 22 (22.12 or later), 24, or 26+. These are the versions Vite and Vitest support.

```sh
npm ci
npm run dev
```

Open the printed URL. To try it on a phone on the same Wi-Fi, run `npm run dev -- --host` and open the "Network" URL on the phone. Append `?debug` to the URL to see FPS, draw calls, triangles and the truck's position and heading.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | Type-checks app, pure layers, tests and tooling |
| `npm test` | Unit and architecture tests (Vitest) |
| `npm run build` | Production build into `dist/` |
| `npm run test:e2e` | Browser smoke tests on an emulated Android phone (Playwright; run `build` first) |
| `npm run check` | All of the above |

## Documentation

- [Game design & technical spec](docs/ROADHAUL_Game_Design_Technical_Spec.md) (Turkish): what we are building
- [ARCHITECTURE.md](ARCHITECTURE.md): how the code is organised and why
- [SYSTEM_MAP.md](SYSTEM_MAP.md): every system, its owner and status
- [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md): build order and progress
- [CLAUDE.md](CLAUDE.md): rules for contributors and Claude Code
