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
| GameConfig | data | `src/data/config/GameConfig.ts` | Central tuning values + validation against content; the low, medium and high graphics presets | ContentCatalog | none |
| Company name rules | domain | `src/domain/company/companyName.ts` | Normalise and validate the player's company name | none | none |
| SaveGameData | domain | `src/domain/save/` | Versioned save schema (v6), new-game state, migrations, validation of loaded saves | Definitions | none |
| GameStateService | systems | `src/systems/gameState/` | Owns the top-level flow: booting, mainMenu, companyHq, driving | EventBus, Logger | emits `GameStateChanged` |
| GameBootstrapper | app | `src/app/GameBootstrapper.ts` | Headless composition root: create, validate, initialize, enter main menu | everything above | none |
| RenderHost | presentation | `src/presentation/RenderHost.ts` | WebGL renderer, scene, camera, capped pixel ratio scaled by AdaptiveResolution (one drawing-buffer resize per change), tone mapping, software-rendering fallback | three | none |
| PerfOverlay | ui | `src/ui/debug/PerfOverlay.ts` | `?debug` FPS / draw calls / triangles / pixel ratio, truck position and heading | none | none |
| Browser adapters | platform | `src/platform/browser/` | rAF scheduler, URL config flags (`?debug`, `?log`, `?fuelScale`, `?traffic`, `?weather`, `?date`, `?quality`), fatal error screen, localStorage (or memory when forbidden) | core, data | none |
| Browser entry | entry | `src/main.ts` | Boots services; attaches rendering, input, menus, HUD and the loop; wires the game flow (menu → HQ → driving → result) and pausing; rebuilds the truck view when the player drives another truck; hands the weather to the views | everything | listens `GameStateChanged`, the mission events, `ActiveVehicleChanged` and `WeatherChanged` |

### Driving prototype (Phase 1, roadmap steps 04–08)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| VehicleDefinition | data | `src/data/definitions/VehicleDefinition.ts` | Truck data: body, powertrain, handling; validated (no gearbox hunting) | Validator | none |
| MapDefinition | data | `src/data/definitions/MapDefinition.ts` | Roads (with a kind), buildings, depots, rest areas, spawn, scenery seed | Validator | none |
| VehicleDynamics | domain | `src/domain/vehicles/VehicleDynamics.ts` | Deterministic truck model: drivetrain, gearbox, governor, brakes, reverse, understeer (ADR 0002) | VehicleDefinition | none |
| VehicleInput, VehicleRuntimeState | domain | `src/domain/vehicles/` | Device-independent driver input; live truck state | none | none |
| RoadPath | domain | `src/domain/world/RoadPath.ts` | Catmull-Rom centreline shared by driving and rendering | MapDefinition | none |
| DrivingWorld | domain | `src/domain/world/DrivingWorld.ts` | Surfaces (roads, yards and rest area lots are paved), seeded trees, buildings, depots, rest areas, service points, collisions, map edge | RoadPath, RoadGrid, RoadNetwork, SeededRandom | none |
| RoadGrid | domain | `src/domain/world/RoadGrid.ts`, `gridCells.ts` | The roads' centreline pieces filed by 20 m cell: on a road, or near one, from the few pieces round a point | RoadPath | none |
| DrivingService | systems | `src/systems/driving/DrivingService.ts` | Owns the driven truck and world; steps them every fixed step; cargo mass, parking, recovery onto the road; the service point the truck stands at | ContentCatalog, EventBus | emits `VehicleCollided` |
| EnvironmentView | presentation | `src/presentation/world/EnvironmentView.ts`, `world/lighting.ts` | Gradient sky with sun glow, clouds and horizon hills that follow the camera; fog; sun and sky lights | three | none |
| Procedural textures | presentation | `src/presentation/textures/` | Grass, asphalt, gravel, concrete, facades, livery, rims and soft shadows drawn in code (tileable noise, stroke font): no image files | three | none |
| TrackView | presentation | `src/presentation/world/TrackView.ts` | Pre-lit textured ground; every road in four draw calls, with markings by road kind that stop at junctions; two tree species in 600 m instanced tiles the camera culls; buildings with facades and roofs; soft shadow decals | DrivingWorld, three | none |
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
| RoadNetwork | domain | `src/domain/world/RoadNetwork.ts`, `roadRoute.ts` | The roads joined at shared control points; cached shortest routes to each target; remaining distance and a point to steer toward, without allocating | RoadPath | none |
| MissionService | systems | `src/systems/missions/MissionService.ts` | Job board with what blocks each contract (company level, truck), accepting, loading and unloading in bays, delivery clock, cargo damage (less with cargo protection), reward, abandoning | DrivingService, ContentCatalog, EventBus | listens `VehicleCollided`; emits `MissionStateChanged`, `CargoDamaged`, `MissionCompleted`, `MissionFailed` |
| DepotView | presentation | `src/presentation/world/DepotView.ts` | Concrete yards, bay lines, the beacon over the next bay | three | none |
| MainMenu | ui | `src/ui/menus/MainMenu.ts` | Title screen and language switch | Strings | none |
| CompanyHq | ui | `src/ui/hq/CompanyHq.ts`, `jobCards.ts` | Job board (spec §26, §28): open contracts first, blocked ones say what unlocks them | MissionService offers, Strings | none |
| MissionHud | ui | `src/ui/hud/MissionHud.ts` | Objective, direction arrow and distance, next turn, arrival time, stop hint, loading bar, delivery clock, cargo condition (spec §12, §30, §63) | MissionService, NavigationService, DrivingService | none |
| PauseMenu, ResultDialog | ui | `src/ui/menus/` | Pause (resume, recover, abandon, HQ); the itemised result or the failure reason | Strings | none |
| String tables | ui | `src/ui/i18n/` | Turkish and English text, number, money, distance and time formats; language choice | none | none |

