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
| 05 | Vehicle controller | 1 | ✅ | Deterministic truck model (ADR 0002): gearbox, governor, brakes, reverse (brake-to-reverse, or the D/R lever), understeer; keyboard |
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
| 27 | Optimization | 7 | ✅ | Low, medium and high graphics presets, picked for the device and in Settings; dynamic resolution; half-rate menus; the heaviest scenes at 52–59 draw calls and under 110k triangles, checked by an e2e test; the ground under the truck found through a grid |
| 28 | Android build | 8 | ✅ | Capacitor app: offline, full screen, original icon; back button and pausing in the background; a debug APK from CI for every pull request |
| 29 | Device testing | 8 | ⬜ **next** | Real low/mid Android phones |
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
- The look follows the weather through the change: sky, haze, sun and sky light, clouds, and the pre-lit ground with its baked shadows (`PrelitMaterials`). Rain is one draw call of streaks animated on the GPU. At night about half the windows light up, the lamps glow (one draw call for all traffic) and the lamps light the world (`LampLighting`, from the graphics pass). In rain the lamps are on at a third.
- The weather is not saved: each session starts clear. `?weather=clear|cloudy|rain|dusk|night|dawn` fixes the weather for testing.

### Phase 6 notes
- Events (step 25) are data (`EventDefinition`): a schedule of whole UTC days that repeats, a company level to take part, the deliveries that qualify (time to spare, cargo damage, cargo weight or category), an objective (deliveries, or credits earned), a reward and a pay bonus. A new event needs no code.
- Express Week (a quarter of the time to spare) and Safe Driver (no cargo damage) take turns, week by week, so one of them always runs; Heavy Cargo (8 t or more, from level 2) runs a week every other week from Thursdays. EventService pays the bonus on each qualifying delivery and the reward once per run, and the result screen shows both. The HQ's Events tab lists them with their progress and time left; job cards mark contracts whose cargo counts.
- The calendar is the device's clock. `?date=2026-09-30` starts it on another day (the e2e tests play before the first event, so bonuses never change what they check).
- Save v5 keeps the progress of each event's latest run; a new run starts from nothing.
- The spec's random road events (§24: road works, traffic jams and the like) are not in yet.

