# RoadHaul Development Roadmap

The build order follows spec §81 ("this order must not be broken"). Each step is a small, reviewable pull request that meets the Definition of Done below. Details for every system are in `SYSTEM_MAP.md`.

Status: ✅ done · 🔄 in progress · ⬜ not started

## First success criterion (spec §80)

> The player takes a contract → gets in the truck → picks up the cargo → drives → delivers → earns money → upgrades the truck → takes the next contract.

If this loop is fun and bug-free, the project continues. If it is not, adding cities will not fix it.

## Steps

| # | Step | Phase | Status | Result |
|---|---|---|---|---|
| 01 | Project foundation | 0 | ✅ | Vite + TypeScript + three.js; tsconfig projects; Vitest; Playwright; CI |
| 02 | Git + CLAUDE.md | 0 | ✅ | Project rules, spec in `docs/`, ADR 0001 (web stack) |
| 03 | Bootstrap architecture | 0 | ✅ | Service container, event bus, logging, config, game loop, GameBootstrapper, GameStateService, placeholder definitions, SaveGameData v1, layering test |
| 04 | Vehicle data | 1 | ⬜ **next** | Physics tuning in VehicleDefinition; VehicleRuntimeState |
| 05 | Vehicle controller | 1 | ⬜ | Rapier raycast vehicle: accelerate, brake, steer, reverse, speed limit |
| 06 | Camera | 1 | ⬜ | Third-person + cabin |
| 07 | Mobile controls | 1 | ⬜ | Steering wheel, gas, brake (touch) + keyboard |
| 08 | Small test road | 1 | ⬜ | Drivable road built from data |
| 09 | Cargo data | 2 | ⬜ | 6–8 cargo types |
| 10 | Pickup zone | 2 | ⬜ | "Stop to load" |
| 11 | Delivery zone | 2 | ⬜ | "Stop to unload" |
| 12 | Mission state machine | 2 | ⬜ | Available → … → Completed / Failed |
| 13 | HUD | 2 | ⬜ | Speed, fuel, damage, cargo, timer |
| 14 | Economy | 3 | ⬜ | Credits, rewards, costs (EconomyService) |
| 15 | Fuel | 3 | ⬜ | Consumption + refuelling |
| 16 | Damage | 3 | ⬜ | Damage bands, effects, repair |
| 17 | Reward screen | 3 | ⬜ | Delivery result, XP, reputation |
| 18 | Save/load | 3 | ⬜ | SaveService: versioned, atomic, backup, migrations |
| 19 | Garage | 5 | ⬜ | Owned trucks, active truck |
| 20 | Upgrade | 3/5 | ⬜ | Upgrade definitions, costs, stat modifiers |
| 21 | 3-city prototype | 4 | ⬜ | City A (starter), B (industrial), C (agricultural), rest area |
| 22 | Traffic | 4 | ⬜ | Waypoint NPC traffic |
| 23 | Navigation | 4 | ⬜ | Route, GPS arrow, ETA |
| 24 | Weather | 4 | ⬜ | Clear, cloudy, rain, night |
| 25 | Events | 6 | ⬜ | Data-driven events (Express Week, Safe Driver, Heavy Cargo) |
| 26 | Tutorial | 7 | ⬜ | First 10 minutes, taught by playing |
| 27 | Optimization | 7 | ⬜ | Hit the device budgets (ARCHITECTURE.md §10) |
| 28 | Android build | 8 | ⬜ | Capacitor app built in CI |
| 29 | Device testing | 8 | ⬜ | Real low/mid Android phones |
| 30 | MVP release candidate | 8 | ⬜ | Save migration check, crash handling, store assets |

### Phase 0 checklist (spec §45)

- [x] Project (web instead of Unity; see ADR 0001)
- [x] Git and conventional commits
- [x] Folder structure (layer folders; see ARCHITECTURE.md §12)
- [x] Scene (placeholder world, WebGL render host)
- [ ] Input: moved to steps 05/07, where the vehicle input abstraction is designed (spec §49)
- [x] Bootstrap (`GameBootstrapper`, `src/main.ts`)
- [x] Service container
- [x] Logging
- [x] Config (`GameConfig` + URL debug flags)

## Next step: 04 Vehicle data

Suggested request (adapted from spec §49):

> Implement roadmap step 04 only. Extend `VehicleDefinition` with the physics tuning the driving prototype needs (mass, centre of mass, engine torque, gear ratios, brake force, maximum steering angle, wheel radius and positions, suspension) with validation and unit tests. Add `VehicleRuntimeState` in `src/domain/vehicles` (fuel, damage, odometer), created from a definition. Do not implement physics, missions, economy or UI. A second truck model must be addable as data only.

Step 05 then adds Rapier (`src/simulation`), `VehicleController`, a `VehicleView` and keyboard input for testing on a desktop browser.

## Infrastructure track

These are not gameplay features, so they sit outside the numbered order. They make testing on real phones possible.

| Item | Status | Notes |
|---|---|---|
| CI: typecheck, unit tests, build, e2e | ✅ | `.github/workflows/ci.yml` on every pull request |
| Phone preview link | ⬜ | Wanted before steps 05–07, so driving can be felt on a real phone. The repository is private, so GitHub Pages needs a paid plan or a public repository; Cloudflare Pages / Netlify also work. The owner decides. |
| Android APK from CI | ⬜ | Spec step 28. Pulling it forward for device testing is optional; it is the owner's call. |

## MVP scope (spec §43)

- **Core:** driving, camera, basic traffic, pickup, delivery, missions, money, fuel, damage, save/load, UI.
- **Content:** 3 cities, 3 trucks, 6 cargo types, 20 missions, 3 events, 5 upgrade types, 1 weather system.

**Not in the MVP (spec §44):** multiplayer, 100 cities, real brands or licensed vehicles, advanced open-world streaming, employee management, online economy, clans, PvP, live seasons, complex modding, real radio streaming.

## Definition of Done (spec §70)

- [ ] Code implemented
- [ ] `npm run typecheck` passes
- [ ] No console errors (`npm run test:e2e` checks boot)
- [ ] Unit tests if applicable
- [ ] End-to-end test if applicable
- [ ] Tested on a phone (from step 07 on)
- [ ] Save compatible (version bump + migration when the schema changed)
- [ ] UI connected
- [ ] No unrelated changes
- [ ] `SYSTEM_MAP.md` and this roadmap updated
