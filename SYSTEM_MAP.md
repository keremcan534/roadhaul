# RoadHaul System Map

Every system, the layer that owns it, and its status. Update this file whenever a system is added, moved or finished (`CLAUDE.md` rule: every new system has a clear owner).

Status: ✅ implemented · 🧩 placeholder (structure only, content or tuning pending) · ⬜ planned (roadmap step in brackets)

## Implemented

### Foundation (Phase 0)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| ServiceContainer | core | `src/core/services/ServiceContainer.ts` | Typed service registry; ordered `initialize` / reverse `dispose` | none | none |
| EventBus | core | `src/core/events/EventBus.ts` | Typed pub/sub; in-order delivery of events raised by handlers; immediate unsubscribe; isolates handler errors | Logger | carries `GameEvents` |
| Logger, ConsoleLogger | core | `src/core/logging/` | Levelled, categorised logging to an injected sink | none | none |
| Clock | core | `src/core/time/Clock.ts` | Injectable wall-clock time | none | none |
| FixedTimestep, GameLoop | core | `src/core/time/` | 60 Hz fixed simulation steps + per-frame updates; clamps and caps catch-up | FrameScheduler | none |
| Validator | core | `src/core/validation/Validator.ts` | Collects every validation issue; throws `ValidationError` | none | none |
| Math helpers, SeededRandom | core | `src/core/math/`, `src/core/random/` | Allocation-free scalar helpers; deterministic random numbers | none | none |
| ContentCatalog | data | `src/data/ContentCatalog.ts` | Validates content and cross-references; frozen id lookups | Definitions | none |
| GameConfig | data | `src/data/config/GameConfig.ts` | Central tuning values + validation against content | ContentCatalog | none |
| Company name rules | domain | `src/domain/company/companyName.ts` | Normalise and validate the player's company name | none | none |
| SaveGameData | domain | `src/domain/save/` | Versioned save schema (v3), new-game state, migrations, validation of loaded saves | Definitions | none |
| GameStateService | systems | `src/systems/gameState/` | Owns the top-level flow: booting, mainMenu, companyHq, driving | EventBus, Logger | emits `GameStateChanged` |
| GameBootstrapper | app | `src/app/GameBootstrapper.ts` | Headless composition root: create, validate, initialize, enter main menu | everything above | none |
| RenderHost | presentation | `src/presentation/RenderHost.ts` | WebGL renderer, scene, camera, capped pixel ratio, tone mapping, software-rendering fallback | three | none |
| PerfOverlay | ui | `src/ui/debug/PerfOverlay.ts` | `?debug` FPS / draw calls / triangles / pixel ratio, truck position and heading | none | none |
| Browser adapters | platform | `src/platform/browser/` | rAF scheduler, URL config flags, fatal error screen, localStorage (or memory when forbidden) | core, data | none |
| Browser entry | entry | `src/main.ts` | Boots services; attaches rendering, input, menus, HUD and the loop; wires the game flow (menu → HQ → driving → result) and pausing; rebuilds the truck view when the player drives another truck | everything | listens `GameStateChanged`, the mission events and `ActiveVehicleChanged` |

### Driving prototype (Phase 1, roadmap steps 04–08)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| VehicleDefinition | data | `src/data/definitions/VehicleDefinition.ts` | Truck data: body, powertrain, handling; validated (no gearbox hunting) | Validator | none |
| MapDefinition, test track | data | `src/data/definitions/MapDefinition.ts`, `src/data/content/maps.ts` | Roads, buildings, depots, spawn, scenery seed; the 2.4 km `test_track` with three depots | Validator | none |
| VehicleDynamics | domain | `src/domain/vehicles/VehicleDynamics.ts` | Deterministic truck model: drivetrain, gearbox, governor, brakes, reverse, understeer (ADR 0002) | VehicleDefinition | none |
| VehicleInput, VehicleRuntimeState | domain | `src/domain/vehicles/` | Device-independent driver input; live truck state | none | none |
| RoadPath | domain | `src/domain/world/RoadPath.ts` | Catmull-Rom centreline shared by driving and rendering | MapDefinition | none |
| DrivingWorld | domain | `src/domain/world/DrivingWorld.ts` | Surfaces (roads and yards are asphalt), seeded trees, buildings, depots, collisions, map edge | RoadPath, SeededRandom | none |
| DrivingService | systems | `src/systems/driving/DrivingService.ts` | Owns the driven truck and world; steps them every fixed step; cargo mass, parking, recovery onto the road | ContentCatalog, EventBus | emits `VehicleCollided` |
| EnvironmentView | presentation | `src/presentation/world/EnvironmentView.ts`, `world/lighting.ts` | Gradient sky with sun glow, clouds and horizon hills that follow the camera; fog; sun and sky lights | three | none |
| Procedural textures | presentation | `src/presentation/textures/` | Grass, asphalt, gravel, concrete, facades, livery, rims and soft shadows drawn in code (tileable noise, stroke font): no image files | three | none |
| TrackView | presentation | `src/presentation/world/TrackView.ts` | Pre-lit textured ground and roads with shoulders, markings, two tree species, buildings with facades and roofs, soft shadow decals (about 14 draw calls) | DrivingWorld, three | none |
| TruckView | presentation | `src/presentation/vehicles/TruckView.ts` | Detailed cab-over truck from body data (windows, grille, lights, mirrors, livery, rims), merged per material; box, refrigerated (cooling unit) or flatbed body (deck, headboard, a load shown while loaded); tandem rear axle for heavy trucks; steering and rolling wheels; pitch and roll; cabin dashboard | VehicleDefinition, three | none |
| CameraRig | presentation | `src/presentation/cameras/CameraRig.ts` | Chase and cabin cameras (spec §31), fitted to the truck's size; a camera circling the parked truck behind the menus | three | none |
| KeyboardInput | platform | `src/platform/input/KeyboardInput.ts` | Arrows/WASD, Space, C (camera), Escape/P (pause) → `VehicleInput` | VehicleInput | none |
| TouchControls | ui | `src/ui/controls/TouchControls.ts` | SVG steering wheel, gas and brake pedals, camera button, speed dial and gear readout | VehicleInput | none |

