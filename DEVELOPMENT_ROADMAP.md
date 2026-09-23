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
| 04 | Vehicle data | 1 | ✅ | Body, powertrain and handling data, validated; VehicleRuntimeState |
| 05 | Vehicle controller | 1 | ✅ | Deterministic truck model (ADR 0002): gearbox, governor, brakes, brake-to-reverse, understeer; keyboard |
| 06 | Camera | 1 | ✅ | Chase + cabin cameras |
| 07 | Mobile controls | 1 | ✅ | On-screen steering wheel, gas, brake, camera button, speed/gear readout |
| 08 | Small test road | 1 | ✅ | 2.4 km data-driven loop: asphalt/grass, seeded trees, depot buildings, collisions |
| 09 | Cargo data | 2 | ✅ | 8 cargo types; box, refrigerated and flatbed bodies; ten starter missions |
| 10 | Pickup zone | 2 | ✅ | A depot per city: paved yard and loading bay; "stop in the bay to load" |
| 11 | Delivery zone | 2 | ✅ | "Stop in the bay to unload"; itemised pay |
| 12 | Mission state machine | 2 | ✅ | MissionService: accepted → travellingToPickup → loaded → delivering → completed / failed; cargo damage |
| 13 | HUD | 2 | ✅ | Objective, direction and road distance, loading bar, delivery clock, cargo condition; main menu, job board, pause and result screens in Turkish and English |
| 14 | Economy | 3 | ⬜ **next** | Credits, rewards, costs (EconomyService) |
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
| 27 | Optimization | 7 | ⬜ | Hit the device budgets (ARCHITECTURE.md §11) |
| 28 | Android build | 8 | ⬜ | Capacitor app built in CI |
| 29 | Device testing | 8 | ⬜ | Real low/mid Android phones |
| 30 | MVP release candidate | 8 | ⬜ | Save migration check, crash handling, store assets |

### Phase 0 checklist (spec §45)

- [x] Project (web instead of Unity; see ADR 0001)
- [x] Git and conventional commits
- [x] Folder structure (layer folders; see ARCHITECTURE.md §13)
- [x] Scene (WebGL render host; the placeholder world became the test track in step 08)
- [x] Input: done in steps 05/07 with the vehicle input abstraction (spec §49)
- [x] Bootstrap (`GameBootstrapper`, `src/main.ts`)
- [x] Service container
- [x] Logging
- [x] Config (`GameConfig` + URL debug flags)

### Phase 1 notes

- The speed and gear readout on the touch controls is part of step 07. Step 13 built the rest of the HUD around it.
- Collisions already emit `VehicleCollided`: the mission loop turns them into cargo damage, and damage (step 16) will turn them into truck damage.
- Feel needs a real phone: see "Tested on a phone" in the Definition of Done.

### Phase 2 notes

- The loop runs on the 2.4 km test track, which now has a depot for each of the three cities. The 3-city map arrives in step 21.
- Rewards are shown but not yet kept: the wallet, XP and reputation come with steps 14 and 17, and saving with step 18.
- The HUD arrow follows the road with a simple stand-in for navigation (step 23): both ends snap to the nearest road.
- Every contract fits the starting box truck. Refrigerated and flatbed cargo wait for the trucks the garage will sell (step 19).
- Player-facing text lives in Turkish and English string tables, pulled forward from Phase 7 so the menus never hard-code text.
- `?debug` adds a T key that parks the truck in the bay the mission needs next, for testing (the e2e tests use it).

## Next step: 14 Economy

Suggested request:

> Implement roadmap step 14 only. Add EconomyService with a wallet (add, spend, affordability), pay the mission reward on delivery and show the balance at the HQ, with MoneyChanged events and tests (spec §13, §51). Fuel, repair and upgrade costs come with steps 15, 16 and 20; saving with step 18.

## Infrastructure track

These are not gameplay features, so they sit outside the numbered order. They make testing on real phones possible.

| Item | Status | Notes |
|---|---|---|
| CI: typecheck, unit tests, build, e2e | ✅ | `.github/workflows/ci.yml` on every pull request |
| Phone preview link | ✅ | GitHub Pages: `.github/workflows/deploy-pages.yml` publishes every push to `main` at https://keremcan534.github.io/roadhaul/ (needs the repository to be public and Pages source set to "GitHub Actions") |
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