### Economy, upkeep, progression and saving (Phase 3, roadmap steps 14–18)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| CurrencyWallet, costs | domain | `src/domain/economy/` | Whole, non-negative credits; spending returns a Result; fuel and repair prices rounded up | none | none |
| Fuel and damage rules | domain | `src/domain/vehicles/fuelConsumption.ts`, `vehicleDamage.ts` | Spec §17 fuel formula; spec §18 damage bands, impact damage, weakened engine and brakes | VehicleDefinition | none |
| Company progression, delivery XP | domain | `src/domain/company/companyProgress.ts`, `src/domain/missions/missionProgress.ts` | Levels from XP (spec §14); XP and reputation for a delivery, reputation lost on failure | GameConfig | none |
| Save migrations and validation | domain | `src/domain/save/saveMigrations.ts`, `validateSaveGameData.ts` | Upgrade old saves (v1 → … → v6), refuse newer ones, check every field and reference | ContentCatalog | none |
| EconomyService | systems | `src/systems/economy/EconomyService.ts` | The only owner of money (spec §13, §51): pays deliveries, spends, prices fuel and repairs | EventBus | listens `MissionCompleted`; emits `MoneyChanged` |
| FuelService | systems | `src/systems/vehicles/FuelService.ts` | Burns fuel per fixed step; stalls an empty engine; refuels at the pump or on the road; emergency fuel; tank and consumption upgrades | DrivingService, DamageService, EconomyService | emits `FuelChanged`, `Refuelled` |
| DamageService | systems | `src/systems/vehicles/DamageService.ts` | Truck damage from collisions (spec §18), performance penalty, paid repairs | DrivingService, EconomyService | listens `VehicleCollided`; emits `VehicleDamaged`, `VehicleRepaired` |
| CompanyService | systems | `src/systems/company/CompanyService.ts` | Name, XP, level, reputation, statistics | EventBus, GameConfig | listens `MissionCompleted`, `MissionFailed`; emits `CompanyProgressed`, `CompanyLevelUp` |
| SaveService | systems | `src/systems/save/SaveService.ts` | Versioned JSON saves (spec §32, §52): atomic write, backup, corruption handling, migrations | KeyValueStorage, ContentCatalog | none |
| GameSessionService | systems | `src/systems/session/GameSessionService.ts` | New game or continue; hands each save section to its owner; autosaves | every Phase 3 service, DrivingService, MissionService, GarageService, EventService, TutorialService | listens to the mission, purchase, truck, tutorial and state events to save |
| NewCompanyDialog | ui | `src/ui/menus/NewCompanyDialog.ts` | Name the company (spec §41) | Strings | none |
| Company HQ (finances, truck) | ui | `src/ui/hq/CompanyHq.ts` | Company card, truck card (refuel, repair), level-locked job board | Phase 3 services (read only) | none |
| Toasts | ui | `src/ui/hud/Toasts.ts` | Short notices (level-up, fuel, damage, purchases, the weather turning, events) | none | none |

