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
| 14 | Economy | 3 | ✅ | EconomyService: wallet, delivery pay, prices; HQ shows the credits |
| 15 | Fuel | 3 | ✅ | Spec §17 consumption, an empty tank stalls; refuel at the HQ or by fuel truck; emergency fuel |
| 16 | Damage | 3 | ✅ | Spec §18 bands; weaker engine and brakes; paid repairs |
| 17 | Reward screen | 3 | ✅ | XP, reputation, balance, level-up; five company levels unlock contracts |
| 18 | Save/load | 3 | ✅ | Save v2 with migration; atomic write, backup, corruption handling; continue or found a company; autosave |
| 19 | Garage | 5 | ✅ | H2 and H3 trucks; buy them at company levels 2 and 3; switch trucks in place; ten contracts that need them; save v3 |
| 20 | Upgrade | 3/5 | ✅ | Five upgrades of three levels (spec §16): engine, brakes, tyres, suspension, fuel tank; per truck |
| 21 | 3-city prototype | 4 | ✅ | The north_valley region: three cities, four road kinds, a rest area; routes across junctions; service only at depots and rest areas |
| 22 | Traffic | 4 | ✅ | Cars, vans, lorries and buses on lanes: they follow, overtake on the highway, go round a standing truck, take turns at junctions and U-turn at dead ends; the truck crashes into them |
| 23 | Navigation | 4 | ✅ | The route drawn on the road; the next turn, the distance by road and the arrival time on the HUD |
| 24 | Weather | 4 | ✅ | Clear, cloudy, rain and night on a seeded schedule: sky, haze, light, clouds and rain change with it; lit windows, glowing lamps and headlights at night; wet roads grip less and traffic slows |
| 25 | Events | 6 | ✅ | Express Week, Safe Driver and Heavy Cargo as data: a week every other week, a bonus on qualifying deliveries, a reward for the objective; an HQ tab; save v5 |
| 26 | Tutorial | 7 | ✅ | The first contract and the first upgrade, taught by playing: one short hint at a time, the control it is about glows; skippable; save v6 |
| 27 | Optimization | 7 | ⬜ **next** | Hit the device budgets (ARCHITECTURE.md §11) |
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

- The loop ran on the 2.4 km test track, with a depot for each of the three cities, until the 3-city region replaced it in step 21.
- Rewards are shown but not yet kept: the wallet, XP and reputation come with steps 14 and 17, and saving with step 18.
- The HUD arrow follows the road with a simple stand-in for navigation (step 23): both ends snap to the nearest road.
- Every contract fits the starting box truck. Refrigerated and flatbed cargo wait for the trucks the garage will sell (step 19).
- Player-facing text lives in Turkish and English string tables, pulled forward from Phase 7 so the menus never hard-code text.
- `?debug` adds a T key that parks the truck in the bay the mission needs next, for testing (the e2e tests use it).

### Phase 3 notes

- The test track was a miniature, so `GameConfig.fuel.consumptionScale` (60 then; 10 on the larger region, see Phase 4) stretches every metre driven. A full tank lasts roughly eight to ten contracts. Prices and XP are first guesses to tune on phones.
- Four contracts are open at level 1; levels 2 to 4 unlock the rest.
- Saves live in the browser (localStorage); an Android build (step 28) keeps them in the app's storage. There is one save slot.
- The HQ refuelled and repaired by phone, wherever the truck was. Since step 21 the pump and workshop are at depots and the rest area.

### Phase 5 notes

- Steps 19 and 20 came before Phase 4 so the first-success loop (spec §80: "upgrades the truck, takes the next contract") closes on the test track. The 3-city map follows.
- The dealer sells each model once: a fleet of several trucks of one model needs drivers, which is FleetService, after the MVP (spec §44).
- A truck bought waits in the garage; switching puts it where the active truck stands, never during a contract. Each truck keeps its own fuel, damage and upgrades.
- Upgrades are per truck and replace the level below. The engine also saves a little fuel; the suspension protects cargo and steadies cornering. The gearbox and cabin upgrades of spec §16 come later.
- The job board lists all twenty contracts. Contracts that need a bigger truck name it, so the player sees what to buy next.
- Prices are first guesses: the H2 (22,000 credits) pays for itself in about six refrigerated contracts.
- Purchases now save once what was bought is in place. Before, the session saved as the money moved, so a save taken right then had paid for fuel or a repair it did not have.

### Phase 4 notes

