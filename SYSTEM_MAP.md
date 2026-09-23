# RoadHaul System Map

Every system, the layer that owns it, and its status. Update this file whenever a system is added, moved or finished (`CLAUDE.md` rule: every new system has a clear owner).

Status: ✅ implemented · 🧩 placeholder (structure only, content or tuning pending) · ⬜ planned (roadmap step in brackets)

## Implemented (Phase 0: foundation)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| ServiceContainer | core | `src/core/services/ServiceContainer.ts` | Typed service registry; ordered `initialize` / reverse `dispose` | none | none |
| EventBus | core | `src/core/events/EventBus.ts` | Typed pub/sub; in-order delivery of events raised by handlers; immediate unsubscribe; isolates handler errors | Logger | carries `GameEvents` |
| Logger, ConsoleLogger | core | `src/core/logging/` | Levelled, categorised logging to an injected sink | none | none |
| Clock | core | `src/core/time/Clock.ts` | Injectable wall-clock time | none | none |
| FixedTimestep, GameLoop | core | `src/core/time/` | 60 Hz fixed simulation steps + per-frame updates; clamps and caps catch-up | FrameScheduler | none |
| Validator | core | `src/core/validation/Validator.ts` | Collects every validation issue; throws `ValidationError` | none | none |
| Definitions 🧩 | data | `src/data/definitions/` | Vehicle, cargo, city and mission definitions + field validation | Validator | none |
| Built-in content 🧩 | data | `src/data/content/` | 1 truck, 2 cargo types, 3 cities, 2 missions (placeholders) | Definitions | none |
| ContentCatalog | data | `src/data/ContentCatalog.ts` | Validates content and cross-references; frozen id lookups | Definitions | none |
| GameConfig | data | `src/data/config/GameConfig.ts` | Central tuning values + validation against content | ContentCatalog | none |
| Company name rules | domain | `src/domain/company/companyName.ts` | Normalise and validate the player's company name | none | none |
| SaveGameData 🧩 | domain | `src/domain/save/` | Versioned save schema (v1) + new-game state | Definitions | none |
| GameStateService | systems | `src/systems/gameState/` | Owns the top-level flow: booting, mainMenu, companyHq, driving | EventBus, Logger | emits `GameStateChanged` |
| GameBootstrapper | app | `src/app/GameBootstrapper.ts` | Headless composition root: create, validate, initialize, enter main menu | everything above | none |
| RenderHost | presentation | `src/presentation/RenderHost.ts` | WebGL renderer, scene, camera, capped pixel ratio | three | none |
| PlaceholderWorldView 🧩 | presentation | `src/presentation/world/` | Stand-in road + truck scene with an orbiting camera | RenderHost | none |
| PerfOverlay | ui | `src/ui/debug/PerfOverlay.ts` | `?debug` FPS / draw calls / triangles / pixel ratio | none | none |
| Browser adapters | platform | `src/platform/browser/` | rAF scheduler, URL config flags, fatal error screen | core, data | none |
| Browser entry | entry | `src/main.ts` | Boots services, attaches rendering and the loop, exposes boot state to e2e | everything | listens `GameStateChanged` |

## Planned for the MVP

The system names follow the spec. Placement follows `ARCHITECTURE.md`.

| System | Layer(s) | Step | Responsibility |
|---|---|---|---|
| VehicleDefinition (physics data), VehicleRuntimeState | data, domain | ⬜ 04 | Mass, engine, gearbox, brakes, steering, wheels; per-truck fuel/damage/upgrades state |
| PhysicsWorld, VehicleController | simulation | ⬜ 05 | Rapier world; raycast-vehicle driving (accelerate, brake, steer, reverse, speed limit) |
| VehicleView | presentation | ⬜ 05 | Truck mesh following the simulated body (interpolated) |
| VehicleCameraController | presentation | ⬜ 06 | Third-person and cabin cameras (spec §31) |
| VehicleInput, touch/keyboard controls | domain (input state), platform (devices), ui (on-screen wheel, gas, brake) | ⬜ 07 | Device-independent driver input (spec §30) |
| Test road | data, presentation | ⬜ 08 | First drivable road built from data |
| Cargo content (6–8 types) | data | ⬜ 09 | Full MVP cargo set, trailer requirements |
| PickupZone, DeliveryZone | simulation, systems | ⬜ 10–11 | Trigger areas; "stop to load/unload" (spec §12) |
| MissionService, MissionInstance, MissionRepository | domain, systems | ⬜ 12 | Available → Accepted → TravellingToPickup → Loaded → Delivering → Completed / Failed (spec §50) |
| HUD | ui | ⬜ 13 | Speed, fuel, damage, cargo, timer, distance (spec §30) |
| EconomyService, CurrencyWallet, RewardCalculator, CostCalculator | domain, systems | ⬜ 14 | Credits, rewards, fuel/repair/upgrade costs; UI never edits money (spec §13, §51) |
| CompanyService | systems | ⬜ 14–17 | XP, reputation, company level (spec §14) |
| FuelService | systems | ⬜ 15 | Consumption formula (spec §17), refuelling |
| DamageService | systems | ⬜ 16 | Collision damage bands and effects, repair (spec §18) |
| Reward screen | ui | ⬜ 17 | Delivery result: base pay, bonuses, penalties, XP, reputation |
| SaveService, storage adapter | systems, platform | ⬜ 18 | Versioned JSON, atomic write, backup, corruption handling, migrations (spec §52) |
| GarageService | systems | ⬜ 19 | Owned trucks, active truck, purchases |
| UpgradeService, UpgradeDefinition | data, systems | ⬜ 20 | Upgrade levels, costs, stat modifiers, level requirements (spec §16) |
| City/world data, region loading | data, systems, presentation | ⬜ 21 | 3-city map, depots, rest areas (fuel / repair / continue) |
| TrafficService | simulation, presentation | ⬜ 22 | Waypoint-based, pooled NPC vehicles (spec §19) |
| NavigationService | systems, presentation | ⬜ 23 | Waypoint graph routing, GPS arrow, distance, ETA (spec §62–63) |
| WeatherService | systems, presentation | ⬜ 24 | Clear / Cloudy / Rain / Night with small gameplay modifiers (spec §38) |
| EventService (+ road events) | data, domain, systems | ⬜ 25 | Data-driven timed events: requirements, objectives, rewards, modifiers (spec §22–24, §53) |
| TutorialService | systems, ui | ⬜ 26 | Learn-by-playing first 10 minutes (spec §41) |
| AudioService | presentation | ⬜ Phase 7 | Engine, brake, horn, ambience, UI sounds (spec §37) |
| Localization | ui | ⬜ Phase 7 | Turkish + English string tables |
| Android packaging | tooling | ⬜ 28 | Capacitor app built in CI |

## Not in the MVP (spec §44)

FleetService / DriverService (AI drivers), AnalyticsService, AdService, IAPService, OnlineService, multiplayer, licensed brands, second-hand market, tenders. When they come, they enter as interfaces in systems, with implementations in platform.