### Phase 7 notes
- Tutorial (step 26): a new company is walked through spec §41's first ten minutes by playing: take a contract, drive to the pickup bay (right pedal, the wheel, the blue line), deliver, then spend the pay on an upgrade. One short hint at a time, in the HQ above the list (so it never covers a button) or on the road under the mission HUD; the control it is about glows. A failed contract starts the drive over. Skip ends it for good.
- TutorialService follows the game's events (MissionStateChanged, MissionCompleted, MissionFailed, UpgradePurchased); it never blocks the controls. Save v6 keeps the step; companies from older saves have played already and skip it.
- Optimization (step 27): three graphics presets. Low (1× pixel ratio, half the rain, no lamp glows, 8 vehicles), medium (1.25×, three quarters of the rain, 12 vehicles) and high (1.5×, all of it, 16 vehicles). The game picks one for the device (4 cores or fewer, or 3 GB of memory or less, is low; other phones medium; desktops high); Settings on the main menu overrides it and restarts the game. The choice belongs to the phone, not the company: it is kept apart from the save. `?quality=low|medium|high` overrides both.
- Dynamic resolution holds a 30 FPS floor: when frames on the road average under 27 FPS over 2 s the resolution drops 15%, down to 60–70% of the preset's; after 6 s above 50 FPS it climbs back. Behind the menus the scene renders every other frame.
- Measured with 24 vehicles: a city yard at night, 52 draw calls and 92k triangles; the HQ backdrop at night, 59 and 98k; rain at the spawn, 52 and 109k. The budget is 150 and 300k; `tests/e2e/performance.spec.ts` fails above it.
- Profiling found three costs and removed them; the first two made about a third of the garbage per frame while driving a contract. The bay beacon's two translucent two-sided materials were drawn twice each, with their shaders set up afresh every frame. The ground under the truck was found by measuring all ~2,900 road pieces every step; a grid of road pieces answers a hundred times faster, and the world builds in a quarter of the time (its trees ask the same question). The canvas was resized twice per resolution change, each time waiting for the GPU.
- Frame rate itself waits for real phones (step 29): CI renders in software, so its tests check what is drawn, not how fast. The clouds are one draw call, so every preset keeps them.
- Sound (spec §37's first version; not a numbered step of §81, so it came after step 28, before the phones test it in step 29): the engine follows the rpm and the pedal, the brakes rub and their air hisses when the truck stops, a two-note horn (H, or the button next to the camera button), tyres and wind with speed, rain with the weather, and clicks, a delivery chime, a failure, crashes and the clunk of loading. All of it is Web Audio made in code: no sound files. It starts at the first touch and can be switched off in Settings.

### Phase 8 notes
- Android build (step 28): Capacitor 8 wraps the production build into an app that runs offline from its own files (`android/`, `capacitor.config.json`). `npm run android` copies the build in; `./gradlew assembleDebug` builds the APK. CI does both for every pull request and keeps the APK 14 days (see README.md).
- Saves stay in the app's WebView storage under the `https://localhost` origin. The app's scheme and hostname must never change, or saves are lost.
- Debug builds share a signing key kept in the repository, so each installs over the last one and keeps the save; CI numbers the builds. A store release (step 30) needs its own, secret key.
- Android's back button closes the dialog that is open, pauses and resumes the drive, takes the HQ back to the main menu, and at the main menu puts the app away. Going to the background pauses the drive and saves; a hidden browser tab now does the same.
- Full screen: the system bars hide, and a swipe shows them for a moment. The icon (a dark box truck on the game's amber) and the splash are drawn by `scripts/androidIcons.mjs`: no template art is left.
- Nothing here ran on a phone yet: this container has no Android emulator (no hardware virtualization). Step 29 installs the CI build on real phones.
- For step 29, Settings has a performance display switch: FPS, draw calls, the pixel ratio, the graphics preset and the GPU, in the browser and the app, without `?debug`.

### Player feedback (between steps 28 and 29)

After playing the Pages build, the player asked for more ways to steer and see the road, a map, and more world. Like the sound, these are not numbered steps of §81; they come before the phones test everything in step 29.

| Item | Status | Notes |
|---|---|---|
| Steering by tilting the phone or by buttons; control size | ✅ | Settings (main menu, and now the pause menu) |
| A 2D map, and a minimap on the HUD | ✅ | The region's roads, cities, depots, rest areas, the truck and its route |
| More cameras | ✅ | Hood, rear and top views besides chase and cabin (spec §31); a real cab inside; looking round by dragging |
| Truck paint | ✅ | Nine colours per truck at the garage; save v7 |
| More world | ✅ | Street lamps, the towns' name boards, farm fields with hay bales, wind turbines, and contracts of the day from a generator |
| Graphical touches | ✅ | Dusk and dawn with a low sun, and the day in order; stars and the moon at night; exhaust, dust and spray; Yeniliman's sea and harbour; wet roads in the rain, birds, and a view that widens with speed |
| A bigger map | ⬜ | A larger, Europe-like map needs decisions first: spec §20 and §85 want an original map, not a copy of a real one |

- Tilt steering: turn the phone like a steering wheel. Full lock takes 45°, 32° or 22° of turn (low, normal, high sensitivity), with a 2° dead zone; the steering follows the phone within about a tenth of a second. Straight ahead is how the phone is held when a drive starts, when the screen turns between portrait and landscape, and when the tilt button is tapped. Tipped back past about 55°, turns count a little less, down to a phone held flat, where a gentle rock steers gently instead of wildly.
- With tilt, both thumbs are free: the brake moves to the bottom left, next to the tilt button. iOS shares the motion sensor only after a tap: the game asks at the first one, and the tilt button glows until then. Without a motion sensor (or if it is refused), steering goes back to the wheel, with a message.
- Buttons steer like the keyboard: full lock while held, eased in by the truck's steering rate.
- Control size scales the wheel, pedals and buttons to 85% or 120%, capped so the bottom row fits a 360 px wide phone. `tests/e2e/touchControls.spec.ts` checks every way of steering in every size, on a phone on its side, upright and a narrow one upright, for controls off screen or on top of each other.
- Settings open from the pause menu too, over it. On a phone on its side they fit in two columns, with Close beside the title.
- Nothing here ran on a phone yet: the tilt maths is unit-tested for portrait, both landscapes, upside down and flipped gravity, and the e2e tests steer the truck with synthetic motion events. Step 29 tries it in real hands.
- The minimap sits beside the pause button (on a phone held upright, at the right halfway down): 300 m round the truck, the way it heads up, the route in the GPS line's blue, the next bay's pin (or a pointer on the rim when it is further), rest areas and north. It repaints twelve times a second on a small canvas; the roads are drawn once into paths, in runs of up to 32 points, and only the runs in view are stroked. On its side, the mission HUD, the messages and the rest area counter move right to make room.
- The full map opens from the minimap, the pause menu, the HQ (to see where contracts go) or M. It shows the whole region north up: roads by kind (the highway amber), yards and lots, buildings, city names, depots, the rest area, the truck, and the route with a Pickup or Delivery pin. Drag, pinch, the mouse wheel or the + − buttons zoom and move it; ◎ goes to the truck. The drive waits while it is open, and the 3D view is not drawn under it. Escape, M or Android's back button closes it.
- The map is drawn from the world's data, so a larger map (the last item) gets a 2D map for free: the paths are culled by their bounds, so drawing cost stays with what is on screen.
- Cameras: the camera button (or C) steps through chase, cabin, hood, rear and top, names each for a moment, and the phone keeps the last one. The rear camera looks down at the road behind for reversing into bays; its picture is mirrored like a reversing camera's, so the truck's right is on the screen's right and steering toward what you see works. The top view shows the yard from 28 m up.
- The cabin is a cab now: dashboard with two gauges, windscreen pillars, roof edge, ceiling and sills (the painted walls face outward, so from inside they are not drawn), and a steering wheel that turns twelve times as far as the front wheels. The inside is unlit, so the sun never leaves it black, and dims at night. The driver looks a little into bends, and the head sways with braking and cornering.
- Dragging across the road looks round: the head turns in the cabin (up to 108° each way), the chase and top cameras swing round the truck. The view turns back ahead 0.8 s after the finger lifts.
- Street lamps line the three towns' streets and Demirkent's ring road, every 26 m on alternating sides (145 of them), clear of junctions, yards, lots and other roads. Their posts are solid, like tree trunks. At night the lenses light up, glow and throw a warm pool of light on the road; the low preset leaves out the glows and pools. All of them cost two draw calls by day and four at night.
- Each town's name stands on a board beside both roads into it, facing the traffic coming in: YENİLİMAN, DEMİRKENT, BAŞAKOVA, in Turkish capitals (the stroke font now has every capital of the English and Turkish alphabets). The boards are 6 m wide, readable from the chase camera well before them, glow a little by day, like retroreflective signs, and more at night. Their posts are solid; trees and lamps keep clear of them. Two draw calls for all six.
- Farmland: 21 fields line the country roads, surround Başakova behind its houses and flank the highway: wheat, stubble, a young green crop or ploughed earth, with the rows along the road. A field is given as a stretch of road, a side, a setback and a depth, and is set back from wherever the road bulges toward it, so bends never run into it. The 144 round hay bales on the stubble fields lie in rows, seeded, and are solid; the fields themselves drive like grass. All fields cost one draw call, the bales one.
- Nine wind turbines, 64 m to the hub, turn in the valley beside the highway and beside the road into Demirkent; at night red warning lights blink on the nacelles. Two draw calls, three at night. The 2D map shows the fields in their crops' colours and the turbines.
- Contracts of the day (spec §28–29: the job board is not a fixed list): every 6 hours the contract generator deals five new ones for the region, the same for everyone. Two easy ones for the starting truck open each batch; the others ask for a level, and for a bigger truck when their load needs one. Pay follows spec §64: distance and tonnes times the difficulty's factor, then the cargo's multiplier, a tenth over the standing contracts. They come first on the board, marked *Today*, named after their cargo, with when the next ones come. **Save v8** keeps a generated contract under way whole, so it resumes after its batch has gone (migration and test). The tutorial still points at First Package, which starts at home.
- No new cargo types: spec §11 keeps the first version to six to eight, and a Cargo Pack of ten comes after the MVP (spec §79). The generator draws on the eight.
- Dusk and dawn (spec §39): the sun goes down to about 7° over the hills, the sky glows orange round it and along the horizon under it, the light turns warm, and the clouds catch the glow from below; the street lamps come on. Dawn is paler and rosier. The day goes round in order now: a clear or cloudy day turns to dusk now and then, dusk (2 minutes or so) to night, night to dawn and dawn to a clear or cloudy day; rain comes and goes by day. Each weather says what it may turn into (`next`), checked with the content. No new draw calls.
- The night sky: 700 stars, most faint and white, a few bright, bluish or warm, each twinkling at its own pace; they fade into the haze low down, and clouds and hills hide the ones behind them. The first show at dusk, the last fade at dawn. The moon, a pale disc with darker seas and a soft halo, stands where the night's light comes from, about 16° up, so it shows over the road ahead. Two draw calls, at night only. Measured again with all the new world, with 24 vehicles: a city yard at night about 65 draw calls and 115k triangles, the HQ backdrop at night 62 to 67 and up to 118k, rain at the spawn about 63 and 131k: well inside the budget of 150 and 300k.
- The truck throws things into the air: a chrome exhaust stack behind the cab puffs a light haze idling and darker, bigger puffs under load; off the road the rear wheels raise tan dust, more the faster (less on wet ground); on a wet road they throw spray, more the harder it rains and the faster. The puffs drift, slow in the air, grow and fade, and darken at night with the light. One draw call while any is in the air; the low and medium presets throw half and three quarters as many (`particleDensity`).
- Yeniliman is a harbour town now: the sea runs along the map's west edge, and the harbour road ends at a concrete quay with bollards and a yellow line along the water, two portal cranes over a small cargo ship with containers on its hatches, a tug beside it, and fishing boats off the shore and out in the bay, all rocking gently; at night their masthead lights and the cranes' warning lights glow. The water mirrors the sky, so it turns orange at dusk and dark under the moon; small waves drift across it, the sun glitters on it and foam breaks along the shore. North and south of the quay a sandy beach with boulders runs along the water. The truck stops at the water's edge. The 2D map shows the sea and the quay. The sea is data (`MapDefinition.sea`: a shoreline from the north edge to the south edge, quays, boats, cranes), checked with the map; trees and lamps keep clear of it. About 9 draw calls near the harbour.
- Small touches: in the rain the asphalt darkens and shines, mirroring the sky more the flatter it is seen, so the road ahead gleams; crows circle over the fields and gulls over the harbour by day (one draw call; they roost at night and in the rain); and the chase, cabin and hood cameras widen their view by up to 6° between 30 and 90 km/h, eased, so speed is felt.
- Paint: the garage paints any of the company's trucks, wherever it stands, in one of nine colours (1,500 to 2,500 credits; amber from level 2, purple and teal from level 3); the cab, the livery's stripe and the rear doors take the colour. A tap on a swatch only picks it: the button under the swatches names the price and paints. The factory colour comes back for free. Save v7 keeps each truck's paint; older saves' trucks keep their factory colours (migration and test).

### Tester feedback (between steps 28 and 29)

A tester played the Pages build on a phone: the truck could not take a sharp turn, reversing was hard to find, the game opened on a wall of text, the menus (events, garage) were not part of the game or visual, the truck's state belonged in the game, and the HQ's text did not scroll.

| Item | Status | Notes |
|---|---|---|
| Sharper turns | ✅ | Cornering limits 0.52–0.62 g (a junction at 30 km/h fits a 14 m radius); the on-screen wheel reaches full lock at a quarter turn |
| A reverse gear you can see | ✅ | A D/R button over the gas pedal; a reversing alarm; the driving hint names it |
| Straight into the game | ✅ | New company and Continue go onto the road; Jobs, Truck, Garage and Events buttons open the company panel over it |
| Menus in the game, with pictures | ✅ | The panel keeps the world in sight; pictures for cargo, trucks, parts and events; the garage shows paint, upgrades and trucks on the truck before they are bought |
| The truck's state in the game | ✅ | The truck page: fuel, damage, cargo, parts, the pump and the workshop |
| Text that scrolls | ✅ | One scrolling list per page; e2e swipes it with real touch events, on its side, upright and narrow upright |

- The gear lever is part of `VehicleInput`: `auto` keeps the keyboard's brake-to-reverse; with the touch controls' D/R button the gas pedal drives the way it points and the brake only brakes. The gearbox changes direction at a standstill. A drive starts in D. The truck beeps in reverse (a 1,150 Hz note, 1.25 beats a second).
- There is no HQ screen any more: `GameState` is booting, mainMenu and driving. The company panel opens over the road: at the right of a phone on its side, its tabs in a rail on the left, and at the bottom (two thirds) of an upright one. While it is open the truck waits where it is; if it was moving, traffic and the weather wait too. The camera circles the truck in the part of the screen the panel leaves free. Escape, the close button or Android's back button close it.
- Without a contract the road's buttons sit where the mission HUD goes, Jobs lit; during a contract Jobs goes and Truck, Garage and Events shrink to round buttons (under the minimap on a phone on its side, at the left halfway down upright). The result screen offers the next job or the road; the pause menu has the main menu instead of the HQ.
- The garage page holds the paint, the upgrades and the trucks. A tap on a paint, an upgrade's Preview or a truck's Preview shows it on the truck, and the camera turns to the part; nothing is spent until the buy button. Each upgrade shows on the truck (`UpgradeDefinition.look`): chrome and taller exhaust stacks (twin at level 2, a roof light bar at 3), a longer and chrome fuel tank (a second at 3), polished, chrome or gold rims, yellow, orange or red brake calipers, a lower body with mudflaps, then a chrome bumper and grille bars. A fully upgraded truck costs two more draw calls (chrome, calipers).
- Tutorial: the first hint is on the road now and makes the Jobs button glow; after the first delivery the Garage button glows, then its first affordable upgrade.
- As before, none of this has been in real hands yet: step 29 tries it on phones.

### Graphics pass (between steps 28 and 29)

The player asked for the best graphics the game can have ("grafiksel iyileştirmeler, olabilenin en iyisi"). Every item is original, drawn in code, and sized for phones through the presets.

| Item | Status | Notes |
|---|---|---|
| A colour pass | ✅ | Medium and high: bloom on bright lights, ACES tones, a weather grade (saturation, S-curve contrast, warmth, darker corners under lit lamps), dithering; high multisamples 4×, medium smooths with FXAA; low draws straight to the screen (`?post=0` too) |
| Soft clouds and hills | ✅ | Billboard cumulus lit in the shader from the sky's uniforms, drifting; two ridges of hazy hills |
| Real-time shadows | ✅ | High only: the sun's soft (PCF) shadows of the truck, traffic, lamp posts, rails and delineators round the truck; phones keep the decals |
| Sky reflections | ✅ | Paint, glass and chrome of the truck and traffic mirror the sky and the sun's glint by a Fresnel term; rounded traffic bodies |
| Ground and verges | ✅ | A meadow that does not repeat; grass tufts, flowers and bushes along every road, near the camera only, swaying in the wind |
| Buildings | ✅ | Stone plinths, warm plasters, tiled hipped roofs, metal gables, parapets, rooftop tanks, solar heaters and plant |
| Road furniture | ✅ | Guard rails on the sharp bends (walls the truck hits), delineator posts whose reflectors shine in the headlights, zebra crossings |
| Trees in the wind | ✅ | Crowns sway (harder in the rain) |
| Realistic lamps | ✅ | The player found the headlights' pool of light poor ("far ışığı bok gibi"): the night's lamps are now real lights in the materials' shaders (`LampLighting`). The truck's low beams (ECE, right-hand traffic: the cut-off, the step up to the right, the hot zone, the wide light near the bumper), the nearest vehicles' and the nearest street lamps' (full cut-off, batwing, less behind) light the road by its own colour, the verges, trees, posts, buildings and cars; in the rain the wet road mirrors them in streaks and the drops glitter in the beams. No draw calls: the decal pools and the beam cones are gone |

- The presets decide the cost: low has no colour pass, no real-time shadows, 45% of the verges' plants, no lamp glows, the truck's headlights and three street lamps and no wet mirroring; medium adds the colour pass (FXAA), 75% of the plants, six street lamps and one vehicle's headlights; high adds 4× MSAA, the shadows, all the plants, eight street lamps and two vehicles.
- Drawn in software (CI's headless browser, some virtual machines) the host also leaves out the edge smoothing and draws half the plants and clouds, a plainer ground and a 1024² shadow map; the simulation runs up to 12 steps a frame there, so it keeps real time and the end-to-end tests do not wait on the drawing.
- The draw budget holds: the verges add three draw calls, the road furniture two and one per rail tile in view, the buildings two, the colour pass ten or eleven full-screen passes.
- None of it has been seen on a phone yet: step 29 checks the frame rate of each preset on real devices.

### The world in detail, the cab, the time of day and glass menus (between steps 28 and 29)

The player asked for the most detail round the roads, a realistic cab with its steering wheel, a time of day to pick, more graphical touches ("etrafı maks detaylandır, içten görünümde direksiyon vs gerçekçi yap, oyun saatini seçebilelim, ekstra grafiksel iyileştirmeler") and liquid glass menus ("menü için liquid glass kullan").

| Item | Status | Notes |
|---|---|---|
| Liquid glass | ✅ | The menus, panels and road buttons are glass: blurred and brightened, bending what shows through near the rim where the device can (high preset, Chromium); a plain blur on medium, a tint on low, in software and elsewhere; `?glass=lens|blur|tint` |
| The time of day | ✅ | A game clock apart from the weather (spec §39): Settings pick dawn, the morning, noon, dusk or the night and whether the clock runs; `?time=19:30`. The sun and the moon on their real paths over the region for the date, the moon's phase, the stars round the pole; the sky's look mixed from the day's, the twilight's and the night's with the weather's |
| A realistic cab | ✅ | Built the first time the cabin view shows: a dashboard in one atlas with live needles and a seven-segment display, the navigation screen, a steering wheel that turns with the front wheels, pedals, seats, visors, the radio, a nazar charm swinging on its cord, mirrors painted with the road behind; lit by the sky through the glass, the instruments glowing at night. The body keeps level in the cabin view and the head sways. Wipers sweep the rain off the windscreen, drops beading again behind them |
| The towns | ✅ | Pavements with kerbs along every street (paved ground: asphalt grip, no grass), benches, bins and a bus shelter, billboards for four original local businesses on the roads in, speed limits where the roads enter (map flag `streetscape`) |
| The country | ✅ | Power lines on wooden poles along the country roads with their wires, fences round the grain and dry-stone walls round the other fields, boulders, grazing sheep and cows, poplar windbreaks, olive groves and cypress avenues into the towns (map flag `countryside`); the poles, boulders, animals and furniture are solid |
| Road studs | ✅ | Cat's eyes on the highway's lines, lighting up in the headlights |
| The sky and the light | ✅ | The Earth's shadow and the Belt of Venus opposite the sun at twilight; the towns' glow on the night's horizon; the sun's glare and the lens's ghosts where it shows (the colour pass); broken cloud's shadows drifting over the land and all on it |

- The scenery costs about 25 ms to place and 90 ms to build on a desktop (the parts are stamped from shared ones and merged per 600 m tile); a phone takes several times that at boot.
- The cloud shadows and the sun's glare are left out when drawn in software, where every pixel counts; the end-to-end tests there see the rest.
- `?spawn=x,z,heading` starts a new game's truck anywhere on the map, to look round a place.

## Next step: 29 Device testing

Suggested request:

> Implement roadmap step 29 only. Device testing (spec §81): install the CI debug APK (and the Pages build in Chrome) on at least one low-end and one mid-range Android phone, and fix what they show: frame rate against the 30 FPS floor with the `?debug` overlay (the Pages build takes it in the address; give the app a way to turn it on, such as a switch in Settings), which graphics preset each phone gets and whether the dynamic resolution settles, touch control feel (steering wheel, pedals, camera, pause), text and controls round display cutouts in both orientations, the back button and the app in the background, saving across restarts and updates, and the first ten minutes (tutorial) as a new player. Record each phone's results in the roadmap.

## Infrastructure track

These are not gameplay features, so they sit outside the numbered order. They make testing on real phones possible.

| Item | Status | Notes |
|---|---|---|
| CI: typecheck, unit tests, build, e2e | ✅ | `.github/workflows/ci.yml` on every pull request |
| Phone preview link | ✅ | GitHub Pages: `.github/workflows/deploy-pages.yml` publishes every push to `main` at https://keremcan534.github.io/roadhaul/ (needs the repository to be public and Pages source set to "GitHub Actions") |
| Android APK from CI | ✅ | Step 28: the `android` job in `.github/workflows/ci.yml`; download **roadhaul-debug-apk** from the run's page |

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
