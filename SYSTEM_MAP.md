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
| FixedTimestep, GameLoop | core | `src/core/time/` | 60 Hz fixed simulation steps + per-frame updates; clamps and caps catch-up (the simulation's may reach further than the animation's, as drawn in software) | FrameScheduler | none |
| Validator | core | `src/core/validation/Validator.ts` | Collects every validation issue; throws `ValidationError` | none | none |
| Math helpers, SeededRandom | core | `src/core/math/`, `src/core/random/` | Allocation-free scalar helpers; deterministic random numbers | none | none |
| ContentCatalog | data | `src/data/ContentCatalog.ts` | Validates content and cross-references; frozen id lookups | Definitions | none |
| GameConfig | data | `src/data/config/GameConfig.ts` | Central tuning values + validation against content; the low, medium and high graphics presets | ContentCatalog | none |
| Company name rules | domain | `src/domain/company/companyName.ts` | Normalise and validate the player's company name | none | none |
| SaveGameData | domain | `src/domain/save/` | Versioned save schema (v6), new-game state, migrations, validation of loaded saves | Definitions | none |
| GameStateService | systems | `src/systems/gameState/` | Owns the top-level flow: booting, mainMenu, driving (the company HQ is a panel over the game, not a state) | EventBus, Logger | emits `GameStateChanged` |
| GameBootstrapper | app | `src/app/GameBootstrapper.ts` | Headless composition root: create, validate, initialize, enter main menu | everything above | none |
| RenderHost | presentation | `src/presentation/RenderHost.ts` | WebGL renderer, scene, camera, capped pixel ratio scaled by AdaptiveResolution (one drawing-buffer resize per change), tone mapping, software-rendering fallback, the colour pass where the preset and GPU allow | three | none |
| PostProcessing | presentation | `src/presentation/PostProcessing.ts` | The colour pass: half-float scene target (MSAA on high), bloom (dual filter, five levels), ACES tone mapping, the weather's grade (`EnvironmentView.grade`), vignette, dither, FXAA without MSAA; the sun's glare and the lens's ghosts where it shows (read from the bloom's most blurred level at its place, `sunOnPicture`); the sun's shafts, the light round it streaked out through the gaps between what stands before it, less what shines round it every way (three small passes while they show) | three (+ its FXAA shader) | none |
| PerfOverlay | ui | `src/ui/debug/PerfOverlay.ts` | The performance display (`?debug`, or switched on in Settings): FPS / draw calls / triangles / pixel ratio, truck position and heading, the graphics preset and GPU | none | none |
| Browser adapters | platform | `src/platform/browser/` | rAF scheduler, URL config flags (`?debug`, `?log`, `?fuelScale`, `?traffic`, `?weather`, `?time`, `?date`, `?quality`, `?post`, `?lamps`, `?glass`, `?spawn`), fatal error screen, localStorage (or memory when forbidden) | core, data | none |
| Browser entry | entry | `src/main.ts` | Boots services; attaches rendering, input, menus, HUD and the loop; wires the game flow (menu → road → company panel → driving → result), pausing (also when the player leaves), the panel holding the truck, and the back button; rebuilds the truck view when its model, paint, parts or the garage's preview change; hands the weather to the views | everything | listens `GameStateChanged`, the mission events, the purchase events, `ActiveVehicleChanged` and `WeatherChanged` |