### Mission loop (Phase 2, roadmap steps 09–13)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Cargo, BodyType | data | `src/data/definitions/CargoDefinition.ts`, `BodyType.ts`, `src/data/content/cargo.ts` | Eight cargo types (spec §11) with the truck body each needs (box, refrigerated, flatbed) | Validator | none |
| Depots | data | `DepotDefinition` in `src/data/definitions/MapDefinition.ts` | A paved yard and loading bay per city, validated against cities and missions | Validator | none |
| Missions (content) | data | `src/data/content/missions.ts` | Twenty contracts (spec §43, §77): ten for the starting truck, ten for the H2 and H3 | ContentCatalog | none |
| Mission rules | domain | `src/domain/missions/` | Bay parking, the `MissionInstance` stages (spec §50), cargo damage, itemised reward (spec §64) | Definitions | none |
| Road guidance | domain | `src/domain/world/roadRoute.ts` | Remaining distance by road and a point to steer toward (until navigation, step 23) | RoadPath | none |
| MissionService | systems | `src/systems/missions/MissionService.ts` | Job board with what blocks each contract (company level, truck), accepting, loading and unloading in bays, delivery clock, cargo damage (less with cargo protection), reward, abandoning | DrivingService, ContentCatalog, EventBus | listens `VehicleCollided`; emits `MissionStateChanged`, `CargoDamaged`, `MissionCompleted`, `MissionFailed` |
| DepotView | presentation | `src/presentation/world/DepotView.ts` | Concrete yards, bay lines, the beacon over the next bay | three | none |
| MainMenu | ui | `src/ui/menus/MainMenu.ts` | Title screen and language switch | Strings | none |
| CompanyHq | ui | `src/ui/hq/CompanyHq.ts`, `jobCards.ts` | Job board (spec §26, §28): open contracts first, blocked ones say what unlocks them | MissionService offers, Strings | none |
| MissionHud | ui | `src/ui/hud/MissionHud.ts` | Objective, direction arrow and distance, stop hint, loading bar, delivery clock, cargo condition (spec §12, §30) | MissionService, DrivingService | none |
| PauseMenu, ResultDialog | ui | `src/ui/menus/` | Pause (resume, recover, abandon, HQ); the itemised result or the failure reason | Strings | none |
| String tables | ui | `src/ui/i18n/` | Turkish and English text, number, money, distance and time formats; language choice | none | none |