### Garage and upgrades (Phase 5, roadmap steps 19–20)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Truck roster | data | `src/data/content/vehicles.ts` | H1 light box, H2 medium refrigerated, H3 heavy flatbed (spec §15), with prices and unlock levels; tuned per class | VehicleDefinition | none |
| UpgradeDefinition, upgrades | data | `src/data/definitions/UpgradeDefinition.ts`, `src/data/content/upgrades.ts` | Upgrade levels with cost, unlock level and stat modifiers (spec §16); engine, brakes, tyres, suspension, fuel tank | Validator | none |
| Upgrade bonuses, performance factors | domain | `src/domain/vehicles/upgradeBonuses.ts`, `performance.ts` | A truck's stat bonuses from its fitted levels; engine, brake, grip and stability factors | UpgradeDefinition | none |
| GarageService | systems | `src/systems/vehicles/GarageService.ts` | The company's trucks and the active one (spec §32 GarageState); the dealer; switching in place; fits the active truck's upgrades to driving, fuel and missions | DrivingService, MissionService, FuelService, DamageService, EconomyService | emits `VehiclePurchased`, `ActiveVehicleChanged` |
| UpgradeService | systems | `src/systems/vehicles/UpgradeService.ts` | The upgrade shop: the next level of each upgrade for the active truck | GarageService, EconomyService | emits `UpgradePurchased` |
| HQ garage and upgrade tabs | ui | `src/ui/hq/CompanyHq.ts`, `garageCards.ts`, `upgradeCards.ts` | Buy and switch trucks; buy upgrade levels; each card says what it costs or unlocks it | GarageService, UpgradeService (read only) | none |

### The 3-city region (Phase 4, roadmap step 21)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| north_valley | data | `src/data/content/maps.ts` | Yeniliman (A), Demirkent (B, ring road), Başakova (C); the highway with a rest area; country roads; 11.5 km of road | MapDefinition | none |
| Service points | domain, systems | `DrivingWorld.servicePointAt`, `DrivingService.servicePoint` | Depot yards and rest area lots: the only places with a pump and a workshop | DrivingWorld | none |
| FuelService, DamageService (service rule) | systems | `src/systems/vehicles/` | Pump refuelling and repairs only at a service point; the fuel truck anywhere | DrivingService | as above |
| RestAreaView | presentation | `src/presentation/world/RestAreaView.ts`, `groundDecals.ts` | Concrete lot, parking stalls, fuel canopy, pumps and price sign (three draw calls) | DrivingWorld, three | none |
| RestAreaPanel | ui | `src/ui/hud/RestAreaPanel.ts` | The counter (spec §25): fuel, repair, continue, while the truck stands on the lot | DrivingService, FuelService, DamageService (read only) | none |

