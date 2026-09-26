# ROADHAUL PROJECT RULES

RoadHaul is a mobile-first logistics and truck simulation game: take a contract, load cargo, drive, deliver, earn, upgrade, grow the company.

- **Requirements:** `docs/ROADHAUL_Game_Design_Technical_Spec.md` (Turkish, written for Unity; see "Translating the spec" below)
- **Stack:** TypeScript + three.js + Vite, tested with Vitest and Playwright. Why not Unity: `docs/adr/0001-web-stack-typescript-threejs.md`. Why no physics engine: `docs/adr/0002-custom-vehicle-model.md`
- **Architecture:** `ARCHITECTURE.md` · **Systems and owners:** `SYSTEM_MAP.md` · **Plan and status:** `DEVELOPMENT_ROADMAP.md`

## Commands

```sh
npm ci              # install (Node 22.12+, 24 or 26+)
npm run dev         # dev server; add `-- --host` to open it from a phone on the same Wi-Fi
npm run typecheck   # tsc -b over all tsconfig projects
npm test            # unit + architecture tests (Vitest)
npm run build       # production build into dist/
npm run test:e2e    # Playwright smoke tests against dist/ (run build first)
npm run check       # everything above, in order
npm run android     # build, then copy into the Android project; `cd android && ./gradlew assembleDebug` builds the APK (JDK 21, Android SDK)
```

Append `?debug` to the game URL for the FPS / draw-call overlay (Settings → Performance display shows it too, also in the app), debug logs, the T key (parks the truck in the mission's next bay) and the Y key (parks it at the rest area); `?lang=tr` or `?lang=en` picks the language; `?traffic=0` turns NPC traffic off (a number sets how many vehicles); `?weather=clear|cloudy|rain` fixes the weather (and `dusk|night|dawn` the time of day's look); `?time=19:30` sets the game's clock and keeps it there; `?date=2026-09-30` starts the calendar (special events, contracts of the day) on that day; `?quality=low|medium|high` overrides the graphics preset (Settings, or picked for the device); `?post=0` draws without the colour pass (bloom, grade, smoothing), for comparison; `?lamps=0` keeps the night's lamps from lighting the world, and `?lamps=1` lets them even when drawn in software; `?glass=lens|blur|tint` picks the menus' glass; `?spawn=x,z,heading` starts a new game's truck at that spot (heading in degrees, 0 along +z). Desktop driving: arrows/WASD, Space brakes (hold at a standstill to reverse), C switches camera, H sounds the horn, M opens the map, Escape or P pauses. On phones, Settings picks the steering (wheel, tilt or buttons) and the control size.

## Architecture

Use: **Data -> Domain -> Systems -> Presentation -> UI**

| Layer | Folder | May import |
|---|---|---|
| core | `src/core` | nothing |
| data | `src/data` | core |
| domain | `src/domain` | core, data |
| systems | `src/systems` | core, data, domain |
| app | `src/app` | core, data, domain, systems |
| presentation | `src/presentation` | core … systems, three.js |
| ui | `src/ui` | core … systems |
| platform | `src/platform` | core … systems |
| entry | `src/main.ts` | everything |

`core`, `data`, `domain`, `systems` and `app` are **engine-agnostic**. They use no DOM, no Node APIs, no three.js and no npm packages. Two checks enforce this: `tsconfig.pure.json` (compiled without DOM typings) and `tests/architecture/layering.test.ts` (import rules). Never weaken either to make code compile; move the code instead.

## Rules