### Economy, upkeep, progression and saving (Phase 3, roadmap steps 14–18)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| CurrencyWallet, costs | domain | `src/domain/economy/` | Whole, non-negative credits; spending returns a Result; fuel and repair prices rounded up | none | none |
| Fuel and damage rules | domain | `src/domain/vehicles/fuelConsumption.ts`, `vehicleDamage.ts` | Spec §17 fuel formula; spec §18 damage bands, impact damage, weakened engine and brakes | VehicleDefinition | none |
| Company progression, delivery XP | domain | `src/domain/company/companyProgress.ts`, `src/domain/missions/missionProgress.ts` | Levels from XP (spec §14); XP and reputation for a delivery, reputation lost on failure | GameConfig | none |
| Save migrations and validation | domain | `src/domain/save/saveMigrations.ts`, `validateSaveGameData.ts` | Upgrade old saves (v1 → v2 → v3), refuse newer ones, check every field and reference | ContentCatalog | none |
| EconomyService | systems | `src/systems/economy/EconomyService.ts` | The only owner of money (spec §13, §51): pays deliveries, spends, prices fuel and repairs | EventBus | listens `MissionCompleted`; emits `MoneyChanged` |
| FuelService | systems | `src/systems/vehicles/FuelService.ts` | Burns fuel per fixed step; stalls an empty engine; refuels at the pump or on the road; emergency fuel; tank and consumption upgrades | DrivingService, DamageService, EconomyService | emits `FuelChanged`, `Refuelled` |
| DamageService | systems | `src/systems/vehicles/DamageService.ts` | Truck damage from collisions (spec §18), performance penalty, paid repairs | DrivingService, EconomyService | listens `VehicleCollided`; emits `VehicleDamaged`, `VehicleRepaired` |
| CompanyService | systems | `src/systems/company/CompanyService.ts` | Name, XP, level, reputation, statistics | EventBus, GameConfig | listens `MissionCompleted`, `MissionFailed`; emits `CompanyProgressed`, `CompanyLevelUp` |
| SaveService | systems | `src/systems/save/SaveService.ts` | Versioned JSON saves (spec §32, §52): atomic write, backup, corruption handling, migrations | KeyValueStorage, ContentCatalog | none |
| GameSessionService | systems | `src/systems/session/GameSessionService.ts` | New game or continue; hands each save section to its owner; autosaves | every Phase 3 service, DrivingService, MissionService, GarageService | listens to the mission, purchase, truck and state events to save |
| NewCompanyDialog | ui | `src/ui/menus/NewCompanyDialog.ts` | Name the company (spec §41) | Strings | none |
| Company HQ (finances, truck) | ui | `src/ui/hq/CompanyHq.ts` | Company card, truck card (refuel, repair), level-locked job board | Phase 3 services (read only) | none |
| Toasts | ui | `src/ui/hud/Toasts.ts` | Short notices (level-up, fuel, damage, purchases) | none | none |

### Garage and upgrades (Phase 5, roadmap steps 19–20)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Truck roster | data | `src/data/content/vehicles.ts` | H1 light box, H2 medium refrigerated, H3 heavy flatbed (spec §15), with prices and unlock levels; tuned per class | VehicleDefinition | none |
| UpgradeDefinition, upgrades | data | `src/data/definitions/UpgradeDefinition.ts`, `src/data/content/upgrades.ts` | Upgrade levels with cost, unlock level and stat modifiers (spec §16); engine, brakes, tyres, suspension, fuel tank | Validator | none |
| Upgrade bonuses, performance factors | domain | `src/domain/vehicles/upgradeBonuses.ts`, `performance.ts` | A truck's stat bonuses from its fitted levels; engine, brake, grip and stability factors | UpgradeDefinition | none |
| GarageService | systems | `src/systems/vehicles/GarageService.ts` | The company's trucks and the active one (spec §32 GarageState); the dealer; switching in place; fits the active truck's upgrades to driving, fuel and missions | DrivingService, MissionService, FuelService, DamageService, EconomyService | emits `VehiclePurchased`, `ActiveVehicleChanged` |
| UpgradeService | systems | `src/systems/vehicles/UpgradeService.ts` | The upgrade shop: the next level of each upgrade for the active truck | GarageService, EconomyService | emits `UpgradePurchased` |
| HQ garage and upgrade tabs | ui | `src/ui/hq/CompanyHq.ts`, `garageCards.ts`, `upgradeCards.ts` | Buy and switch trucks; buy upgrade levels; each card says what it costs or unlocks it | GarageService, UpgradeService (read only) | none |

## Planned for the MVP

The system names follow the spec. Placement follows `ARCHITECTURE.md`.

| System | Layer(s) | Step | Responsibility |
|---|---|---|---|
| City/world data, region loading | data, systems, presentation | ⬜ 21 | 3-city map, depots, rest areas (fuel / repair / continue) |
| TrafficService | domain, systems, presentation | ⬜ 22 | Waypoint-based, pooled, kinematic NPC vehicles (spec §19) |
| NavigationService | systems, presentation | ⬜ 23 | Waypoint graph routing, GPS arrow, distance, ETA (spec §62–63) |
| WeatherService | systems, presentation | ⬜ 24 | Clear / Cloudy / Rain / Night with small gameplay modifiers (spec §38) |
| EventService (+ road events) | data, domain, systems | ⬜ 25 | Data-driven timed events: requirements, objectives, rewards, modifiers (spec §22–24, §53) |
| TutorialService | systems, ui | ⬜ 26 | Learn-by-playing first 10 minutes (spec §41) |
| AudioService | presentation | ⬜ Phase 7 | Engine, brake, horn, ambience, UI sounds (spec §37) |
| Settings, more languages | ui | ⬜ Phase 7 | A settings screen (language, sound, quality); more string tables |
| Android packaging | tooling | ⬜ 28 | Capacitor app built in CI |

## Not in the MVP (spec §44)

FleetService / DriverService (AI drivers), AnalyticsService, AdService, IAPService, OnlineService, multiplayer, licensed brands, second-hand market, tenders. When they come, they enter as interfaces in systems, with implementations in platform.