- The region is spec §76's 35 km prototype in miniature: 11.5 km of road, depots 3.0 to 4.4 km apart by road, a few minutes' driving each. `fuel.consumptionScale` (10) makes up for the scale: a full tank lasts eight or nine contracts.
- Roads meet where they share a control point; the road network routes across those junctions. The HUD arrow follows it, which is most of step 23's routing; the GPS line and ETA are still to come.
- The pump and the workshop are at depots and the rest area only; the fuel truck comes anywhere at twice the price. During a contract the HQ is out of reach, so the rest area is where to stop.
- The test track is retired. Save v4 moves saves on it to the region's spawn.
- One region, loaded whole: at the spawn about 45 draw calls and 90k triangles are in view, because the forest is tiled and culled. Streaming regions (spec §21) waits until the world has more than one.
- Debug: `?debug` adds Y (park at the rest area) to T; `?fuelScale=N` burns fuel faster for tests.
- Traffic (step 22): 16 vehicles live within 700 m of the truck; new ones appear out of sight (behind the truck, or 350 m or more away) and far ones are recycled. Right-hand traffic, two lanes each way on the highway. All of it costs one draw call per kind of vehicle and well under a millisecond per second of simulation. `?traffic=N` sets how many (0 turns it off).
- Junctions have no traffic lights yet: conflicting turns go one at a time, first come first served. Vehicles keep their distance, so they never run into each other; they stop for the truck and drive round it once it has stood a few seconds, if the other lane is clear.
- The truck is to blame only when it drives into a vehicle: that damages it like any crash, and the vehicle stops for a while. A vehicle driving into a standing truck only shoves it.
- Dead ends got paved turning circles, where traffic turns round (and the truck can too). The truck now starts in the right-hand lane, and "recover" puts it back in one.
- Navigation (step 23): NavigationService traces the route by road to the contract's next bay ten times a second. The HUD shows the next turn ("Turn left in 200 m"; "Turn round" when the truck faces away on the road), the distance by road and the arrival time, in red when it would be late. A translucent band marks the route in the right-hand lane for 700 m ahead and into the yard. Carrying on where roads bend or meet is not announced.
- The arrival time assumes each road driven at 80% of its speed limit (or of the truck's top speed, if lower): `GameConfig.navigation.etaPaceFactor`.
- Weather (step 24): WeatherService runs a seeded schedule. A clear day is the likeliest; each weather lasts 2½ to 7 minutes and turns into the next over 25 s, and a toast says so while driving. Rain cuts the truck's grip to 78% and traffic to 85% of its speed; at night traffic drives at 90%. Haze thickens in rain, so the driver sees less far.
- The look follows the weather through the change: sky, haze, sun and sky light, clouds, and the pre-lit ground with its baked shadows (`PrelitMaterials`). Rain is one draw call of streaks animated on the GPU. At night about half the windows light up, the lamps glow (one draw call for all traffic) and the truck's headlights light the road ahead. In rain the lamps are on at a third.
- The weather is not saved: each session starts clear. `?weather=clear|cloudy|rain|night` fixes the weather for testing.

### Phase 6 notes
- Events (step 25) are data (`EventDefinition`): a schedule of whole UTC days that repeats, a company level to take part, the deliveries that qualify (time to spare, cargo damage, cargo weight or category), an objective (deliveries, or credits earned), a reward and a pay bonus. A new event needs no code.
- Express Week (a quarter of the time to spare) and Safe Driver (no cargo damage) take turns, week by week, so one of them always runs; Heavy Cargo (8 t or more, from level 2) runs a week every other week from Thursdays. EventService pays the bonus on each qualifying delivery and the reward once per run, and the result screen shows both. The HQ's Events tab lists them with their progress and time left; job cards mark contracts whose cargo counts.
- The calendar is the device's clock. `?date=2026-09-30` starts it on another day (the e2e tests play before the first event, so bonuses never change what they check).
- Save v5 keeps the progress of each event's latest run; a new run starts from nothing.
- The spec's random road events (§24: road works, traffic jams and the like) are not in yet.

### Phase 7 notes
- Tutorial (step 26): a new company is walked through spec §41's first ten minutes by playing: take a contract, drive to the pickup bay (right pedal, the wheel, the blue line), deliver, then spend the pay on an upgrade. One short hint at a time, in the HQ above the list (so it never covers a button) or on the road under the mission HUD; the control it is about glows. A failed contract starts the drive over. Skip ends it for good.
- TutorialService follows the game's events (MissionStateChanged, MissionCompleted, MissionFailed, UpgradePurchased); it never blocks the controls. Save v6 keeps the step; companies from older saves have played already and skip it.

## Next step: 27 Optimization

Suggested request:

> Implement roadmap step 27 only. Optimization (ARCHITECTURE.md §11 budgets, spec's performance rules): measure frame time, draw calls and triangles in the heaviest scenes (a busy junction at night in the rain, the HQ over the showcase) on a throttled low-end profile, then bring them within budget: an adaptive pixel ratio that drops when frames run long and recovers when they do not; quality presets (low, medium, high) picked automatically from the device and in a settings screen, scaling rain streaks, clouds, traffic and glows; and a check that per-frame code allocates nothing. Add a performance e2e that fails when the frame budget regresses.

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
