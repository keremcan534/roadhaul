# RoadHaul Architecture

This document explains how the code is organised and why. The rules it describes are enforced by the type checker and by tests; `CLAUDE.md` has the short version.

## 1. Goals

- **Mobile first.** Runs in Android browsers today and in a Capacitor-wrapped app later, at 30 FPS or more on low/mid devices (spec §5).
- **Playable core before content** (spec §2.2). The code must grow by adding data, not by rewriting systems.
- **Game rules run without a browser.** They are unit-testable in Node and reusable on a server if the game goes online (spec §66).
- **Every change is verifiable** by typecheck, tests, build and a real-browser smoke test, in CI and in Claude Code sessions.

Stack: TypeScript, three.js (WebGL2), Vite, Vitest and Playwright. Rapier (vehicle physics) and Capacitor (Android packaging) arrive later. The decision record is [ADR 0001](docs/adr/0001-web-stack-typescript-threejs.md).

## 2. Layers

The spec's principle is **Data -> Domain -> Systems -> Presentation -> UI**. Each layer only depends on the layers before it:

```mermaid
flowchart TD
  core[core<br/>infrastructure]
  data[data<br/>definitions, content, config]
  domain[domain<br/>runtime state + rules]
  systems[systems<br/>services, events]
  app[app<br/>headless composition root]
  simulation[simulation<br/>physics, planned]
  presentation[presentation<br/>three.js]
  ui[ui<br/>DOM overlay]
  platform[platform<br/>browser adapters]
  entry[main.ts<br/>browser composition root]

  data --> core
  domain --> data
  systems --> domain
  app --> systems
  simulation --> systems
  presentation --> simulation
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
| domain | `src/domain` | Runtime state and pure rules: save data, company name rules; later vehicle state, missions, economy formulas | core, data | anywhere |
| systems | `src/systems` | Services that own runtime state, apply domain rules and publish `GameEvents` | core, data, domain | anywhere |
| app | `src/app` | Headless composition root: `GameBootstrapper`, `ServiceKeys` | core … systems | anywhere |
| simulation *(planned, step 05)* | `src/simulation` | Physics world (Rapier), vehicle dynamics, trigger zones. Reports facts to systems | core … systems, `@dimforge/rapier3d-compat` | browser (WASM) |
| presentation | `src/presentation` | three.js renderer, scene views, cameras, visual effects | core … systems, simulation, `three` | browser |
| ui | `src/ui` | DOM overlay: HUD, menus, debug overlay, styles | core … systems | browser |
| platform | `src/platform` | Browser/device adapters: frame scheduler, URL flags, fatal error screen; later storage and input devices | core … systems | browser |
| entry | `src/main.ts` | Browser composition root | everything | browser |

"Anywhere" means browser, Node (tests) or a future server.

### Enforcement

1. **`tsconfig.pure.json`** compiles `core`, `data`, `domain`, `systems` and `app` with only the ES2022 library: no DOM, no Node, no three.js typings. Using `window`, `document`, `console`, `setTimeout` or `performance` there is a compile error.
2. **`tests/architecture/layering.test.ts`** parses every import in `src/` and fails when a layer imports a layer or npm package it may not use. This is the spec §55 dependency rule turned into a test.

## 3. Core rules

- **UI and presentation never change game state directly** (spec §7). They call a system method, for example `economyService.addMoney(reward)`, never `money += 5000`, and they observe `GameEvents` to redraw.
- **Definitions are immutable, runtime state is separate** (spec §54). `ContentCatalog` deep-freezes every definition. Runtime state lives in the domain/systems layers and stores definition ids, never definition objects.
- **No global mutable state.** There are no singletons or module-level variables that change. Services are created in a composition root and passed as constructor parameters.
- **Inject the outside world.** Time (`Clock`), frame timing (`FrameScheduler`), logging (`Logger`) and later storage and randomness are interfaces, so rules are deterministic under test.
- **Expected failures vs bugs.** Invalid player input returns a `Result` (see `validateCompanyName`). Broken invariants throw (see `GameStateService.transitionTo`).

## 4. Boot sequence

1. `src/main.ts` reads URL flags (`?debug`, `?log=`) into the config and creates a `ConsoleLogger`.
2. `GameBootstrapper.boot()`:
   1. registers `Logger` and `Clock`;
   2. validates the content and builds the `ContentCatalog` (all problems are reported together);
   3. validates the config against the content (for example, that the starting truck exists);
   4. creates the `EventBus` and the `GameStateService`;
   5. runs `initialize()` on every service in registration order;
   6. moves the game state from `booting` to `mainMenu`.
3. `src/main.ts` creates the `RenderHost` (WebGL), the placeholder world view and (with `?debug`) the performance overlay, then starts the `GameLoop`.
4. `<html data-boot-state>` becomes `ready`. `data-game-state` follows every `GameStateChanged` event. The e2e tests wait for both.

Any failure shows the fatal error screen and sets `data-boot-state="error"`. A failed boot disposes every service it had already created.

## 5. Services and lifecycle

`ServiceContainer` (`src/core/services`) is a typed registry with an ordered lifecycle:

- `register(key, instance)` / `resolve(key)` with typed `ServiceKey`s (`src/app/ServiceKeys.ts`);
- `initializeAll()` calls `initialize()` (sync or async) in registration order;
- `disposeAll()` calls `dispose()` in reverse order, keeps going when one fails, and rethrows all failures together.

Only composition code (`src/app`, `src/main.ts`) calls `resolve`. Everything else gets its dependencies through its constructor. The container is not a service locator.

**Adding a service:** write the class with constructor dependencies, register it in `GameBootstrapper.boot()` after its dependencies, add its key to `ServiceKeys`, and list it in `SYSTEM_MAP.md`.

## 6. Events

`EventBus<GameEvents>` (`src/core/events`) is a synchronous, typed publish/subscribe channel (spec §57). All cross-system events are declared in one map, `src/systems/GameEvents.ts`. Today it holds `GameStateChanged`. `MissionCompleted`, `MoneyChanged`, `FuelChanged`, `VehicleDamaged` and the others join it as their systems arrive.

- Systems emit. Presentation and UI subscribe.
- `emit` does not allocate. Handlers may subscribe or unsubscribe during delivery.
- A throwing handler is logged and does not break delivery to the others.

## 7. Game loop and time

`GameLoop` (`src/core/time`) is driven by a `FrameScheduler`, which is `requestAnimationFrame` in the browser and a fake in tests:

- `fixedUpdate(step)` runs at a fixed **60 Hz** (`FixedTimestep`), 0 to 5 times per frame. Physics and game rules go here, so they behave the same at any frame rate.
- `frameUpdate(delta, alpha)` runs once per frame. Animation and rendering go here. `alpha` interpolates visuals between fixed steps.
- Frames longer than 0.25 s (tab switches, hitches) are clamped. At most 5 catch-up steps run per frame, so a slow phone slows the simulation down instead of spiralling.
- The browser stops animation frames in background tabs, so the game pauses automatically.
- A handler that throws stops the loop and shows the fatal error screen.

The values live in `GameConfig.simulation`.

## 8. Data and content

The spec's ScriptableObjects become **definition interfaces** (`src/data/definitions`) plus **content** (`src/data/content`):

- Vehicle, cargo, city and mission definitions exist as placeholders. Each definition file also exports its validation function.
- `GAME_CONTENT` (`src/data/content/index.ts`) is the built-in content set. `ContentCatalog.create()` validates every field and every cross-reference, then serves frozen lookups (`catalog.vehicles.get(id)`).
- References are checked at boot: missions must point to existing cities and cargo, origin and destination must differ, and some truck must be able to haul the load.
- **Ids** are `snake_case` and never change once shipped, because saves store them. **Units** are part of field names (`timeLimitSeconds`, `fuelCapacityLiters`). Money is integer `Credits`. Ratios are `Fraction`s from 0 to 1.
- Player-facing text is not stored in definitions. Localization (Phase 7) derives keys from ids, e.g. `cargo.packaged_food.name`.
- Content packs (spec §79) will be JSON with the same shape, loaded through the same validation.

Central tuning values (fixed step, pixel-ratio cap, starting credits, later fuel prices) live in `GameConfig` (`src/data/config`). The config is validated at boot.

## 9. Save data

`SaveGameData` (`src/domain/save`) is the root of the persisted state (spec §32): version, timestamps, profile, company, economy and garage. It is plain JSON with no classes, Maps or Dates. `createNewSaveGameData()` builds the state for a new company.

- `CURRENT_SAVE_VERSION` is stamped into every save. **Any schema change bumps it and ships a migration with a test.**
- Trucks have instance ids (`truck_001`) separate from their model id (`rh_h1`), so the fleet can own two trucks of the same model later.
- **Planned (step 18):** `SaveService` in systems, backed by a storage adapter in platform (IndexedDB/localStorage). It uses an atomic write (write a temp slot, verify, then swap), keeps a backup slot, falls back to the backup or a new game when data is corrupt, and runs a chain of migrations from each old version.

## 10. Rendering and the mobile performance budget

- `RenderHost` owns the `WebGLRenderer`, the scene and the camera. Views add objects to the scene and dispose everything they create.
- **Defaults for low/mid Android:** pixel ratio capped at 1.5, MSAA off, Lambert (or unlit) materials, no real-time shadows (bake lighting into vertex colours or textures instead), fog to hide the far plane.
- **Budgets to validate on a real device (step 29):** at most ~150 draw calls and ~300k triangles in view, a 30 FPS floor. Use `InstancedMesh` for repeated objects (lane markings, trees, traffic) and merged geometry for static scenery.
- **Per-frame code must not allocate.** Keep scratch vectors and matrices as fields.
- The `?debug` overlay shows FPS, draw calls, triangles and the effective pixel ratio.

## 11. Testing

| Kind | Where | Runs | Covers |
|---|---|---|---|
| Unit (spec: EditMode) | `tests/unit/**` mirroring `src/` | `npm test` (Vitest, Node) | every rule, service and formula in the engine-agnostic layers |
| Architecture | `tests/architecture` | `npm test` | layer and package import rules |
| End-to-end (spec: PlayMode) | `tests/e2e` | `npm run build && npm run test:e2e` (Playwright) | boot, rendering, no console errors, on an emulated Pixel 7 with SwiftShader WebGL |

Test helpers live in `tests/support`: `MemoryLogger` and the content fixtures. CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and e2e on every pull request.

## 12. Folder layout

```text
src/
  core/            events/ logging/ objects/ services/ time/ validation/ Result.ts
  data/            config/ content/ definitions/ ContentCatalog.ts GameContent.ts units.ts
  domain/          company/ save/                         (later: vehicles/ missions/ economy/ ...)
  systems/         gameState/ GameEvents.ts               (later: missions/ economy/ save/ ...)
  app/             GameBootstrapper.ts ServiceKeys.ts
  simulation/      (planned) physics/ vehicles/ zones/
  presentation/    RenderHost.ts world/                   (later: vehicles/ cameras/ effects/)
  ui/              debug/ styles.css                      (later: hud/ menus/ i18n/)
  platform/        browser/                               (later: storage/ input/)
  main.ts
tests/
  unit/ architecture/ e2e/ support/
docs/
  ROADHAUL_Game_Design_Technical_Spec.md  adr/
```

Feature folders are created inside a layer when the feature arrives (`src/domain/missions`, `src/systems/missions`, ...). The layer folder decides what code may depend on.

## 13. Extension points

- **Online / server-authoritative (V4+, spec §66–67).** The engine-agnostic layers can run in Node. Rewards and economy changes already go through services, so a server can validate them later.
- **Ads and IAP (spec §35–36).** These become interfaces in systems (for example `AdService`) with platform implementations. Gameplay code never talks to an SDK.
- **Content packs and DLC (spec §79).** These are JSON with the `GameContent` shape, validated by the same catalog code.
- **Localization (Phase 7).** String tables keyed by definition ids. No text is stored in definitions.
- **Multiplayer (V5+).** It is not part of V1. Keep new state serialisable and change it only through service methods, so it can be synchronised later.