### Traffic (Phase 4, roadmap step 22)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| TrafficVehicleDefinition, trafficVehicles | data | `src/data/definitions/TrafficVehicleDefinition.ts`, `src/data/content/trafficVehicles.ts` | Kinds of NPC vehicle (spec §19: car, minibus, lorry, bus): size, share of the speed limit, pull-away, how common, paint colours | Validator | none |
| GameConfig.traffic | data | `src/data/config/GameConfig.ts` | How many vehicles, how far round the truck, speed limits by road kind | ROAD_KINDS | none |
| Lanes, turning circles | domain | `src/domain/world/lanes.ts`, `DrivingWorld.turningCircles`, `RoadNetwork.junctions` / `deadEnds` | Right-hand lanes by road kind; a paved circle at every dead end; which roads meet at each junction | RoadPath | none |
| LaneGraph | domain | `src/domain/traffic/LaneGraph.ts` | Waypoint links: lanes between junctions, turns across junctions (which conflict), U-turns round turning circles; advisory speeds for bends | DrivingWorld, RoadNetwork | none |
| TrafficSimulation | domain | `src/domain/traffic/TrafficSimulation.ts` | The vehicles (flat arrays, seeded): cruise, follow (IDM), stop, avoid, change lane, turn, emergency stop; spawning out of sight and recycling; collision circles | LaneGraph, TrafficVehicleDefinition | none (DrivingWorld reports hits to it) |
| Moving obstacles | domain | `DrivingWorld.resolveCollisions(…, obstacles)` | The truck against traffic: pushed out, carried along by a vehicle it rear-ends, impact only when it drives into one | MovingObstacles | none |
| TrafficService | systems | `src/systems/traffic/TrafficService.ts` | Lanes per map, one simulation per drive, stepped before the truck; makes it the truck's moving obstacles | DrivingService, ContentCatalog | none (crashes emit `VehicleCollided` through DrivingService) |
| TrafficView | presentation | `src/presentation/traffic/TrafficView.ts` | Low-poly car, van, lorry and bus shapes, one instanced mesh per kind, painted per vehicle, interpolated between steps; all their lamps in one more, glowing at night | TrafficSimulation (read only), three | none |

### Navigation (Phase 4, roadmap step 23)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Route trace | domain | `RoadNetwork.trace`, `createRouteTrace` | The route by road as samples, its length and how long it takes at each road's pace; allocation-free | RoadNetwork | none |
| Manoeuvres | domain | `src/domain/navigation/manoeuvre.ts` | The next thing to do along a route: turn left or right onto another road, turn round, arrive | RouteTrace | none |
| NavigationService | systems | `src/systems/navigation/NavigationService.ts` | GPS (spec §62–63): route to the contract's next bay ten times a second; distance, arrival time, next turn, a point ahead for the arrow | DrivingService, MissionService, GameConfig.navigation | none |
| GpsRouteView | presentation | `src/presentation/navigation/GpsRouteView.ts` | The route as a translucent band in the right-hand lane, 700 m ahead and into the yard; one draw call, buffers allocated once | NavigationService (read only), three | none |

### Weather (Phase 4, roadmap step 24)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| WeatherDefinition, weather | data | `src/data/definitions/WeatherDefinition.ts`, `src/data/content/weather.ts` | Clear, cloudy, rain, night (spec §38): how likely and how long, grip, traffic speed, and the look (sky, haze, light, clouds, rain, lamps) | Validator | none |
| GameConfig.weather | data | `src/data/config/GameConfig.ts` | The first weather, whether it changes, how long a change takes; `?weather=id` fixes it | ContentCatalog | none |
| WeatherService | systems | `src/systems/weather/WeatherService.ts` | Seeded schedule of weathers, blended changes; the truck's grip (a DrivingService performance modifier) and traffic speed; blended rain and lamps for the views | DrivingService, TrafficService, ContentCatalog | emits `WeatherChanged` |
| Weather look | presentation | `EnvironmentView.applyWeather`, `world/lighting.ts` (`PrelitMaterials`) | Sky, haze, sun and sky light, clouds; relights the pre-lit ground and fades baked shadows | three | none |
| RainView | presentation | `src/presentation/weather/RainView.ts` | Rain streaks round the camera, animated on the GPU, one draw call; more of them the harder it rains | three | none |
| Night lamps | presentation | `vehicles/LampGlows.ts`, `TruckView.setLamps`, `TrafficView.setLamps`, `TrackView.setLamps` | Glowing lamps, the truck's headlights on the road ahead, lit windows | three | none |