- Do not put gameplay logic inside UI or presentation. They call system methods and observe `GameEvents`.
- Do not use module-level mutable state or singletons unless explicitly approved. Only the composition roots (`src/app/GameBootstrapper.ts`, `src/main.ts`) create and wire services.
- Use interfaces for replaceable services (Logger, Clock, FrameScheduler, storage, ads, analytics).
- Static game data lives in `src/data` as typed definitions + content. Definitions are deep-frozen at boot. Never mutate them.
- Runtime state (`src/domain`) is separate from definition data and references definitions by id.
- Every new system must have a clear owner. Add it to `SYSTEM_MAP.md`.
- Avoid unnecessary dependencies. Adding an npm package needs a reason in the commit/PR.
- Prefer composition over inheritance.
- Write testable TypeScript: inject time, randomness, storage and frame scheduling.
- Expected failures (player input) return a `Result`. Broken invariants throw.
- Do not modify unrelated files.
- Before implementing a large feature, explain the plan.
- After implementation, run typecheck, tests and build (and `test:e2e` when boot, rendering or UI changed).
- Never invent APIs. Check the installed versions' type definitions (`node_modules/@types/three`, etc.).
- Do not delete working code without explaining why.
- Keep mobile performance in mind.
- No multiplayer, ads, online services or real-world brands/vehicles until the roadmap says so. All names, trucks, maps and art must be original (spec §85).

## Save

Save files must have a version number (`CURRENT_SAVE_VERSION` in `src/domain/save/SaveGameData.ts`).
Never change the save schema without bumping the version and adding a migration + test.

## Performance

Target: 30 FPS minimum on supported low/mid Android devices.

Avoid in per-frame code (`fixedUpdate`, `frameUpdate`, anything they call):
- allocations: `new Vector3()`, object/array literals, closures, spread, `map`/`filter`, string building
- creating or disposing three.js geometries, materials or textures
- `scene.traverse`, `getObjectByName`, DOM queries, layout-triggering DOM reads
- DOM writes every frame (throttle UI updates)
- logging

Use: cached objects and scratch vectors, object pooling, `InstancedMesh`, merged low-poly geometry, the capped pixel ratio, no real-time shadows by default, compressed textures later. Always `dispose()` GPU resources you create.

## Workflow

1. Inspect existing architecture (this file, `ARCHITECTURE.md`, `SYSTEM_MAP.md`).
2. Plan.
3. Implement minimum required scope.
4. `npm run typecheck`
5. `npm test` (+ `npm run build && npm run test:e2e` for boot/rendering/UI changes)
6. Report changed files and known limitations; update `SYSTEM_MAP.md` and `DEVELOPMENT_ROADMAP.md`.

Commits are small and conventional: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:` (spec §71).

## Translating the spec (Unity -> this project)

| Spec says | Here |
|---|---|
| ScriptableObject definition | readonly interface in `src/data/definitions` + entries in `src/data/content`, validated by `ContentCatalog` |
| MonoBehaviour / scene object | presentation class in `src/presentation` (three.js) |
| GameBootstrapper MonoBehaviour | `src/app/GameBootstrapper.ts` (headless) + `src/main.ts` (browser) |
| EditMode tests | Vitest in `tests/unit` |
| PlayMode tests | Playwright in `tests/e2e` |
| Update / FixedUpdate | `GameLoop` `frameUpdate` / `fixedUpdate` (fixed 60 Hz step) |
| Rigidbody / WheelCollider | `VehicleDynamics` (domain) + `DrivingWorld` collisions, no physics engine (ADR 0002) |
| Addressables / region streaming | dynamic `import()` + asset manifests per region |
| Input System | `KeyboardInput` (`src/platform/input`) and `TouchControls` (`src/ui/controls`) write a device-independent `VehicleInput` |
| TextMeshPro / uGUI | HTML/CSS overlay in `src/ui` |
| Unity Localization | string tables (Phase 7); keys derived from definition ids |
| Unity Profiler | `?debug` overlay, Chrome DevTools remote debugging |
| Android build | Capacitor wrapper built in CI (step 28) |
| `IFoo` interface naming | plain `Foo` interface; implementations get descriptive names (`ConsoleLogger`) |

## Conventions

- Files: PascalCase for class/type modules (`GameStateService.ts`), camelCase for function modules (`companyName.ts`).
- Ids: `snake_case`, stable forever (they end up in save files).
- Units in names: `Seconds`, `Ms`, `Kmh`, `Liters`, `Tons`, `Meters`. Money is integer `Credits`. Ratios are `Fraction` (0..1).
- Enumerations: `as const` arrays + union types, no TypeScript `enum`.
- Code, comments and docs in English. Player-facing text will be localized (Turkish + English).
