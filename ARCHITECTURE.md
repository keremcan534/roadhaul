# RoadHaul Architecture

This document explains how the code is organised and why. The rules it describes are enforced by the type checker and by tests; `CLAUDE.md` has the short version.

## 1. Goals

- **Mobile first.** Runs in Android browsers and in a Capacitor-wrapped Android app, at 30 FPS or more on low/mid devices (spec §5).
- **Playable core before content** (spec §2.2). The code must grow by adding data, not by rewriting systems.
- **Game rules run without a browser.** They are unit-testable in Node and reusable on a server if the game goes online (spec §66).
- **Every change is verifiable** by typecheck, tests, build and a real-browser smoke test, in CI and in Claude Code sessions.

Stack: TypeScript, three.js (WebGL2), Vite, Vitest and Playwright ([ADR 0001](docs/adr/0001-web-stack-typescript-threejs.md)). Vehicle physics is our own deterministic model rather than a physics engine ([ADR 0002](docs/adr/0002-custom-vehicle-model.md)). Capacitor wraps the same build into the Android app (§16).

## 2. Layers

The spec's principle is **Data -> Domain -> Systems -> Presentation -> UI**. Each layer only depends on the layers before it:

```mermaid
flowchart TD
  core[core<br/>infrastructure]
  data[data<br/>definitions, content, config]
  domain[domain<br/>runtime state + rules]
  systems[systems<br/>services, events]
  app[app<br/>headless composition root]
  presentation[presentation<br/>three.js]
  ui[ui<br/>DOM overlay]
  platform[platform<br/>browser and app adapters]
  entry[main.ts<br/>browser composition root]

  data --> core
  domain --> data
  systems --> domain
  app --> systems
  presentation --> systems
  ui --> systems
  platform --> systems
  entry --> app
  entry --> presentation
  entry --> ui
  entry --> platform
```

