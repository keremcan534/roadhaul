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
| SaveGameData 🧩 | domain | `src/domain/save/` | Versioned save schema (v1) + new-game state | Definitions | none |
| GameStateService | systems | `src/systems/gameState/` | Owns the top-level flow: booting, mainMenu, companyHq, driving | EventBus, Logger | emits `GameStateChanged` |
| GameBootstrapper | app | `src/app/GameBootstrapper.ts` | Headless composition root: create, validate, initialize, enter main menu | everything above | none |
| RenderHost | presentation | `src/presentation/RenderHost.ts` | WebGL renderer, scene, camera, capped pixel ratio | three | none |
| PerfOverlay | ui | `src/ui/debug/PerfOverlay.ts` | `?debug` FPS / draw calls / triangles / pixel ratio, truck position and heading | none | none |
| Browser adapters | platform | `src/platform/browser/` | rAF scheduler, URL config flags, fatal error screen | core, data | none |
| Browser entry | entry | `src/main.ts` | Boots services, starts driving, attaches rendering, input and the loop | everything | listens `GameStateChanged` |

### Driving prototype (Phase 1, roadmap steps 04–08)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| VehicleDefinition | data | `src/data/definitions/VehicleDefinition.ts` | Truck data: body, powertrain, handling; validated (no gearbox hunting) | Validator | none |
| MapDefinition, test track | data | `src/data/definitions/MapDefinition.ts`, `src/data/content/maps.ts` | Roads, buildings, spawn, scenery seed; the 2.6 km `test_track` | Validator | none |
| VehicleDynamics | domain | `src/domain/vehicles/VehicleDynamics.ts` | Deterministic truck model: drivetrain, gearbox, governor, brakes, reverse, understeer (ADR 0002) | VehicleDefinition | none |
| VehicleInput, VehicleRuntimeState | domain | `src/domain/vehicles/` | Device-independent driver input; live truck state | none | none |
| RoadPath | domain | `src/domain/world/RoadPath.ts` | Catmull-Rom centreline shared by driving and rendering | MapDefinition | none |
| DrivingWorld | domain | `src/domain/world/DrivingWorld.ts` | Surfaces, seeded trees, buildings, collisions, map edge | RoadPath, SeededRandom | none |
| DrivingService | systems | `src/systems/driving/DrivingService.ts` | Owns the driven truck and world; steps them every fixed step | ContentCatalog, EventBus | emits `VehicleCollided` |
| TrackView | presentation | `src/presentation/world/TrackView.ts` | Ground, road, markings, instanced trees and buildings (about 10 draw calls) | DrivingWorld, three | none |
| TruckView | presentation | `src/presentation/vehicles/TruckView.ts` | Truck mesh from body data; steering and rolling wheels; pitch and roll | VehicleDefinition, three | none |
| CameraRig | presentation | `src/presentation/cameras/CameraRig.ts` | Chase and cabin cameras (spec §31) | three | none |
| KeyboardInput | platform | `src/platform/input/KeyboardInput.ts` | Arrows/WASD, Space, C (camera) → `VehicleInput` | VehicleInput | none |
| TouchControls | ui | `src/ui/controls/TouchControls.ts` | Steering wheel, gas, brake, camera button, speed and gear readout | VehicleInput | none |

## Planned for the MVP

The system names follow the spec. Placement follows `ARCHITECTURE.md`.

| System | Layer(s) | Step | Responsibility |
|---|---|---|---|
| Cargo content (6–8 types) | data | ⬜ 09 | Full MVP cargo set, trailer requirements |
| PickupZone, DeliveryZone | domain, systems | ⬜ 10–11 | Areas where the truck must stop to load/unload (spec §12) |
| MissionService, MissionInstance, MissionRepository | domain, systems | ⬜ 12 | Available → Accepted → TravellingToPickup → Loaded → Delivering → Completed / Failed (spec §50) |
| HUD | ui | ⬜ 13 | Mission timer, distance, fuel, damage and cargo next to the existing speed readout (spec §30) |
| EconomyService, CurrencyWallet, RewardCalculator, CostCalculator | domain, systems | ⬜ 14 | Credits, rewards, fuel/repair/upgrade costs; UI never edits money (spec §13, §51) |
| CompanyService | systems | ⬜ 14–17 | XP, reputation, company level (spec §14) |
| FuelService | systems | ⬜ 15 | Consumption formula (spec §17), refuelling |
| DamageService | systems | ⬜ 16 | Turns `VehicleCollided` into damage bands and effects; repair (spec §18) |
| Reward screen | ui | ⬜ 17 | Delivery result: base pay, bonuses, penalties, XP, reputation |
| SaveService, storage adapter | systems, platform | ⬜ 18 | Versioned JSON, atomic write, backup, corruption handling, migrations (spec §52) |
| GarageService | systems | ⬜ 19 | Owned trucks, active truck, purchases |
| UpgradeService, UpgradeDefinition | data, systems | ⬜ 20 | Upgrade levels, costs, stat modifiers, level requirements (spec §16) |
| City/world data, region loading | data, systems, presentation | ⬜ 21 | 3-city map, depots, rest areas (fuel / repair / continue) |
| TrafficService | domain, systems, presentation | ⬜ 22 | Waypoint-based, pooled, kinematic NPC vehicles (spec §19) |
| NavigationService | systems, presentation | ⬜ 23 | Waypoint graph routing, GPS arrow, distance, ETA (spec §62–63) |
| WeatherService | systems, presentation | ⬜ 24 | Clear / Cloudy / Rain / Night with small gameplay modifiers (spec §38) |
| EventService (+ road events) | data, domain, systems | ⬜ 25 | Data-driven timed events: requirements, objectives, rewards, modifiers (spec §22–24, §53) |
| TutorialService | systems, ui | ⬜ 26 | Learn-by-playing first 10 minutes (spec §41) |
| AudioService | presentation | ⬜ Phase 7 | Engine, brake, horn, ambience, UI sounds (spec §37) |
| Localization | ui | ⬜ Phase 7 | Turkish + English string tables |
| Android packaging | tooling | ⬜ 28 | Capacitor app built in CI |

## Not in the MVP (spec §44)

FleetService / DriverService (AI drivers), AnalyticsService, AdService, IAPService, OnlineService, multiplayer, licensed brands, second-hand market, tenders. When they come, they enter as interfaces in systems, with implementations in platform.