### Driving prototype (Phase 1, roadmap steps 04–08)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| VehicleDefinition | data | `src/data/definitions/VehicleDefinition.ts` | Truck data: body, powertrain, handling; validated (no gearbox hunting) | Validator | none |
| MapDefinition | data | `src/data/definitions/MapDefinition.ts` | Roads (with a kind), buildings, depots, rest areas, name boards, fields, wind turbines, the sea (shoreline, quays, boats, cranes), spawn, scenery seed and what scenery to place (street lamps, the towns' streetscape, the countryside); `shorelineXAt`, `isInSea` | Validator | none |
| VehicleDynamics | domain | `src/domain/vehicles/VehicleDynamics.ts` | Deterministic truck model: drivetrain, gearbox with a clutch, governor, brakes, reverse, understeer (ADR 0002); speed-sensitive, paced, self-centring steering, the path turning in over a moment, pedals that press in smoothly | VehicleDefinition | none |
| VehicleInput, VehicleRuntimeState | domain | `src/domain/vehicles/` | Device-independent driver input, with the gear lever (auto, D or R) and how the truck reads the pedals for it; live truck state | none | none |
| RoadPath | domain | `src/domain/world/RoadPath.ts` | Catmull-Rom centreline shared by driving and rendering | MapDefinition | none |
| DrivingWorld | domain | `src/domain/world/DrivingWorld.ts` | Surfaces (roads, pavements, yards and rest area lots are paved), seeded trees, street lamps along the town roads, the towns' streetscape and the countryside (below), the cities' name boards, farm fields beside their roads with seeded hay bales, wind turbines, guard rails on the sharp bends out of town (`guardRails.ts`), the sea (water west of the shoreline, paved quays, boats, cranes, seeded boulders along the shore), buildings, depots, rest areas, service points, collisions (trunks, posts, bales, towers and crane legs are solid circles filed by grid cell; the guard rails and the shore are walls), map edge | RoadPath, RoadGrid, RoadNetwork, SeededRandom | none |
| RoadGrid | domain | `src/domain/world/RoadGrid.ts`, `gridCells.ts` | The roads' centreline pieces filed by 20 m cell: on a road, or near one, from the few pieces round a point | RoadPath | none |
| Townscape | domain | `src/domain/world/townscape.ts` | Placed once from the roads (map flag `scenery.streetscape`): pavements with kerbs along the town streets, broken where a road crosses or a yard opens off it (`PavementGrid` says where they are: paved ground); benches, bins and a bus shelter on each street; billboards on the roads into the towns; speed limits where they enter | RoadPath, Occupancy | none |
| Countryside | domain | `src/domain/world/countryside.ts` | Placed once from the map's seed (map flag `scenery.countryside`): power lines along the country roads, fences and dry-stone walls along the fields (each with a gate), boulders, flocks of sheep and herds of cows, poplar windbreaks, olive groves and cypresses; all clear of the roads, fields and of one another (`Occupancy`); the solid ones stop the truck | RoadPath, SeededRandom | none |
| DrivingService | systems | `src/systems/driving/DrivingService.ts` | Owns the driven truck and world; steps them every fixed step; cargo mass, parking, recovery onto the road; the service point the truck stands at | ContentCatalog, EventBus | emits `VehicleCollided` |
| EnvironmentView | presentation | `src/presentation/world/EnvironmentView.ts`, `world/lighting.ts` | Gradient sky with sun glow, drifting billboard cumulus lit in the shader and two ridges of hazy hills that follow the camera; twinkling stars and the moon at night; at twilight the Earth's shadow and the Belt of Venus opposite the sun; at night each town's dome of light on the horizon; a rainbow opposite a low sun in rain passing or just gone (`setWetness`); lightning's flash over the sky, the clouds and the world (`setLightning`); fog (thinned for the colour pass); sun and sky lights, with real-time shadows round the truck on the high preset; the morning mist over the sky's horizon and the hills (`setMist`; its `Mist` for the world's materials); the weather's colour grade; where the sun is and how it may glare and send shafts, for the colour pass | three | none |
| Procedural textures | presentation | `src/presentation/textures/` | Grass, asphalt, gravel, concrete, facades, livery, rims, soft shadows, the cloud shadows' map, the cab's atlas (`cabImages.ts`) and the scenery's (`propImages.ts`: posters of original local businesses, speed limits, the bus stop sign, dry stone, paving) drawn in code (tileable noise, stroke font, `drawing.ts`'s anti-aliased shapes): no image files | three | none |
| TrackView | presentation | `src/presentation/world/TrackView.ts`, `world/buildingParts.ts` | Pre-lit textured ground that does not repeat in a grid (two samplings of the grass, meadow blotches); every road in four draw calls, with markings by road kind that stop at junctions and zebra crossings where city streets meet; wild pines and broadleaves and the planted poplars, olives and cypresses in 600 m instanced tiles the camera culls, their crowns swaying in the wind; buildings with facades on stone plinths, under tiled hipped, flat or metal gable roofs, with rooftop tanks, solar heaters and plant; soft shadow decals; the asphalt darkens and mirrors the sky while wet (setWetness), its dips filling with puddles that mirror it like glass (`world/puddles.ts`) and ring in the rain (setRain) | DrivingWorld, three | none |
| TruckView | presentation | `src/presentation/vehicles/TruckView.ts`, `vehicles/truckShapes.ts` | Detailed cab-over truck from body data, merged per material: a cab rounded at the corners and the roof's edge, skirts arched over the front wheels, sun visor with marker lamps, horns, door seams, handles and steps, a chrome-framed grille and badge, headlamp clusters in a black apron, fog lamps, mirrors with wide-angle ones, air tanks, rounded tyres round set-in rims, livery, rails, hinges and marker lamps on the box and a fairing over the cab; box, refrigerated (cooling unit) or flatbed body (deck, headboard, a load shown while loaded); tandem rear axle for heavy trucks; an exhaust stack behind the cab (where the exhaust comes from); steering and rolling wheels; pitch and roll on a damped spring; the cab's inside for the cabin camera (`CabInterior`, built the first time it is seen), the body kept level in the cabin view; the upgraded parts by level (stacks, tank, rims, calipers, stance); paint, glass and chrome mirror the sky (`world/skyReflection.ts`); where its headlamps shine from, for `LampLighting`, and its lamps and body for `WetReflections` | VehicleDefinition, three | none |
| CabInterior | presentation | `src/presentation/vehicles/CabInterior.ts`, `cabinShading.ts`, `textures/cabImages.ts` | The cab's inside in one atlas: dashboard, instrument cluster with live needles and a seven-segment display (speed, rpm, fuel, temperature, the time and the gear), the navigation screen, a steering wheel turning with the front wheels, pedals, seats, pillars, sun visors, the radio, a nazar charm swinging on its cord, mirrors painted with the road behind; lit by the sky through the glass and the key light through the windows, the instruments glowing at night | TruckView, EnvironmentView.light, three | none |
| Wipers | presentation | `src/presentation/vehicles/Wipers.ts` | The windscreen's two wipers: parked when dry, sweeping (with a pause in light rain, none in heavy) and finishing a sweep when it stops; raindrops on the glass that the blades wipe away (how long since the blade passed each spot, analytically) | three | none |
| CameraRig | presentation | `src/presentation/cameras/CameraRig.ts`, `vehicles/cabGeometry.ts` | Chase, cabin, hood, rear and top cameras (spec §31), fitted to the truck's size; the chase camera looks along the bend, the cabin looks into bends and the head sways; any camera turns by the player's drag; a camera circling the parked truck behind the menus, framed beside the company panel and swinging round to a previewed part; the view ahead widens a little with speed | three | none |
| LookAround | ui | `src/ui/controls/LookAround.ts` | Dragging across the road turns the camera (within its limits); it turns back ahead after the finger lifts (DOM-free, unit-tested) | none | none |
| KeyboardInput | platform | `src/platform/input/KeyboardInput.ts` | Arrows/WASD, Space, C (camera), H (horn), M (map), Escape/P (pause) → `VehicleInput` | VehicleInput | none |
| TouchControls | ui | `src/ui/controls/TouchControls.ts` | SVG steering wheel (full lock at a quarter turn), gas and brake pedals, the D/R gear button, camera button, speed dial and gear readout; the way of steering picked in Settings (the wheel, the tilt button with the brake under the left thumb, or left/right buttons) and the control size | VehicleInput, controls settings | none |

### Mission loop (Phase 2, roadmap steps 09–13)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Cargo, BodyType | data | `src/data/definitions/CargoDefinition.ts`, `BodyType.ts`, `src/data/content/cargo.ts` | Eight cargo types (spec §11) with the truck body each needs (box, refrigerated, flatbed) | Validator | none |
| Depots | data | `DepotDefinition` in `src/data/definitions/MapDefinition.ts` | A paved yard and loading bay per city, validated against cities and missions | Validator | none |
| Missions (content) | data | `src/data/content/missions.ts` | Twenty contracts (spec §43, §77): ten for the starting truck, ten for the H2 and H3 | ContentCatalog | none |
| Mission rules | domain | `src/domain/missions/` | Bay parking, the `MissionInstance` stages (spec §50), cargo damage, itemised reward (spec §64), the contract generator (spec §28–29) | Definitions, SeededRandom | none |
| DailyContracts | systems | `src/systems/missions/DailyContracts.ts` | Contracts of the day: a generated batch for the map every 6 h of the clock (`GameConfig.missions.dailyContracts`) | ContentCatalog, DrivingService (the map and its roads), Clock | none |
| RoadNetwork | domain | `src/domain/world/RoadNetwork.ts`, `roadRoute.ts` | The roads joined at shared control points; cached shortest routes to each target; remaining distance and a point to steer toward, without allocating | RoadPath | none |
| MissionService | systems | `src/systems/missions/MissionService.ts` | Job board (the game's own contracts and the contracts of the day) with what blocks each contract (company level, truck), accepting, loading and unloading in bays, delivery clock, cargo damage (less with cargo protection), reward, abandoning | DrivingService, ContentCatalog, EventBus, DailyContracts | listens `VehicleCollided`; emits `MissionStateChanged`, `CargoDamaged`, `MissionCompleted`, `MissionFailed` |
| DepotView | presentation | `src/presentation/world/DepotView.ts` | Concrete yards, bay lines, the beacon over the next bay | three | none |
| RoadFurnitureView | presentation | `src/presentation/world/RoadFurnitureView.ts` | Delineator posts along the country roads and the highway (those near the truck drawn), their amber reflectors shining in the truck's headlights at night; road studs on the highway's centre and edge lines that light up the same way (drawn flat in the road's layers, never smaller than a couple of pixels); the world's guard rails in galvanised steel that mirrors the sky; three instanced draw calls and one per 600 m rail tile | DrivingWorld (read only), three | none |
| Pedestrians | domain | `src/domain/world/pedestrians.ts` | The towns' people, placed once from a seed: 3.5 walkers per 100 m of pavement, each up and down its stretch at their own pace keeping to their right, and one to three waiting at every bus stop; where each is comes from the time alone (`walkerAt`); how thin the crowd is decides who is out (`crowdShows`) | RoadPath, Townscape (pavements, bus stops) | none |
| PedestrianView | presentation | `src/presentation/world/PedestrianView.ts` | The nearest people within 140 m in one instanced mesh: low-poly and original, clothes, skin and hair from palettes by their look, the walk (legs, arms, bob) in the vertex shader; fewer out at night and in the rain, their umbrellas open in the rain; lit like the world, the lamps too; 40, 80 or 140 at most by preset; nothing collides with them | Pedestrians, three | none |
| SceneryView | presentation | `src/presentation/world/SceneryView.ts` | The townscape and the countryside drawn: power poles and their wires (screen-widened ribbons, at least a pixel wide), fences, dry-stone walls, boulders, pavements and kerbs, benches, bins, bus shelters, billboards, speed limit signs, stamped from shared parts and merged per 600 m tile over one atlas; grazing sheep and cows (instanced, their heads animated, allocation-free) | DrivingWorld (read only), three | none |
| RoadsideView | presentation | `src/presentation/world/RoadsideView.ts` | Grass tufts, flowers and bushes on the verges, scattered once into cells; three instanced meshes holding only the plants near the camera, pre-lit, swaying in the wind | DrivingWorld (read only), three | none |
| StreetLampView | presentation | `src/presentation/world/StreetLampView.ts` | Street lamps: instanced posts and lenses (two draw calls); at night the lenses light and glow (one more, left out on the low preset); where each lamp shines from and the way it faces, for `LampLighting` | DrivingWorld, LampGlows, three | none |
| FarmlandView | presentation | `src/presentation/world/FarmlandView.ts` | Farm fields (pre-lit, one texture of crop rows tinted per crop: one draw call) and instanced hay bales (one) | DrivingWorld, three | none |
| WindTurbineView | presentation | `src/presentation/world/WindTurbineView.ts` | Wind turbines: instanced towers and turning rotors (two draw calls); red warning lights blink at night (one more, left out on the low preset) | DrivingWorld, LampGlows, three | none |
| BirdsView | presentation | `src/presentation/world/BirdsView.ts` | Crows circling over the fields and gulls over the harbour, wings beating; one instanced draw call by day, none at night or in the rain | DrivingWorld, three | none |
| SeaView | presentation | `src/presentation/world/SeaView.ts` | The sea: water that mirrors the sky (shared uniforms from EnvironmentView) with drifting ripples, glitter and foam, sparkling facets that lay a glittering path toward a low sun or the moon, fogged; a pre-lit sandy beach; boulders instanced per 600 m of shore | DrivingWorld, EnvironmentView, three | none |
| HarbourView | presentation | `src/presentation/world/HarbourView.ts` | The quays (pre-lit concrete; kerb, bollards and a yellow line), the portal cranes, merged, and the moored boats rocking gently; masthead and warning lights glow at night | DrivingWorld, LampGlows, three | none |
| CitySignView | presentation | `src/presentation/world/CitySignView.ts` | The cities' name boards: posts and backs, and faces sharing one texture with a row per name in Turkish capitals (two draw calls); they glow a little by day, more at night | DrivingWorld, three | none |
| MainMenu | ui | `src/ui/menus/MainMenu.ts` | Title screen and language switch | Strings | none |
| CompanyHq | ui | `src/ui/hq/CompanyHq.ts`, `jobCards.ts` | The company panel over the road (spec §26): the company, credits, map and close at the top, four tabs, one scrolling list; the job board (spec §28): open contracts first, the contracts of the day first in each group and marked, with when the next ones come; blocked ones say what unlocks them; a busy company is told to finish its contract first | MissionService offers, DailyContracts, Strings | none |
| HudDock | ui | `src/ui/hud/HudDock.ts` | The road's buttons to the panel's pages (Jobs, Truck, Garage, Events); compact during a contract | Strings | none |
| Icons | ui | `src/ui/icons.ts`, `src/ui/hq/truckSilhouette.ts` | Line icons for the pages, cargo categories, truck parts and event terms; a truck model's side view in its colours | none | none |
| MissionHud | ui | `src/ui/hud/MissionHud.ts` | Objective, direction arrow and distance, next turn, arrival time, stop hint, loading bar, delivery clock, cargo condition (spec §12, §30, §63) | MissionService, NavigationService, DrivingService | none |
| PauseMenu, ResultDialog | ui | `src/ui/menus/` | Pause (resume, recover, fuel truck, abandon, map, settings, main menu); the itemised result or the failure reason, then the next job or the road | Strings | none |
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
| Company panel (finances), truck page | ui | `src/ui/hq/CompanyHq.ts`, `truckPage.ts` | The company's level, XP, reputation and credits; the truck page: where it stands, fuel and damage with refuel and repair, its cargo, its fitted parts | Phase 3 services (read only) | none |
| Toasts | ui | `src/ui/hud/Toasts.ts` | Short notices (level-up, fuel, damage, purchases, the weather turning, events) | none | none |

### Garage and upgrades (Phase 5, roadmap steps 19–20)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Truck roster | data | `src/data/content/vehicles.ts` | H1 light box, H2 medium refrigerated, H3 heavy flatbed (spec §15), with prices and unlock levels; tuned per class | VehicleDefinition | none |
| UpgradeDefinition, upgrades | data | `src/data/definitions/UpgradeDefinition.ts`, `src/data/content/upgrades.ts` | Upgrade levels with cost, unlock level and stat modifiers (spec §16); engine, brakes, tyres, suspension, fuel tank; the part of the truck each shows on (`look`) | Validator | none |
| Upgrade bonuses, performance factors, looks | domain | `src/domain/vehicles/upgradeBonuses.ts`, `performance.ts` | A truck's stat bonuses from its fitted levels; engine, brake, grip and stability factors; the level each part shows (`truckLooks`) | UpgradeDefinition | none |
| GarageService | systems | `src/systems/vehicles/GarageService.ts` | The company's trucks and the active one (spec §32 GarageState); the dealer; switching in place; fits the active truck's upgrades to driving, fuel and missions; the paint shop (any owned truck, the factory colour back for free) | DrivingService, MissionService, FuelService, DamageService, EconomyService | emits `VehiclePurchased`, `ActiveVehicleChanged`, `VehiclePainted` |
| UpgradeService | systems | `src/systems/vehicles/UpgradeService.ts` | The upgrade shop: the next level of each upgrade for the active truck | GarageService, EconomyService | emits `UpgradePurchased` |
| Garage page | ui | `src/ui/hq/CompanyHq.ts`, `garageCards.ts`, `paintPicker.ts`, `upgradeCards.ts` | Paint the truck being driven (pick a swatch: it shows on the truck; then confirm the price); upgrade levels, each previewed on the truck; buy, preview and switch trucks; each card says what it costs or unlocks it | GarageService, UpgradeService (read only) | none |
| Paints | data | `src/data/definitions/PaintDefinition.ts`, `src/data/content/paints.ts` | Nine colours with prices, the richer ones from company levels 2 and 3; each truck model's factory colour is in its VehicleDefinition | Validator | none |

### The 3-city region (Phase 4, roadmap step 21)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| north_valley | data | `src/data/content/maps.ts` | Yeniliman (A, on the sea, with a quay at the end of its harbour road), Demirkent (B, ring road), Başakova (C); the highway with a rest area; country roads; 11.5 km of road | MapDefinition | none |
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
| TrafficView | presentation | `src/presentation/traffic/TrafficView.ts` | Low-poly car, van, lorry and bus shapes (the city bus two-tone, with window panes, doors, a windscreen under a route sign and air-conditioning on the roof), one instanced mesh per kind, painted per vehicle (only the painted parts; glass, tyres and trim keep their colour), the buses' windows and route signs lit at night, interpolated between steps, each on a soft shadow (one more); all their lamps in one more, glowing at night; the headlamps of the vehicles nearest a point, for `LampLighting`, and every vehicle's lamps for `WetReflections`; casting the sun's shadows on high | TrafficSimulation (read only), three | none |

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
| WeatherDefinition, weather | data | `src/data/definitions/WeatherDefinition.ts`, `src/data/content/weather.ts` | Clear, cloudy, rain, dusk, night, dawn (spec §38–39): how likely and how long, what each may turn into, grip, traffic speed, and the look (sky, haze, light, the sun's height, clouds, rain, lamps, stars, moon) | Validator | none |
| GameConfig.weather | data | `src/data/config/GameConfig.ts` | The first weather, whether it changes, how long a change takes; `?weather=id` fixes it | ContentCatalog | none |
| WeatherService | systems | `src/systems/weather/WeatherService.ts` | Seeded schedule of weathers, each drawn from the ones the last may turn into (so the day goes round in order), blended changes; the truck's grip (a DrivingService performance modifier) and traffic speed; blended rain and lamps for the views; how wet the roads are (wet through soon after the rain starts, dry three minutes after it stops) | DrivingService, TrafficService, ContentCatalog | emits `WeatherChanged` |
| Weather look | presentation | `EnvironmentView.applySky`, `world/lighting.ts` (`PrelitMaterials`) | The weather's look mixed with the time of day's: sky, haze, sun and sky light, clouds; the sun low at dusk and dawn, the sky glowing round it and the clouds catching the glow; relights the pre-lit ground and fades baked shadows | three | none |
| CloudShadows | presentation | `src/presentation/world/cloudShadows.ts` | Broken cloud's shadows drifting over the land with the wind, in the materials' shaders (chained once at boot): the pre-lit ground loses the sun's share of its light under them, lit things their direct sunlight; more of them the cloudier, none under a sky all cloud; not drawn in software | PrelitMaterials, LampLighting (`isUnlitByLamps`), three | none |
| Mist | presentation | `src/presentation/world/Mist.ts` | The morning mist, in the materials' shaders (chained once at boot, no draw calls): a layer on the ground thinning upward, laid right after the fog along each line of sight (closed form), its light the horizon's glowing toward the sun; the sky dome and the hills share its uniforms; on the land not drawn in software | LampLighting (`isUnlitByLamps`), three | none |
| Thunderstorm | presentation | `src/presentation/weather/Thunderstorm.ts` | Lightning in heavy rain: seeded strikes near and far, half toward where the camera looks, each a few return strokes; the flash for `EnvironmentView.setLightning`, the strike for the bolt and the thunder | SeededRandom | none |
| LightningView | presentation | `src/presentation/weather/LightningView.ts` | A strike's bolt: a jagged, branching channel from the cloud base to the ground, drawn in the sky toward it as big as its distance makes it, facing the camera, flashing with the strokes; four shapes made at the start; one draw call while it shows, none for strikes too far off to be seen | Thunderstorm (its strikes), three | none |
| RainView | presentation | `src/presentation/weather/RainView.ts` | Rain streaks round the camera, animated on the GPU, one draw call; more of them the harder it rains; at night the drops glitter in the lamps' light (`LampLighting`'s uniforms), so the headlights' beams show in the rain; kept off the cab's inside in the cabin view (`setClearance`) | LampLighting, three | none |
| Time of day | core, data, domain, systems | `src/core/time/dayTime.ts`, `DaylightDefinition`, `src/data/content/daylight.ts`, `src/domain/sky/solar.ts`, `skyLook.ts`, `src/systems/weather/TimeOfDayService.ts` | The game's clock apart from the weather (spec §39): passing faster than real time, standing still or the phone's own; picked in Settings (dawn, morning, noon, dusk, night) or `?time=`; the sun and the moon on their real paths over the region for the calendar's date, the moon's phase, the stars round the pole; how much of the day's, dawn's or dusk's and the night's look the sky takes, mixed with the weather's | Clock, ContentCatalog | none |
| Morning mist | domain | `src/domain/sky/mist.ts` | How thick the morning mist lies (`morningMist`): gathering before dawn, lifting as the sun climbs, thinner under cloud and on dry ground, none in the rain or the evening | core | none |
| TruckEffects | presentation | `src/presentation/vehicles/TruckEffects.ts` | What the truck throws into the air: exhaust from the stack (more and darker under load), dust from the rear wheels off the road, spray on a wet road; thinned out by the graphics preset | TruckView, ParticlePool, three | none |
| ParticlePool | presentation | `src/presentation/effects/ParticlePool.ts` | Soft puffs in one draw call: camera-facing quads rebuilt every frame, moving, growing and fading, lit like the ground; hidden while none is in the air | three | none |
| Sky reflections | presentation | `world/skyReflection.ts`, `TruckView`, `TrafficView` | Paint, glass, chrome and rims mirror the sky from EnvironmentView's shared uniforms (Fresnel, sun glint), without a reflection map | three | none |
| Night lamps | presentation | `vehicles/LampGlows.ts`, `TruckView.setLamps`, `TrafficView.setLamps`, `TrackView.setLamps`, `StreetLampView.setLamps`, `CitySignView.setLamps` | Glowing lamps, lit windows, lit lenses, name boards in the headlights | three | none |
| LampLighting | presentation | `src/presentation/world/LampLighting.ts` | The night's lamps as real lights, in the materials' shaders (added once at boot, no draw calls): the truck's low beams (ECE, right-hand traffic), the nearest vehicles' and the nearest street lamps' (full cut-off, batwing, less behind); lit surfaces take them through their own lighting, pre-lit ones on their own colour (`PrelitMaterials.albedo`); wet asphalt sends less of the headlights back (what it mirrors is `WetReflections`'); picked round a point ahead of the camera, faded so none pops; fewer on weaker presets | TruckView, TrafficView, StreetLampView (their lamps), PrelitMaterials, three | none |
| WetReflections | presentation | `src/presentation/world/WetReflections.ts` | Every lamp in reach ahead of the camera mirrored on the wet road in one draw call: a quad per lamp lying on the water, whose pixels work out that lamp's glossy reflection (Beckmann lobe stretched along the view, Fresnel, the lamp's own beam), broken up by the rain's ripples, sharper in puddles; the truck keeps the light of lamps ahead off the road behind it; 48 lamps on medium, 96 on high, none on low | TruckView, TrafficView (`mirrorLamps`), StreetLampView (lamp list), `puddles.ts`, three | none |

### Special events (Phase 6, roadmap step 25)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| EventDefinition, events | data | `src/data/definitions/EventDefinition.ts`, `src/data/content/events.ts` | Express Week, Safe Driver, Heavy Cargo (spec §78): schedule, company level, qualifying deliveries, objective, reward, pay bonus | Validator | none |
| Event rules | domain | `src/domain/events/eventSchedule.ts`, `eventRules.ts` | Which run of an event is on (or next); whether a delivery qualifies; bonus and progress | EventDefinition | none |
| EventService | systems | `src/systems/events/EventService.ts` | Counts deliveries toward the running events, pays bonuses and rewards (spec §22–23, §53); the save's event progress | ContentCatalog, CompanyService, EconomyService, Clock | listens `MissionCompleted`; emits `EventProgressed` |
| Events page | ui | `src/ui/hq/eventCards.ts`, `eventText.ts` | The events with a picture of their terms, bonus, progress, reward and time left; job cards mark contracts whose cargo counts | EventService (read only) | none |

### Tutorial (Phase 7, roadmap step 26)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Tutorial steps | domain | `src/domain/tutorial/tutorialSteps.ts` | Spec §41's first ten minutes as steps, and what moves each on | none | none |
| TutorialService | systems | `src/systems/tutorial/TutorialService.ts` | The step the company is on, followed through the game's events; skip; the save's step | EventBus | listens `MissionStateChanged`, `MissionCompleted`, `MissionFailed`, `UpgradePurchased`; emits `TutorialStepChanged` |
| TutorialHint | ui | `src/ui/hud/TutorialHint.ts`, styles.css | One short hint (in the company panel above the list, on the road under the HUD) and a skip button; the control it is about glows | TutorialService (read only) | none |

### Performance (Phase 7, roadmap step 27)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Graphics presets | data | `QUALITY_PRESETS`, `applyQualityPreset` in `src/data/config/GameConfig.ts` | Low, medium, high: pixel ratio cap, resolution floor, rain density, lamp glows, traffic | none | none |
| Device quality, device settings | platform | `src/platform/browser/deviceQuality.ts`, `deviceSettings.ts` | The preset a device can carry (cores, memory, phone or not); which one to play (`?quality=`, the setting, the device); the phone's own settings (graphics, steering, tilt sensitivity, control size, sound, the performance display), kept apart from the save | GameConfig, controls settings, KeyValueStorage | none |
| AdaptiveResolution | presentation | `src/presentation/AdaptiveResolution.ts` | Lowers the resolution when frames run slow, raises it when they are quick again (a 30 FPS floor) | none | none |
| SettingsDialog | ui | `src/ui/menus/SettingsDialog.ts` | Settings from the main menu and the pause menu: the graphics preset (auto, low, medium, high) and the one in use; the time of day and whether the clock runs; how to steer, tilt sensitivity and control size; sound and the performance display on or off | Strings | none |
| Liquid glass | ui | `src/ui/glass.ts`, `glassMode.ts`, `styles.css` | The menus', panels' and road buttons' glass: blurred and brightened, bending what shows through near its rim (an SVG displacement map) where the device can; plain blur or a tint on weaker presets, in software and on browsers without SVG backdrop filters; `?glass=` picks it | none | none |

### Sound (Phase 7, spec §37)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Sound model | presentation | `src/presentation/audio/soundModel.ts` | The engine's note, loudness and brightness from rpm and pedal; road, brake and crash levels (pure, unit-tested) | none | none |
| GameAudio | presentation | `src/presentation/audio/GameAudio.ts` | Web Audio from oscillators and noise, no sound files: engine, brakes and their air hiss, horn, the reversing alarm, tyres and wind, rain, thunder after each strike (a crack when near, then a rolling rumble; `soundModel.thunderSound`); clicks, delivery chime, failure, crash and loading sounds; starts at the first gesture, sleeps while hidden | Web Audio | fed by the entry point from `VehicleCollided` and the mission events |
| Horn controls | ui, platform | `TouchControls` (horn button), `KeyboardInput` (H) | Hold to sound the horn | none | none |

### Controls (player feedback, roadmap step 29)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Controls settings | data | `src/data/config/controls.ts` | The ways of steering (wheel, tilt, buttons), tilt sensitivities, control sizes and tilt steering's states | none | none |
| TiltSteering | platform | `src/platform/input/TiltSteering.ts` | Turning the phone like a steering wheel → steering: calibrates straight ahead, any screen orientation, either gravity sign, steady down to a flat phone, dead zone, easing (pure, unit-tested) | controls settings | none |
| TiltInput | platform | `src/platform/input/TiltInput.ts` | Feeds TiltSteering from `devicemotion` while tilt is picked; asks iOS for the motion sensor from a tap; recentres when the screen turns | TiltSteering, VehicleInput | none |

### 2D maps (player feedback)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Map sketch, viewport | ui | `src/ui/map/mapSketch.ts`, `MapViewport.ts` | The world as a 2D map draws it: roads simplified into short runs with bounds, yards, lots, quays, turning circles, the sea, fields, wind turbines, buildings, depots, rest areas and city name spots; the view's pan, zoom and turn (DOM-free, unit-tested) | DrivingWorld | none |
| MapPainter | ui | `src/ui/map/MapPainter.ts` | Paints a sketch on a canvas through a viewport: only the roads in view, the route to the next bay, pins, city names, the truck and north; allocation-free | MapSketch, DrivingService, NavigationService, MissionService | none |
| Minimap | ui | `src/ui/hud/Minimap.ts` | The round map on the road, the truck heading up, twelve repaints a second; a tap opens the full map | MapPainter | none |
| WorldMap | ui | `src/ui/map/WorldMap.ts` | The full-screen map from the minimap, the pause menu, the company panel or M: drag, pinch, wheel and buttons; repaints only after a change; the drive waits while it is open | MapPainter | none |

### Android app (Phase 8, roadmap step 28)

| System | Layer | Location | Responsibility | Depends on | Events |
|---|---|---|---|---|---|
| Android project | tooling | `android/`, `capacitor.config.json`, `scripts/androidIcons.mjs` | Capacitor 8 wrapper around `dist/`: Gradle build, manifest, full-screen activity, original icons and splash, debug signing | Capacitor | none |
| Native app shell | platform | `src/platform/native/nativeApp.ts`, `capacitorShell.ts` | Inside the app: the back button and going to the background, through Capacitor's App plugin (loaded only there) | `@capacitor/app` | none |
| Back button rules | ui | `src/ui/menus/backAction.ts` | What back does on each screen: close a dialog or the company panel, pause or resume, put the app away | GameState | none |
| APK build | CI | `.github/workflows/ci.yml` (job `android`) | A debug APK for every pull request, kept 14 days | JDK 21, Android SDK | none |

## Planned for the MVP

The system names follow the spec. Placement follows `ARCHITECTURE.md`.

| System | Layer(s) | Step | Responsibility |
|---|---|---|---|
| Region streaming | data, presentation | ⬜ later | Load regions on demand (spec §21) once the world has more than one |
| Road events | data, domain, systems | ⬜ later | Random road events: road works, jams, detours (spec §24) |
| More settings, more languages | ui | ⬜ Phase 7 | Language in Settings (graphics, controls and sound are there); more string tables |

## Not in the MVP (spec §44)

FleetService / DriverService (AI drivers), AnalyticsService, AdService, IAPService, OnlineService, multiplayer, licensed brands, second-hand market, tenders. When they come, they enter as interfaces in systems, with implementations in platform.
