# RoadHaul

Mobile-first logistics and truck simulation game: take a contract, load the cargo, drive, deliver, earn credits, upgrade your truck and grow your company.

**Status:** the game of the MVP is in (roadmap steps 01–28), in the browser and as an Android app; testing on real phones comes next. Found your company and take contracts from the HQ's job board. Drive to the pickup depot and stop in the yellow bay to load, then deliver to the destination depot.

- **Pay:** credits with on-time and careful-driving bonuses, or a late penalty; the contract fails if the cargo breaks.
- **Progress:** XP, company levels that unlock better contracts, and reputation.
- **Garage:** three trucks: the light H1 box truck you start with, the H2 refrigerated truck and the H3 heavy flatbed. Twenty contracts, half of them for the bigger trucks.
- **Upgrades:** engine, brakes, tyres, suspension and fuel tank, three levels each, fitted to each truck.
- **Upkeep:** watch the fuel and the truck's damage; refuel and repair at a depot or the rest area, or call a fuel truck when stranded.
- **Saving:** the game saves itself; Continue picks up where you left off.

It plays in a region of three cities joined by a highway, a ring road and country roads, with a rest area to refuel and repair on the way, in Turkish or English. Cars, vans, lorries and buses share the roads: they keep right, take turns at junctions and overtake on the highway, and crashing into one damages the truck. A GPS line marks the route on the road, and the HUD shows the next turn and the arrival time. The weather changes as you drive: clear skies, clouds, rain that makes the road slippery, and nights when windows light up and the headlights show the way. Weekly events (Express Week, Safe Driver, Heavy Cargo) pay extra for the right deliveries and reward the company for meeting their goals. A new company is walked through its first contract and first upgrade by playing, with short hints it can skip. The graphics fit the phone: a preset picked for the device (Settings changes it), and a resolution that drops when frames run slow. The engine, brakes, horn, tyres, wind and rain are heard, all made in code (Settings turns the sound off). See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) for what comes next.

**Controls:**
- **Phone:** drag the steering wheel (bottom left) with one thumb and press the pedals (bottom right) with the other. Hold the brake while stopped to reverse. The round button top right switches between the chase and cabin cameras, the one next to it sounds the horn, and the one top left pauses.
- **Keyboard:** arrow keys or WASD, Space to brake, C to switch camera, H for the horn, Escape or P to pause.
- **Loading and unloading:** follow the blue line on the road and the turns on the HUD to the depot's light pillar, then stop with the whole truck inside the yellow bay for 3 seconds.

Built with TypeScript, [three.js](https://threejs.org) and Vite. It runs in the browser and targets Android first ([why not Unity](docs/adr/0001-web-stack-typescript-threejs.md)).

## Play

**https://keremcan534.github.io/roadhaul/** always runs the latest `main`. It works on phones and desktops. It speaks your browser's language (Turkish or English); `?lang=tr` or `?lang=en` at the end of the URL picks one. `?debug` shows FPS; its T key parks the truck in the bay the contract needs next, and Y at the rest area. `?traffic=0` empties the roads (any number up to 48 sets how many vehicles drive around). `?weather=rain` (or `clear`, `cloudy`, `night`) keeps that weather, `?date=2026-09-30` starts the events' calendar on another day, and `?quality=low` (or `medium`, `high`) plays on that graphics preset instead of the one picked in Settings or for the device.
Every push to `main` redeploys it through [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). This needs one-time repository settings: public visibility (or a paid plan) and *Settings → Pages → Source: GitHub Actions*.

## Android app

CI builds a debug APK for every pull request and every push to `main`. Open the run under **Actions → CI**, and download **roadhaul-debug-apk** under *Artifacts* (signed in to GitHub; it is kept 14 days). Unzip it and open `app-debug.apk` on the phone. Android asks once to allow installing apps from that source. A newer build installs over an older one and keeps the saved game.

To build it yourself you need Node.js as below, JDK 21 and the Android SDK (Android Studio brings both):

```sh
npm ci
npm run android                           # builds the game and copies it into android/
cd android && ./gradlew assembleDebug     # gradlew.bat on Windows
```

The APK lands in `android/app/build/outputs/apk/debug/`. `npx cap open android` opens the project in Android Studio. `node scripts/androidIcons.mjs` redraws the launcher icons.

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
| `npm run android` | Builds the game into the Android project (`android/`); see [Android app](#android-app) |

## Documentation

- [Game design & technical spec](docs/ROADHAUL_Game_Design_Technical_Spec.md) (Turkish): what we are building
- [ARCHITECTURE.md](ARCHITECTURE.md): how the code is organised and why
- [SYSTEM_MAP.md](SYSTEM_MAP.md): every system, its owner and status
- [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md): build order and progress
- [CLAUDE.md](CLAUDE.md): rules for contributors and Claude Code