### Special events (Phase 6, roadmap step 25)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| EventDefinition, events | data | `src/data/definitions/EventDefinition.ts`, `src/data/content/events.ts` | Express Week, Safe Driver, Heavy Cargo (spec §78): schedule, company level, qualifying deliveries, objective, reward, pay bonus | Validator | none |
| Event rules | domain | `src/domain/events/eventSchedule.ts`, `eventRules.ts` | Which run of an event is on (or next); whether a delivery qualifies; bonus and progress | EventDefinition | none |
| EventService | systems | `src/systems/events/EventService.ts` | Counts deliveries toward the running events, pays bonuses and rewards (spec §22–23, §53); the save's event progress | ContentCatalog, CompanyService, EconomyService, Clock | listens `MissionCompleted`; emits `EventProgressed` |
| HQ events tab | ui | `src/ui/hq/eventCards.ts`, `eventText.ts` | The events with their terms, bonus, progress, reward and time left; job cards mark contracts whose cargo counts | EventService (read only) | none |

### Tutorial (Phase 7, roadmap step 26)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Tutorial steps | domain | `src/domain/tutorial/tutorialSteps.ts` | Spec §41's first ten minutes as steps, and what moves each on | none | none |
| TutorialService | systems | `src/systems/tutorial/TutorialService.ts` | The step the company is on, followed through the game's events; skip; the save's step | EventBus | listens `MissionStateChanged`, `MissionCompleted`, `MissionFailed`, `UpgradePurchased`; emits `TutorialStepChanged` |
| TutorialHint | ui | `src/ui/hud/TutorialHint.ts`, styles.css | One short hint (in the HQ above the list, on the road under the HUD) and a skip button; the control it is about glows | TutorialService (read only) | none |

### Performance (Phase 7, roadmap step 27)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Graphics presets | data | `QUALITY_PRESETS`, `applyQualityPreset` in `src/data/config/GameConfig.ts` | Low, medium, high: pixel ratio cap, resolution floor, rain density, lamp glows, traffic | none | none |
| Device quality, device settings | platform | `src/platform/browser/deviceQuality.ts`, `deviceSettings.ts` | The preset a device can carry (cores, memory, phone or not); which one to play (`?quality=`, the setting, the device); the phone's own settings, kept apart from the save | GameConfig, KeyValueStorage | none |
| AdaptiveResolution | presentation | `src/presentation/AdaptiveResolution.ts` | Lowers the resolution when frames run slow, raises it when they are quick again (a 30 FPS floor) | none | none |
| SettingsDialog | ui | `src/ui/menus/SettingsDialog.ts` | Settings from the main menu: the graphics preset (auto, low, medium, high) and the one in use | Strings | none |

## Planned for the MVP

The system names follow the spec. Placement follows `ARCHITECTURE.md`.

| System | Layer(s) | Step | Responsibility |
|---|---|---|---|
| Region streaming | data, presentation | ⬜ later | Load regions on demand (spec §21) once the world has more than one |
| Road events | data, domain, systems | ⬜ later | Random road events: road works, jams, detours (spec §24) |
| AudioService | presentation | ⬜ Phase 7 | Engine, brake, horn, ambience, UI sounds (spec §37) |
| More settings, more languages | ui | ⬜ Phase 7 | Language and sound in Settings (graphics are there since step 27); more string tables |
| Android packaging | tooling | ⬜ 28 | Capacitor app built in CI |

## Not in the MVP (spec §44)

FleetService / DriverService (AI drivers), AnalyticsService, AdService, IAPService, OnlineService, multiplayer, licensed brands, second-hand market, tenders. When they come, they enter as interfaces in systems, with implementations in platform.