| Layer | Folder | Holds | May import | Runs on |
|---|---|---|---|---|
| core | `src/core` | Engine-agnostic infrastructure: service container, event bus, logging, clock, game loop, validation, `Result` | nothing | anywhere |
| data | `src/data` | Static definitions (the spec's ScriptableObjects), built-in content, central config | core | anywhere |
| domain | `src/domain` | Runtime state and pure rules: truck dynamics, road geometry and guidance, surfaces and collisions, mission rules (bays, stages, cargo damage, pay, XP), the wallet and costs, fuel and damage formulas, company levels, save data with migrations and validation, company name rules | core, data | anywhere |
| systems | `src/systems` | Services that own runtime state, apply domain rules and publish `GameEvents` (game state, driving, missions, economy, fuel, damage, company, saves, the game session) | core, data, domain | anywhere |
| app | `src/app` | Headless composition root: `GameBootstrapper`, `ServiceKeys` | core … systems | anywhere |
| presentation | `src/presentation` | three.js renderer, environment, track, depot and truck views, cameras, visual effects; the sound (Web Audio) | core … systems, `three` | browser |
| ui | `src/ui` | DOM overlay: main menu, company HQ job board, mission HUD, touch driving controls, pause and result screens, string tables, debug overlay, styles | core … systems | browser |
| platform | `src/platform` | Browser/device adapters: frame scheduler, keyboard input, URL flags, fatal error screen, localStorage, the device's graphics preset and settings; the Android app's back button and lifecycle | core … systems, `@capacitor/app` | browser, Android app |
| entry | `src/main.ts` | Browser composition root | everything | browser |

"Anywhere" means browser, Node (tests) or a future server.

### Enforcement

1. **`tsconfig.pure.json`** compiles `core`, `data`, `domain`, `systems` and `app` with only the ES2022 library and no DOM or Node typings. Using `window`, `document`, `console`, `setTimeout` or `performance` there is a compile error.
2. **`tests/architecture/layering.test.ts`** scans the imports of every source file in `src/`. That covers static, type-only, re-export, dynamic and `import.meta.glob` imports, in `.ts`, `.mts`, `.cts` and `.tsx` files. The test fails when a layer imports a layer or npm package it may not use; it is what keeps three.js out of the pure layers. This is the spec §55 dependency rule turned into a test. The scanner itself is tested in `tests/architecture/importSpecifiers.test.ts`.

## 3. Core rules

- **UI and presentation never change game state directly** (spec §7). They call a system method, for example `economyService.addMoney(reward)`, never `money += 5000`, and they observe `GameEvents` to redraw.
- **Definitions are immutable, runtime state is separate** (spec §54). `ContentCatalog` deep-freezes every definition. Runtime state lives in the domain/systems layers and stores definition ids, never definition objects.
- **No global mutable state.** There are no singletons or module-level variables that change. Services are created in a composition root and passed as constructor parameters.
- **Inject the outside world.** Time (`Clock`), frame timing (`FrameScheduler`), logging (`Logger`) and later storage and randomness are interfaces, so rules are deterministic under test.
- **Expected failures vs bugs.** Invalid player input returns a `Result` (see `validateCompanyName`). Broken invariants throw (see `GameStateService.transitionTo`).

## 4. Boot sequence

1. `src/main.ts` picks the graphics preset (`?quality=`, the saved setting or the device) and reads URL flags (`?debug`, `?log=`, `?fuelScale=`, `?traffic=`, `?weather=`) into the config, picks the clock (`?date=` moves its calendar) and creates a `ConsoleLogger`.
2. `GameBootstrapper.boot()`:
   1. registers `Logger` and `Clock`;
   2. validates the content and builds the `ContentCatalog` (all problems are reported together);
   3. validates the config against the content (for example, that the starting truck exists);
   4. creates the `EventBus` and the services in dependency order: game state, driving, traffic, weather, economy, company, missions, navigation, damage, fuel, the garage and the upgrade shop, special events, the tutorial, saves and the game session (which subscribes last, so it saves state the others have already updated);
   5. runs `initialize()` on every service in registration order;
   6. moves the game state from `booting` to `mainMenu`.
3. `src/main.ts` picks the language (`?lang=`, then the browser's), puts the starting truck at the start of the starting map, and creates the `RenderHost` (WebGL), `EnvironmentView`, `TrackView`, `DepotView`, `RestAreaView`, `TrafficView`, `GpsRouteView`, `RainView`, `TruckView`, `CameraRig`, keyboard and touch input, the menus, the HUD and, with `?debug`, the performance overlay. It wires the game flow (section 8) and starts the `GameLoop`. The game waits in the main menu, which offers Continue (with a saved game) and New company.
4. `<html data-boot-state>` becomes `ready`. `data-game-state` follows every `GameStateChanged` event, `data-mission-state` every `MissionStateChanged`, `data-vehicle` the truck being driven, `data-traffic` the vehicles on the road and `data-weather` every `WeatherChanged`. The e2e tests wait for them.

Any failure shows the fatal error screen and sets `data-boot-state="error"`. A failed boot disposes every service it had already created.

## 5. Services and lifecycle

`ServiceContainer` (`src/core/services`) is a typed registry with an ordered lifecycle:

- `register(key, instance)` / `resolve(key)` with typed `ServiceKey`s (`src/app/ServiceKeys.ts`);
- `initializeAll()` calls `initialize()` (sync or async) in registration order;
- `disposeAll()` calls `dispose()` in reverse order, keeps going when one fails, and rethrows all failures together.

Only composition code (`src/app`, `src/main.ts`) calls `resolve`. Everything else gets its dependencies through its constructor. The container is not a service locator.

**Adding a service:** write the class with constructor dependencies, register it in `GameBootstrapper.boot()` after its dependencies, add its key to `ServiceKeys`, and list it in `SYSTEM_MAP.md`.

## 6. Events

`EventBus<GameEvents>` (`src/core/events`) is a synchronous, typed publish/subscribe channel (spec §57). All cross-system events are declared in one map, `src/systems/GameEvents.ts`. Today it holds:

- game flow and driving: `GameStateChanged`, `VehicleCollided`;
- missions: `MissionStateChanged`, `CargoDamaged`, `MissionCompleted`, `MissionFailed`;
- money and the truck: `MoneyChanged`, `FuelChanged`, `Refuelled`, `VehicleDamaged`, `VehicleRepaired`;
- the garage: `VehiclePurchased`, `ActiveVehicleChanged`, `UpgradePurchased`;
- the company: `CompanyProgressed`, `CompanyLevelUp`;
- the weather: `WeatherChanged`;
- special events: `EventProgressed`;
- the tutorial: `TutorialStepChanged`.

Events join as their systems arrive.

- Systems emit. Presentation and UI subscribe.
- Events emitted by a handler are queued and delivered right after the current event, so every handler sees events in the order they happened. Otherwise delivery is synchronous.
- Unsubscribing takes effect immediately, even for the event being delivered. A disposed view never receives another event.
- `emit` does not allocate, except when it queues an event raised by a handler.
- A throwing handler is logged and does not break delivery to the others.

## 7. Game loop and time

`GameLoop` (`src/core/time`) is driven by a `FrameScheduler`, which is `requestAnimationFrame` in the browser and a fake in tests:

- `fixedUpdate(step)` runs at a fixed **60 Hz** (`FixedTimestep`), 0 to 5 times per frame. Physics and game rules go here, so they behave the same at any frame rate.
- `frameUpdate(delta, alpha)` runs once per frame. Animation and rendering go here. `alpha` interpolates visuals between fixed steps.
- Frames longer than 0.25 s (tab switches, hitches) are clamped. At most 5 catch-up steps run per frame, so a slow phone slows the simulation down instead of spiralling.
- The browser stops animation frames in background tabs, so the game pauses automatically.
- A handler that throws stops the loop and shows the fatal error screen.

The values live in `GameConfig.simulation`.

## 8. Driving and the mission loop

### Driving

Driving runs through the layers like everything else (roadmap steps 04–08):

```text
keyboard (platform/input) ─┐
touch controls (ui) ───────┼─ combineVehicleInputs ─► DrivingService.step(dt, input)   [fixedUpdate, 60 Hz]
tilt (platform/input) ─────┘                              │
                                        VehicleDynamics ──┤  domain: speed, gear, steering, position
                                        DrivingWorld ─────┘  domain: surface under the truck, collisions
                                                          │
                     TruckView, CameraRig ◄── interpolated pose (previous → current, alpha)   [frameUpdate]
```

- **`VehicleDynamics`** (`src/domain/vehicles`) is a deterministic kinematic bicycle model referenced at the rear axle ([ADR 0002](docs/adr/0002-custom-vehicle-model.md)). Its drivetrain has:
  - a torque/power curve and an automatic gearbox (it cannot hunt between gears);
  - a speed governor;
  - drag, rolling resistance and engine braking;
  - grip-limited traction and braking;
  - brake-to-reverse: hold the brake at a standstill to reverse;
  - understeer at the truck's cornering limit.

  All of it is data in `VehicleDefinition`. `vehicleTuning.test.ts` keeps the shipped trucks feeling like trucks.
- **`DrivingWorld`** (`src/domain/world`) is built from a `MapDefinition`:
  - road centrelines, sampled from a Catmull-Rom curve (`RoadPath`), each of a spec §20 kind (street, ring road, highway, country road);
  - the road network (`RoadNetwork`): roads meet where they share a control point, and routes follow the roads across those junctions;
  - asphalt (roads, turning circles at dead ends, depot yards, rest area lots) or grass under the truck;
  - service points: the depot yards and rest area lots, the only places with a pump and a workshop;
  - trees scattered from a seed, kept clear of roads, yards, lots and buildings;
  - buildings and the map edge.

  Collisions correct the position per contact, then respond once per step to the hardest contact. A head-on hit stops the truck. A glancing one (under 20°) turns it along the obstacle, so it slides on with the speed it had along the surface instead of sticking. Angles up to 45° blend the two. Traffic counts too (moving obstacles): the truck takes an impact only when it drives into a vehicle, and one it rear-ends carries it along at its speed.
- **`DrivingService`** (`src/systems/driving`) owns the truck being driven. It emits one `VehicleCollided` per crash: impacts of 1.5 m/s or more into an obstacle, not repeated while the truck stays in contact. It also sets the cargo mass (a loaded truck is slower), parks the truck at a pose, and recovers a stuck truck into the right-hand lane of the nearest road. Presentation reads its state and never writes it.
- **Input** is device-independent (`VehicleInput`). Keyboard (arrows/WASD, Space, C), touch controls (gas, brake, camera button, and the steering wheel or left/right buttons) and tilt steering are merged every fixed step: steering adds up, pedals take the stronger press.
- **Tilt steering** turns the phone into the steering wheel. `TiltSteering` (pure, unit-tested) measures how far the phone has turned about the screen's axis since it was calibrated, from the accelerometer's gravity: straight ahead is how the phone is held at the start of a drive, when the screen turns and when the tilt button is tapped. Only the angle between two readings counts, so it works in any screen orientation and with browsers that report gravity with the opposite sign. Tipped back far, the angle is read against half of gravity, so it stays steady down to a phone held flat. `TiltInput` (platform) feeds it from `devicemotion` only while tilt is the picked way of steering, and asks iOS for the sensor from a tap. The way of steering, tilt sensitivity and control size are device settings, like the graphics preset.

### Cameras

`CameraRig` (presentation) places the camera for the mode picked: chase, cabin, hood, rear or top (spec §31), from the truck's interpolated pose and motion, allocation-free. Where the cab's parts are comes from `cabGeometry`, shared with `TruckView`, so the driver's eye sits behind the steering wheel the truck model draws. The player's drag (`LookAround`, DOM-free) turns any camera within its limits. The rear camera's picture is mirrored by flipping the canvas (`RenderHost.mirrored`), not the projection, so face culling is untouched.

### The 2D maps

The minimap and the full-screen map draw the same `MapSketch`: the world's roads simplified (Ramer–Douglas–Peucker, 1.5 m) and cut into runs of up to 32 points, each with its bounds, plus yards, lots, turning circles, buildings, depots, rest areas and where city names go. `MapPainter` turns each run into a `Path2D` once and strokes only the runs a `MapViewport` sees, under the canvas transform, so a repaint allocates nothing. The viewport is DOM-free and unit-tested: north up for the full map, the truck's heading up for the minimap. The full map repaints only after a pan, zoom or resize, and the entry point pauses the drive and skips the 3D render while it is open.

### Traffic

NPC traffic (roadmap step 22, spec §19) is waypoint-based and kinematic: vehicles move along paths and are never pushed.

- **`LaneGraph`** (`src/domain/traffic`) turns a `DrivingWorld` into links of waypoints: a right-hand lane each way along every stretch of road between junctions (two each way on the highway), a turn across each junction from every lane in to the rightmost lane of every road out, and a U-turn round the paved turning circle at each dead end. Turns that cross or merge conflict. Every waypoint carries an advisory speed for the bends and turns ahead.
- **`TrafficSimulation`** keeps a fixed pool of vehicles in flat arrays and steps them without allocating. Each follows the vehicle ahead with the Intelligent Driver Model and slows for bends; it takes a conflicting turn only when no other vehicle holds one (first come, first served), stops for the truck, goes round it through the other lane once it has stood a few seconds, overtakes on the highway, and brakes hard when something appears close ahead. New vehicles appear out of sight around the truck; far ones are recycled. Randomness is seeded.
- **`TrafficService`** (`src/systems/traffic`) keeps one simulation per drive and steps it in `fixedUpdate` *before* `DrivingService.step()`, so the truck collides with the traffic where it is now. It hands the simulation to `DrivingService` as its moving obstacles. Traffic also runs behind the menus, and stops when the game is paused.
- **`TrafficView`** draws each kind of vehicle as one `InstancedMesh`, interpolated between fixed steps like the truck.

### Navigation

- **`RoadNetwork.trace`** (`src/domain/world`) lists the route by road from one point to another sample by sample, with its length and how long it takes at a pace per road. It reuses a trace allocated once per map.
- **`nextManoeuvre`** (`src/domain/navigation`) reads a trace: turn round (the truck faces away from the route on the road), turn left or right onto another road, or arrive. Carrying on where roads bend or meet is not a manoeuvre.
- **`NavigationService`** (`src/systems/navigation`) routes to the contract's next bay ten times a second, from `fixedUpdate` after `MissionService.update()`. The HUD reads the distance, the arrival time, the next turn and a point ahead for its arrow; `GpsRouteView` redraws its band on the road only when the route has changed.

### Special events

Events (roadmap step 25, spec §22–23, §53) are data too, and reuse the contracts: an event says which deliveries count, not how to play them.

- **`eventRunAt`** (`src/domain/events`) finds the run of an event going on at a time, or the next one, from its schedule of whole UTC days. **`deliveryQualifies`** checks a delivery against the event's terms.
- **`EventService`** (`src/systems/events`) listens to `MissionCompleted` after `EconomyService` and `CompanyService`: for every running event the company may join and the delivery qualifies for, it pays the bonus, advances the objective and, the first time the objective is met in a run, pays the reward (credits, and XP through `CompanyService.award`). It emits `EventProgressed`, which the result screen shows. Time comes from the injected `Clock`.
- Progress belongs to a run: the save keeps each event's latest run, and a new run starts from nothing.

### Tutorial

The tutorial (roadmap step 26, spec §41) teaches by playing and never blocks anything.

- **`tutorialStepAfter`** (`src/domain/tutorial`) is the whole flow: take a contract, drive to the pickup bay, deliver, buy an upgrade, done. A failed contract starts the drive over.
- **`TutorialService`** (`src/systems/tutorial`) follows the game's events to move the steps on, and can be skipped. It emits `TutorialStepChanged`, on which the session saves.
- **`TutorialHint`** (`src/ui/hud`) shows one short hint for the step, where the step is played: in the HQ above the list (in the flow, so it covers nothing), on the road under the mission HUD. `<html data-tutorial-step>` makes the control the hint is about glow, in CSS.

### Weather

Weather (roadmap step 24, spec §38) is data: each `WeatherDefinition` says how likely and how long it is, what it does to play, and how it looks.

- **`WeatherService`** (`src/systems/weather`) runs a seeded schedule and blends each change over `GameConfig.weather.transitionSeconds`. It hands the effects to the services that own them: the truck's grip as a `DrivingService` performance modifier (like damage and upgrades), and traffic's speed to `TrafficService`. It steps in `fixedUpdate` after traffic, behind the menus too, and emits `WeatherChanged` when a change begins.
- **The look** is presentation's, read every frame from `previous`, `current` and `blend`. `EnvironmentView.applyWeather()` blends the sky, the haze, the lights and the clouds, and relights the pre-lit ground through `PrelitMaterials`, which rescales every unlit ground material and fades the baked shadows with the sun. `RainView` draws the rain round the camera in one draw call, animated in its vertex shader. `setLamps()` on `TruckView`, `TrafficView` and `TrackView` brightens the lamps, adds their glows (`LampGlows`, one `Points` draw call per set), the truck's headlight pool on the road, and lit windows.

### The mission loop

Roadmap steps 09–13 turn driving into a job (spec §9, §12, §50):

```text
main menu ─► company HQ (job board) ─► accept ─► drive to the pickup depot ─► stop in the bay: load
                    ▲                                                                 │
                    └── result (pay, or why it failed) ◄── stop in the bay: unload ◄──┘ drive to the delivery depot
```

- **Data.** Each city has a depot (`DepotDefinition` in the map): a paved yard beside the road with a loading bay. Cargo names the truck body it needs (`BodyType`: box, refrigerated, flatbed). Content validation checks that every mission's cities have depots and that some truck can haul it.
- **Domain** (`src/domain/missions`):
  - `loadingBay`: the whole truck must stand inside the bay, either way round, below about 1 km/h;
  - `MissionInstance`: the plain, saveable state of an accepted contract, with the stages accepted → travellingToPickup → loaded → delivering → completed or failed (abandoned, or cargo damaged beyond the client's tolerance);
  - `cargoDamage`: each crash damages the cargo with the square of its speed, scaled by the cargo's sensitivity;
  - `missionReward`: base pay (reward × cargo multiplier), an on-time bonus, a late penalty capped at half the base pay (spec §64), and a condition bonus for careful driving.
  - `world/RoadNetwork` gives the remaining distance by road and a point to steer toward. It computes the shortest routes to a target once (Dijkstra from the target) and caches them, so the HUD can ask every frame without allocating.
- **`MissionService`** (`src/systems/missions`) offers the contracts the truck can haul (the job board), accepts one at a time, and advances it every fixed step after `DrivingService.step()`: loading after `GameConfig.missions.loadingSeconds` in the pickup bay (the truck gets the cargo's weight), the delivery clock, cargo damage from `VehicleCollided`, and unloading and the reward at the destination. It publishes `MissionStateChanged`, `CargoDamaged`, `MissionCompleted` and `MissionFailed` and never touches the UI.
- **Presentation and UI.** `DepotView` draws the yards and bay lines and lights a beacon over the next bay; `RestAreaView` draws the rest area's lot, stalls and fuel canopy. The UI (`src/ui/menus`, `hq`, `hud`) shows the main menu, the job board, the mission HUD, the pause menu and the result, and only calls service methods. The simulation stands still while a menu or result is open, and the truck stays parked where it was left between contracts.
- **Text.** Player-facing text comes from string tables (`src/ui/i18n`, Turkish and English) with keys derived from ids (`mission.first_package.title`). A unit test keeps both languages complete.

### Economy, the truck's upkeep and the company

Roadmap steps 14–17 give deliveries consequences (spec §13–18):

- **`EconomyService`** is the only owner of money. It pays each delivery's reward (`MissionCompleted`), spends through a `Result` (not enough credits is an expected outcome) and announces `MoneyChanged`. Prices live in `GameConfig.economy`.
- **`FuelService`** burns fuel every fixed step for the distance driven:
  - the formula is spec §17's `fuelUsedLiters`: distance × base consumption × load × terrain × speed × condition;
  - `fuel.consumptionScale` makes up for the miniature map;
  - an empty tank stalls the engine;
  - refuelling costs money at the pump of a depot or rest area or, dearer, from a fuel truck anywhere on the road;
  - a stranded company that cannot pay gets a little emergency fuel for free, so it can never get stuck.
- **`DamageService`** turns collisions into truck damage in the spec §18 bands. Damage weakens the engine and brakes through `DrivingService.setPerformanceModifier` (upgrades add their own modifier), never to nothing. Repairs cost money, at a depot or rest area.
- **The rest area** (spec §25) has a counter (`RestAreaPanel`): fuel, repair and continue, while the truck stands on its lot. During a contract the HQ is out of reach, so it is where to stop.
- **`CompanyService`** keeps the company's name, XP, the five levels (`GameConfig.company.levelXp`), reputation and statistics. Deliveries add XP and reputation (computed with the reward in `missionProgress.ts`); failures cost reputation. Contracts can require a company level, and the job board shows what unlocks them.

### The garage and upgrades

Roadmap steps 19–20 close the first-success loop (spec §80): deliver, earn, upgrade, take a bigger contract.

- **Trucks.** H1 (light box), H2 (medium refrigerated) and H3 (heavy flatbed) are tuned against per-class ranges (`vehicleTuning.test.ts`). The dealer sells H2 and H3 from company levels 2 and 3. Ten of the twenty contracts need them: chilled cargo, heavier boxes, building materials.
- **`GarageService`** owns the company's trucks and the active one. Buying adds a full, unupgraded truck to the garage. Switching is refused during a contract. Otherwise the new truck takes the old one's place on the map (`DrivingService.switchVehicle`), with its own fuel, damage and upgrades. The browser entry rebuilds the `TruckView` on `ActiveVehicleChanged`.
- **Upgrades** (spec §16) are definitions with levels. Each level has a cost, a company level and stat modifiers, and replaces the level below. `statBonuses` sums the fitted levels of a truck. The garage applies them to the active truck:
  - engine, brakes, grip and stability through the `'upgrades'` performance modifier, which multiplies with damage;
  - the tank size and fuel saving through `FuelService.setUpgradeBonuses`;
  - cargo protection through `MissionService.setCargoProtection`.
- **`UpgradeService`** is the shop: the next level of each upgrade for the active truck, paid through the economy.
- **The HQ** has three tabs: the job board, the garage and the upgrade shop. Every blocked contract, truck or upgrade says what unlocks it.

## 9. Data and content

The spec's ScriptableObjects become **definition interfaces** (`src/data/definitions`) plus **content** (`src/data/content`):

- Vehicle (with physics data, price and unlock level), map (with depots), cargo, city, mission and upgrade definitions. Each definition file also exports its validation function.
- `GAME_CONTENT` (`src/data/content/index.ts`) is the built-in content set. `ContentCatalog.create()` validates every field and every cross-reference, then serves frozen lookups (`catalog.vehicles.get(id)`).
- References are checked at boot: missions must point to existing cities and cargo, origin and destination must differ, both cities need a depot, and some truck must have the body and payload for the load. Depots must name known cities. The config's starting truck and map must exist. Checks that need geometry, such as the spawn being on the road or every yard opening onto it, are content tests (`tests/unit/data/content`).
- **Ids** are `snake_case` and never change once shipped, because saves store them. **Units** are part of field names (`timeLimitSeconds`, `fuelCapacityLiters`). Money is integer `Credits`. Ratios are `Fraction`s from 0 to 1.
- Player-facing text is not stored in definitions. The string tables derive keys from ids, e.g. `cargo.packaged_food.name`.
- Content packs (spec §79) will be JSON with the same shape, loaded through the same validation.

Central tuning values (fixed step, pixel-ratio cap, loading time, prices, fuel scale, traffic, the arrival-time pace, the weather's start and changes, company levels, starting credits) live in `GameConfig` (`src/data/config`). The config is validated at boot, including against the content (no contract, truck or upgrade level can require a company level that does not exist).

## 10. Save data

`SaveGameData` (`src/domain/save`) is the root of the persisted state (spec §32). It is plain JSON with no classes, Maps or Dates. It holds:

- version and timestamps;
- profile, company, economy and garage;
- since v2: the world (where the truck is parked), the contract under way, and statistics;
- since v3: the upgrades fitted to each truck;
- v4 has the same shape: the test track is retired, and saves on it move to the region's spawn;
- since v5: the progress in each special event's latest run;
- since v6: the tutorial's step;
- since v7: each truck's paint (null for its model's factory colour).

`createNewSaveGameData()` builds the state for a new company.

- `CURRENT_SAVE_VERSION` (7) is stamped into every save. **Any schema change bumps it and adds a migration to `SAVE_MIGRATIONS` with a test.** `migrateSave` runs the chain from any older version and refuses saves from a newer build.
- `validateSaveGameData` checks every field, range and reference to content before a loaded save is trusted. An invalid save counts as corrupted and is never half-loaded.
- Trucks have instance ids (`truck_001`) separate from their model id (`rh_h1`), so the fleet can own two trucks of the same model later. The garage section lists every truck with its fuel, damage, fitted upgrades and paint, and names the active one.
- **`SaveService`** (`src/systems/save`) writes JSON to a `KeyValueStorage`: localStorage in the browser and in the Android app (`platform/browser/browserStorage.ts`, §16), memory in tests or when the browser forbids storage.
  - **Atomic write:** the new save goes to a pending slot and is read back; only then does the previous save move to the backup slot and the new one into the main slot.
  - **Backup:** loading falls back to it when the latest save is unreadable.
  - **Corruption:** unreadable data is set aside and reported.
  - **Storage errors** (a full quota, private mode) come back as Results: the game never crashes because of a save.
- **`GameSessionService`** (`src/systems/session`) is the company being played.
  - It starts a new game or continues the saved one, and hands each part of the save to the service that owns it (economy, company, the garage with the active truck's fuel and damage, missions, events, the tutorial, the truck's position).
  - It saves after every delivery and failure; after each purchase and truck change, once what was bought is in place (`Refuelled`, `VehicleRepaired`, `VehiclePurchased`, `UpgradePurchased`, `ActiveVehicleChanged`, never on `MoneyChanged`); when the player leaves the road for a menu; and every 20 s of driving. The browser entry also saves when the tab hides or closes.

## 11. Rendering and the mobile performance budget

- `RenderHost` owns the `WebGLRenderer`, the scene and the camera. Views add objects to the scene and dispose everything they create. It uses filmic (ACES) tone mapping.
- **Look:** stylised low-poly with textures.
  - `EnvironmentView` draws a gradient sky dome with a sun glow, clouds and a ring of hazy hills. They all follow the camera. It also owns the fog and the sun and sky lights (`world/lighting.ts`).
  - `TrackView` draws textured grass, asphalt with gravel shoulders, two tree species, buildings with facades, and soft shadow decals.
  - `DepotView` draws concrete yards and bay lines, and the beacon over the bay the mission needs next.
  - `TruckView` builds a detailed cab-over truck carrying the RoadHaul livery.
- **Procedural textures, no image files** (`presentation/textures`). Grass, asphalt, facades, livery, rims and shadows are drawn in plain TypeScript: tileable noise and a small stroke font. They cost nothing to download and are original by construction. The same code runs in Node, so it is unit-tested.
- **Defaults for low/mid Android:**
  - pixel ratio capped by the graphics preset (1 to 1.5), MSAA off;
  - Lambert or Phong materials;
  - no real-time shadows (shadows are soft decals);
  - fog to hide the far plane.
- **Graphics presets** (`GameConfig.rendering`, `QUALITY_PRESETS`): low, medium and high set the pixel ratio cap (1, 1.25, 1.5), how far the resolution may drop (to 70% or 60%), how many rain streaks fall (half, three quarters, all), whether lamps glow at night, and how many traffic vehicles drive (8, 12, 16). The preset comes from `?quality=`, else the player's choice in Settings, else the device (`platform/browser/deviceQuality.ts`): 4 cores or fewer, or 3 GB of memory or less, is low; other phones and tablets are medium; desktops are high. The choice is kept apart from the save (`roadhaul.settings`: it belongs to the phone, not the company), and changing it restarts the game. Where storage forgets (no persistent storage), the address carries it as `?quality=`.
- **Dynamic resolution** (`AdaptiveResolution`, a 30 FPS floor): frame times on the road are averaged over 2 s windows (the menus, drawn at half rate, are no measure). When a window averages slower than 27 FPS the resolution drops by 15%, down to the preset's floor; after three windows faster than 50 FPS it rises by 10%, back to the full pixel ratio. The wide gap keeps it from see-sawing. Frames over 0.2 s are hitches, not a measure, and the first window after a start or a return to the tab is not measured. `RenderHost` resizes the drawing buffer once per change (a resize waits for the GPU) and never to the size it has. The rain's streaks keep their width in pixels.
- **Behind the menus** the scene is a backdrop: it renders every other frame, which saves the battery.
- **Pre-lit flat surfaces.** The ground and road always face up under a fixed sun. They are unlit materials tinted with exactly what Lambert shading would give them (`flatGroundLight()`), so the pixels that cover most of the screen skip lighting.
- **Software rendering** (no GPU: headless CI browsers, some virtual machines) is detected from the WebGL renderer name. The host then renders at one pixel per CSS pixel without anisotropic filtering, so the simulation still runs in real time.
- **Budgets** (checked by `tests/e2e/performance.spec.ts`; to confirm on real phones in step 29): at most ~150 draw calls and ~300k triangles in view, a 30 FPS floor. Use `InstancedMesh` for repeated objects (lane markings, trees, traffic) and merged geometry for static scenery. On a map kilometres wide most of the scenery is out of sight: roads are merged into four draw calls, and the forest is cut into 600 m instanced tiles that the camera culls. At the region's spawn about 48 draw calls and 91k triangles are in view, as the `?debug` overlay shows; traffic adds one draw call per kind of vehicle and one for their lamps. Weather adds at most a few: rain one, and at night the glows (two) and the headlight pool (one). The heaviest scenes measured, with 24 vehicles: a city yard at night, 52 draw calls and 92k triangles; the HQ backdrop at night, 59 and 98k; rain at the spawn, 52 and 109k.
- **Translucent two-sided materials** set `forceSinglePass`. Otherwise three.js draws them twice (back, then front) and sets their shader up afresh for each pass, every frame.
- **The simulation's share:** a fixed step of every system, with 16 vehicles, takes about 60 µs on a desktop CPU. Whatever runs every step must not visit the whole map: which ground the truck is on comes from `RoadGrid`, the road pieces filed by 20 m cell, like the trees for collisions.
- **Bundle:** three.js ships in its own chunk (about 545 kB, 135 kB gzipped), so it stays cached across game updates; the game code is about 270 kB (85 kB gzipped).
- **Per-frame code must not allocate.** Keep scratch vectors and matrices as fields.
- **Profiling:** Chrome DevTools, on a phone through remote debugging. The Performance panel shows where frame time goes; Memory → "Allocation sampling" shows what allocates while driving. Profile with `npm run dev`, whose modules keep their file names.
- The performance display (`?debug`, or Settings → Performance display, which also works in the Android app) shows FPS, draw calls, triangles and the effective pixel ratio, the truck's position and heading (for placing things on maps; the e2e tests read the heading to check steering), and the graphics preset and GPU, for test reports. Only `?debug` adds the debug keys.

## 12. Testing

| Kind | Where | Runs | Covers |
|---|---|---|---|
| Unit (spec: EditMode) | `tests/unit/**` mirroring `src/` | `npm test` (Vitest, Node) | every rule, service and formula in the engine-agnostic layers, plus presentation code that runs without WebGL (such as resource disposal) |
| Architecture | `tests/architecture` | `npm test` | layer and package import rules, and the import scanner that checks them |
| End-to-end (spec: PlayMode) | `tests/e2e` | `npm run build && npm run test:e2e` (Playwright) | on an emulated Pixel 7 with SwiftShader WebGL: boot into the menu, the job board, a whole delivery (with the `?debug` T key), abandoning, pausing, keyboard and touch driving, reverse, camera switch, layout in both orientations, the draw budget in the heaviest scenes, no console errors. The tests play on the high preset (`?quality=high`) unless they pick one, so what they count does not depend on the machine |

Test helpers live in `tests/support`: `MemoryLogger`, the content fixtures, the driving loop helpers and the three.js resource helpers. CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and e2e on every pull request; a second job builds the Android debug APK (§16).

## 13. Folder layout

```text
src/
  core/            events/ logging/ math/ objects/ random/ services/ storage/ time/ validation/ Result.ts
  data/            config/ content/ definitions/ ContentCatalog.ts GameContent.ts units.ts
  domain/          company/ economy/ missions/ save/ vehicles/ world/
  systems/         company/ driving/ economy/ gameState/ missions/ save/ session/ vehicles/ GameEvents.ts
  app/             GameBootstrapper.ts ServiceKeys.ts
  presentation/    RenderHost.ts AdaptiveResolution.ts audio/ cameras/ navigation/ textures/ traffic/ vehicles/ weather/ world/
  ui/              controls/ debug/ hq/ hud/ i18n/ menus/ dom.ts styles.css
  platform/        browser/ input/ native/
  main.ts
tests/
  unit/ architecture/ e2e/ support/
android/           the Android app's native project (Capacitor): Gradle build, manifest, icons
scripts/           androidIcons.mjs (draws the launcher icons)
docs/
  ROADHAUL_Game_Design_Technical_Spec.md  adr/
```

Feature folders are created inside a layer when the feature arrives (`src/domain/missions`, `src/systems/missions`, ...). The layer folder decides what code may depend on.

## 14. Extension points

- **Online / server-authoritative (V4+, spec §66–67).** The engine-agnostic layers can run in Node. Rewards and economy changes already go through services, so a server can validate them later.
- **Ads and IAP (spec §35–36).** These become interfaces in systems (for example `AdService`) with platform implementations. Gameplay code never talks to an SDK.
- **Content packs and DLC (spec §79).** These are JSON with the `GameContent` shape, validated by the same catalog code.
- **Localization.** Turkish and English string tables keyed by definition ids (`src/ui/i18n`). No text is stored in definitions; more languages are more tables.
- **Multiplayer (V5+).** It is not part of V1. Keep new state serialisable and change it only through service methods, so it can be synchronised later.
- **iOS.** Capacitor wraps the same build for iOS too (`cap add ios`); `capacitorShell` would serve it as it is.
- **More sound.** Traffic, a gearbox, music and the radio (spec §37, V2) join `GameAudio` as more nodes fed from the same `SoundState` and events.

## 15. Sound

- **Made in code, no sound files** (`presentation/audio`), like the textures: Web Audio oscillators and noise, original by construction and nothing to download. It is spec §37's first version: engine, brakes, horn, ambience (tyres, wind, rain) and the interface.
- **`GameAudio`** holds one graph for the whole session: the engine (a sawtooth at the six cylinders' firing rate, a rumble an octave down and filtered clatter, opened up by the load), road noise, brake friction, rain and a two-note horn. `update()` moves their levels and notes every frame from a `SoundState` the entry point fills (rpm, pedals, speed, rain); it allocates nothing. One-shots (a click, the delivery chime, a failure, a crash as loud as it was hard, the clunk of loading, the air brakes' hiss when the truck stops) make their few nodes as they play.
- **The pure part is tested:** `soundModel.ts` turns rpm and pedal into the engine's note, loudness and brightness, and speed into road, brake and crash levels. The e2e tests check that sound starts, switches off and plays through a drive without an error.
- **Browsers start sound only after a gesture.** The audio context is made at the first touch or key press that counts as one (`navigator.userActivation`), so nothing is refused with a warning. It sleeps while the page is hidden, and Settings switches it off (a device setting, beside the graphics).
- **Levels** stay well below clipping: at full throttle with the horn the peak is about 0.6.

## 16. The Android app

- **Capacitor 8 wraps the production build** (`dist/`) into an Android app (`android/`, `capacitor.config.json`). The app serves the game from its own files at `https://localhost`: it runs offline and loads like the web build.
- **`npm run android`** builds the game and copies it into the native project (`cap sync`); `./gradlew assembleDebug` in `android/` builds the APK. CI does both on every pull request and keeps the APK as an artifact for 14 days, numbering each build (`ROADHAUL_VERSION_CODE`); the version name is `package.json`'s.
- **Saves** stay in the WebView's localStorage, inside the app's own data, under the `https://localhost` origin. Changing the app's scheme or hostname (`server.androidScheme`, `server.hostname`) would change the origin and lose every saved game.
- **Debug builds are signed with `android/app/debug.keystore`,** kept in the repository, so every build installs over the last one and keeps the save. That key is public: a store release (step 30) needs its own key, kept out of the repository.
- **The back button and the app's lifecycle** come from Capacitor's App plugin, wrapped by `platform/native/capacitorShell.ts`. `main.ts` loads that module only when the native bridge is there (`isNativeApp`), so the web build never downloads it. The back button closes the dialog that is open, pauses and resumes the drive, and takes the HQ back to the main menu (`ui/menus/backAction.ts`); at the main menu it puts the app away. Going to the background pauses the drive and saves, as a hidden browser tab does.
- **Full screen:** `MainActivity` hides the status and navigation bars; a swipe from the edge shows them for a moment. Capacitor's SystemBars keeps the page's `env(safe-area-inset-*)` right round display cutouts, which the HUD's CSS already uses.
- **Art:** the launcher icons (`scripts/androidIcons.mjs`: a dark box truck on the game's amber) and the splash (the icon on the game's background) are original. Capacitor's template images were removed.
