import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { metersPerSecondToKmh } from './core/math/scalar';
import { shiftedClock, systemClock } from './core/time/Clock';
import { formatClock } from './core/time/dayTime';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import type { SteeringMode, TiltStatus } from './data/config/controls';
import { applyQualityPreset, DEFAULT_GAME_CONFIG, type QualityLevel } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { PLAYER_COMPANY_ID } from './data/definitions/RivalCompanyDefinition';
import { bayParkingPose } from './domain/missions/loadingBay';
import { morningMist } from './domain/sky/mist';
import { composeSky, createSkyLook, mixWeather } from './domain/sky/skyLook';
import { truckLooks } from './domain/vehicles/upgradeBonuses';
import {
  brakePedalOf,
  combineVehicleInputs,
  createVehicleInput,
  drivePedalOf,
} from './domain/vehicles/VehicleInput';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { browserStorage } from './platform/browser/browserStorage';
import {
  applyConfigOverrides,
  requestedDateMs,
  requestedLampLight,
  requestedMist,
  requestedSpawn,
  requestedTimeOfDay,
  requestedWetness,
} from './platform/browser/configOverrides';
import { chooseQuality, detectQuality, deviceHints, qualitySetting } from './platform/browser/deviceQuality';
import { loadSettings, saveSettings } from './platform/browser/deviceSettings';
import { attachNativeApp, isNativeApp } from './platform/native/nativeApp';
import { showFatalError } from './platform/browser/fatalError';
import { KeyboardInput } from './platform/input/KeyboardInput';
import { TiltInput } from './platform/input/TiltInput';
import { CameraRig, SHOWCASE_PAINT_ANGLE, SHOWCASE_PART_ANGLES } from './presentation/cameras/CameraRig';
import { AdaptiveResolution } from './presentation/AdaptiveResolution';
import { createSoundState, GameAudio } from './presentation/audio/GameAudio';
import { RenderHost } from './presentation/RenderHost';
import { TruckView, truckViewKey } from './presentation/vehicles/TruckView';
import { createTruckEffectsState, TruckEffects } from './presentation/vehicles/TruckEffects';
import { DepotView } from './presentation/world/DepotView';
import { EnvironmentView } from './presentation/world/EnvironmentView';
import { GpsRouteView } from './presentation/navigation/GpsRouteView';
import { TrafficView } from './presentation/traffic/TrafficView';
import { LightningView } from './presentation/weather/LightningView';
import { RainView } from './presentation/weather/RainView';
import { Thunderstorm } from './presentation/weather/Thunderstorm';
import { LampLighting, type LampLightingOptions } from './presentation/world/LampLighting';
import { PedestrianView } from './presentation/world/PedestrianView';
import { WetReflections, type MirroredLamps } from './presentation/world/WetReflections';
import { PrelitMaterials } from './presentation/world/lighting';
import { CitySignView } from './presentation/world/CitySignView';
import { BirdsView } from './presentation/world/BirdsView';
import { CloudShadows } from './presentation/world/cloudShadows';
import { FarmlandView } from './presentation/world/FarmlandView';
import { HarbourView } from './presentation/world/HarbourView';
import { SeaView } from './presentation/world/SeaView';
import { RestAreaView } from './presentation/world/RestAreaView';
import { RoadFurnitureView } from './presentation/world/RoadFurnitureView';
import { RoadsideView } from './presentation/world/RoadsideView';
import { SceneryView } from './presentation/world/SceneryView';
import { StreetLampView } from './presentation/world/StreetLampView';
import { WindTurbineView } from './presentation/world/WindTurbineView';
import { TrackView } from './presentation/world/TrackView';
import { interpolatePose } from './systems/driving/DrivingService';
import { CLOCK_PRESETS, type ClockPreset } from './systems/weather/TimeOfDayService';
import type { GameState } from './systems/gameState/GameState';
import { LookAround } from './ui/controls/LookAround';
import { TouchControls } from './ui/controls/TouchControls';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import { installGlass } from './ui/glass';
import { glassModeFor, isGlassMode, lensSupported } from './ui/glassMode';
import { CompanyHq, type TruckPreview } from './ui/hq/CompanyHq';
import { driverName, truckNumber } from './ui/hq/fleetPage';
import { routeText } from './ui/hq/jobCards';
import type { HqTab } from './ui/hq/hqTabs';
import { objectiveText } from './ui/hq/eventText';
import { HudDock } from './ui/hud/HudDock';
import { Minimap } from './ui/hud/Minimap';
import { MissionHud } from './ui/hud/MissionHud';
import { RestAreaPanel } from './ui/hud/RestAreaPanel';
import { Toasts } from './ui/hud/Toasts';
import { TutorialHint, tutorialShows, type TutorialPlace } from './ui/hud/TutorialHint';
import { chooseLanguage, stringsFor } from './ui/i18n';
import { MapPainter } from './ui/map/MapPainter';
import { sketchWorld } from './ui/map/mapSketch';
import { WorldMap } from './ui/map/WorldMap';
import { backAction } from './ui/menus/backAction';
import { MainMenu } from './ui/menus/MainMenu';
import { NewCompanyDialog } from './ui/menus/NewCompanyDialog';
import { PauseMenu, type RoadsideFuelOffer } from './ui/menus/PauseMenu';
import { ResultDialog } from './ui/menus/ResultDialog';
import { SettingsDialog } from './ui/menus/SettingsDialog';
import './ui/styles.css';

/**
 * Browser entry point and composition root. It boots the headless game
 * services, then adds rendering, input, the menus, the HUD, the frame loop
 * and debug tooling, and wires the game flow: main menu → the world, where
 * the truck waits → the company panel over it (job board, truck, garage,
 * events) → driving the contract → result → the next contract or the road.
 * A company is started or continued from the main menu and saves itself as
 * it goes.
 *
 * `<html data-boot-state>` (booting | ready | error), `data-game-state`,
 * `data-panel`, `data-mission-state`, `data-vehicle`, `data-traffic`,
 * `data-weather` and `data-daylight` let the end-to-end tests follow
 * progress.
 */
/** Slower than this (m/s), the truck counts as standing when the company panel opens: the world goes on around it. */
const PANEL_STANDSTILL_SPEED = 0.5;
/**
 * Drawn in software (RenderHost.softwareRendering): the shadow map at most
 * this size, and this share of the plants and of the clouds.
 */
const SOFTWARE_SHADOW_MAP_SIZE = 1024;
const SOFTWARE_VEGETATION_SHARE = 0.5;
const SOFTWARE_CLOUD_SHARE = 0.5;
/**
 * Drawn in software, a frame takes 200 ms or more, half a second on a slow
 * machine; a fixed step, well under a millisecond. Frames simulated up to
 * this long, in up to this many steps, keep the game in real time down to
 * 2 FPS, where the configured caps would slow it to a sixth.
 */
const SOFTWARE_MAX_SIMULATION_DELTA_SECONDS = 0.5;
const SOFTWARE_MAX_STEPS_PER_FRAME = 30;
/**
 * How many lamps light the night (LampLighting), per graphics preset: the
 * nearest street lamps and vehicles. Drawn in software (with ?lamps=1), as
 * few as on the low preset, but the shaders stay whole.
 */
const LAMP_LIGHTS: Readonly<Record<QualityLevel, LampLightingOptions>> = {
  low: { streetLamps: 3, trafficVehicles: 0 },
  medium: { streetLamps: 6, trafficVehicles: 1 },
  high: {},
};
/** How many lamps a wet road mirrors at most (WetReflections), per graphics preset: none on the low one. */
const MIRRORED_LAMPS: Readonly<Record<QualityLevel, number>> = { low: 0, medium: 48, high: 96 };
/** How many people walk the towns' pavements near the camera at most (PedestrianView), per graphics preset. */
const PEDESTRIANS: Readonly<Record<QualityLevel, number>> = { low: 40, medium: 80, high: 140 };
const SOFTWARE_LAMP_LIGHTS: LampLightingOptions = { streetLamps: 3, trafficVehicles: 0 };
/** The clock's time is kept in the settings this often (seconds), so a closed tab loses little of the day. */
const CLOCK_KEEP_SECONDS = 30;
/** The company panel's fleet page moves its progress bars on this often, seconds. */
const HQ_TICK_SECONDS = 0.5;
/** Debug (`?debug`): F runs the fleet and the rivals this many seconds on. */
const FLEET_FAST_FORWARD_SECONDS = 600;
/** From the driver's seat no rain falls nearer the eye than this: the windscreen is about a meter ahead. */
const CAB_RAIN_CLEARANCE_METERS = 1.2;
/** From this thick (0..1, morningMist) the mist hides the road ahead: the driver is told. */
const THICK_MIST = 0.5;

async function start(): Promise<void> {
  const root = document.documentElement;
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (canvas === null) {
    throw new Error('Missing <canvas id="game-canvas">.');
  }

  const query = new URLSearchParams(window.location.search);
  const { storage, persistent } = browserStorage(window);
  // Graphics: `?quality=`, else the player's setting, else what the device can carry. URL flags win over the preset.
  // The phone's settings; sound can change while the game runs.
  let settings = loadSettings(storage);
  const qualityChoice = qualitySetting(query.get('quality'), settings.quality, persistent);
  const quality = chooseQuality(query.get('quality'), qualityChoice, detectQuality(deviceHints(navigator)));
  const config = applyConfigOverrides(applyQualityPreset(DEFAULT_GAME_CONFIG, quality), query);
  const logger = new ConsoleLogger({ sink: console, minLevel: config.debug.logLevel });
  if (!persistent) {
    logger.warn('Storage is unavailable: this game will not be saved after the page closes.');
  }
  // `?date=` sets the calendar the special events run by (tests, previews); the real date otherwise.
  const startDateMs = requestedDateMs(query);
  const clock = startDateMs === null ? systemClock : shiftedClock(systemClock, startDateMs - systemClock.now());
  // `?spawn=x,z,heading` starts a new game there (a debug switch: to look round a place without driving to it).
  const spawn = requestedSpawn(query);
  const services = await new GameBootstrapper({
    config,
    content: spawn === null ? GAME_CONTENT : { ...GAME_CONTENT, maps: GAME_CONTENT.maps.map((map) => ({ ...map, spawn })) },
    logger,
    clock,
    storage,
    localTimeOffsetMinutes: -new Date().getTimezoneOffset(),
  }).boot();

  const content = services.resolve(ServiceKeys.content);
  const events = services.resolve(ServiceKeys.events);
  const gameState = services.resolve(ServiceKeys.gameState);
  const driving = services.resolve(ServiceKeys.driving);
  const traffic = services.resolve(ServiceKeys.traffic);
  const weather = services.resolve(ServiceKeys.weather);
  const timeOfDay = services.resolve(ServiceKeys.timeOfDay);
  // The game's clock: the time the player picked and the way it goes (Settings), unless the address sets it
  // (`?time=`, `?weather=dawn|dusk|night`), which stops it there and keeps the player's own for later.
  const requestedTime = requestedTimeOfDay(query);
  timeOfDay.flow = requestedTime === null ? settings.timeFlow : 'stopped';
  timeOfDay.set(
    requestedTime === null
      ? settings.clockMinutes
      : 'minutes' in requestedTime
        ? requestedTime.minutes
        : timeOfDay.timeOf(requestedTime.phase),
  );
  /** How wet the roads are: the weather's, or as the address keeps them (`?wet=`). */
  const keptWetness = requestedWetness(query);
  /** How thick the morning mist lies: the morning's, or as the address keeps it (`?mist=`). */
  const keptMist = requestedMist(query);
  /** The sky for the time of day with the weather over it, worked out every frame (composeSky). */
  const clearDay = content.weather.get(config.weather.clearWeatherId).look;
  const weatherLook = createSkyLook();
  const skyLook = createSkyLook();
  const missions = services.resolve(ServiceKeys.missions);
  const dailyContracts = services.resolve(ServiceKeys.dailyContracts);
  const navigation = services.resolve(ServiceKeys.navigation);
  const specialEvents = services.resolve(ServiceKeys.specialEvents);
  const tutorial = services.resolve(ServiceKeys.tutorial);
  const economy = services.resolve(ServiceKeys.economy);
  const company = services.resolve(ServiceKeys.company);
  const fuel = services.resolve(ServiceKeys.fuel);
  const damage = services.resolve(ServiceKeys.damage);
  const garage = services.resolve(ServiceKeys.garage);
  const upgrades = services.resolve(ServiceKeys.upgrades);
  const fleet = services.resolve(ServiceKeys.fleet);
  const rivals = services.resolve(ServiceKeys.rivals);
  const session = services.resolve(ServiceKeys.session);

  // Older WebViews may only have navigator.language.
  const language = chooseLanguage(query.get('lang'), navigator.languages ?? [navigator.language]);
  root.lang = language;
  const strings = stringsFor(language);

  // Behind the main menu the starting truck waits at the start of the map, seen from a circling camera.
  // Starting or continuing a company puts its own truck where it was left.
  driving.start(config.newGame.startingVehicleId, config.newGame.startingMapId);

  const renderHost = new RenderHost(canvas, config.rendering);
  // The views add themselves to the scene for the page's lifetime. The pre-lit ground follows the weather's light.
  const prelit = new PrelitMaterials();
  // Broken cloud's shadows drift over the land, on the pre-lit ground and the lit things alike; not drawn in software,
  // where every pixel's texture read counts.
  const cloudShadows = new CloudShadows();
  const castShadows = config.rendering.shadowMapSize > 0;
  // Drawn in software (no GPU), every pixel is dear: coarser shadows, half the plants and clouds, a plainer ground.
  const software = renderHost.softwareRendering;
  // The night's lamps (the truck's and the traffic's headlights, the street lamps) light the world through its
  // materials' shaders (lightScene, at the end of boot). Drawn in software, the lamps' code costs every frame about
  // a fifth of its time even by day, when the shaders skip it: there they light nothing, unless ?lamps=1 asks.
  const lampLighting = new LampLighting(software ? SOFTWARE_LAMP_LIGHTS : LAMP_LIGHTS[config.rendering.quality]);
  const lampLight = requestedLampLight(query) ?? !software;
  // The menus' liquid glass blurs the world behind it: not drawn in software or on the low preset, bending only on
  // high (glass.ts). `?glass=lens|blur|tint` picks it anyway, for comparison.
  const requestedGlass = query.get('glass');
  installGlass(
    document,
    isGlassMode(requestedGlass)
      ? requestedGlass
      : glassModeFor(config.rendering.quality, software, lensSupported(navigator.userAgent)),
  );
  const environment = new EnvironmentView(renderHost.scene, {
    hdr: renderHost.postProcessing,
    shadowMapSize: software ? Math.min(SOFTWARE_SHADOW_MAP_SIZE, config.rendering.shadowMapSize) : config.rendering.shadowMapSize,
    cloudShare: software ? SOFTWARE_CLOUD_SHARE : 1,
  });
  const track = new TrackView(renderHost.scene, driving.world, {
    anisotropy: renderHost.anisotropy,
    prelit,
    sky: environment.sky,
    groundDetail: !software,
  });
  const depots = new DepotView(renderHost.scene, driving.world.depots, { anisotropy: renderHost.anisotropy, prelit });
  new RestAreaView(renderHost.scene, driving.world, { anisotropy: renderHost.anisotropy, prelit });
  const lampGlows = config.rendering.lampGlows;
  const streetLamps = new StreetLampView(renderHost.scene, driving.world.streetLamps, { lampGlows, castShadows });
  lampLighting.setStreetLamps(streetLamps.lampLights());
  // Wet roads mirror the lamps: a streak of light under each, as far as the eye sees them. Not where they light
  // nothing (?lamps=0, software), nor on the low preset.
  const mirroredLamps = lampLight ? MIRRORED_LAMPS[config.rendering.quality] : 0;
  const wetReflections = mirroredLamps > 0 ? new WetReflections(renderHost.scene, mirroredLamps) : null;
  wetReflections?.setStreetLamps(streetLamps.lampLights());
  new FarmlandView(renderHost.scene, driving.world.fields, driving.world.hayBales, {
    anisotropy: renderHost.anisotropy,
    prelit,
  });
  const windTurbines = new WindTurbineView(renderHost.scene, driving.world.windTurbines, { lampGlows });
  const pedestrians = new PedestrianView(
    renderHost.scene,
    driving.world.roads,
    driving.world.sidewalks,
    driving.world.streetFurniture,
    { capacity: PEDESTRIANS[config.rendering.quality] },
  );
  const roadside = new RoadsideView(renderHost.scene, driving.world, {
    density: config.rendering.vegetationDensity * (software ? SOFTWARE_VEGETATION_SHARE : 1),
    prelit,
  });
  const roadFurniture = new RoadFurnitureView(renderHost.scene, driving.world, { sky: environment.sky, castShadows });
  // At night the towns glow on the horizon, over their depots.
  environment.setTowns(driving.world.depots.map((depot) => depot.yard));
  // The countryside's power lines, walls, rocks and herds, and the towns' pavements, benches, shelters and signs.
  const scenery = new SceneryView(renderHost.scene, driving.world, { castShadows, anisotropy: renderHost.anisotropy });
  // The sea mirrors the sky, so it follows the weather with it.
  const coast = driving.world.sea;
  const seaView =
    coast === null
      ? null
      : new SeaView(renderHost.scene, coast, driving.world.halfSizeMeters, environment.sky, {
          anisotropy: renderHost.anisotropy,
          prelit,
        });
  const harbour =
    coast === null
      ? null
      : new HarbourView(renderHost.scene, coast, { anisotropy: renderHost.anisotropy, prelit, lampGlows });
  const birds = new BirdsView(renderHost.scene, driving.world, prelit);
  const citySigns = new CitySignView(renderHost.scene, driving.world.citySigns, (cityId) => strings.cityName(cityId), {
    anisotropy: renderHost.anisotropy,
  });
  const trafficView = new TrafficView(renderHost.scene, content.trafficVehicles.all, config.traffic.maxVehicles, {
    lampGlows,
    castShadows,
    sky: environment.sky,
  });
  /** What carries lamps for a wet road to mirror: the truck (set every frame: it changes in the garage) and the traffic. */
  const mirroredSources: (MirroredLamps | null)[] = [null, trafficView];
  const gpsRoute = new GpsRouteView(renderHost.scene, navigation);
  const rain = new RainView(renderHost.scene, config.rendering.rainDensity, lampLight ? lampLighting.uniforms : null);
  // Lightning in a storm: the flash lights the sky and the world, a bolt shows toward near strikes, thunder follows.
  const storm = new Thunderstorm();
  const lightning = new LightningView(renderHost.scene);
  const truckEffects = new TruckEffects(renderHost.scene, config.rendering.particleDensity, prelit);
  const effectsState = createTruckEffectsState();
  const adaptiveResolution = new AdaptiveResolution(config.rendering.minResolutionScale);
  /** Vehicles on the road, as last written to the page (e2e tests read it). */
  let shownTraffic = -1;
  /** Whether sound plays, as last written to the page (e2e tests read it). */
  let shownSound = '';
  /** The time of day's look (day, dawn, dusk, night) and the clock's minute, as last shown. */
  let shownDaylight = '';
  let shownClockMinute = -1;
  /** Whether the morning mist lies thick, as last shown ('' before the first frame). */
  let shownMist = '';
  /** Seconds since the clock's time was last kept in the settings (keepClock). */
  let sinceClockKept = 0;
  let sinceHqTick = 0;
  // Rebuilt whenever the player drives another truck (showActiveTruck).
  let truck = new TruckView(renderHost.scene, driving.definition, { lampGlows, castShadows, sky: environment.sky, light: environment.light });
  const cameraRig = new CameraRig(renderHost.camera, driving.definition.body);
  cameraRig.currentMode = settings.camera;
  // Dragging across the road looks round, within what the current camera allows.
  const lookAround = new LookAround(canvas, () => cameraRig.lookLimits);

  /** The simulation stands still while a menu or the result is open over the road. */
  let paused = false;
  /** The truck was moving when the company panel opened: traffic and weather hold still with it until it closes. */
  let worldHeld = false;
  const isDriving = (): boolean => gameState.current === 'driving';
  /** On the road: in the game with no company panel over it. */
  const onRoad = (): boolean => isDriving() && !hq.isOpen;

  const ui = document.body;
  /**
   * The camera in use, shown: the cab's inside from the driver's seat (and no rain falling inside it), the rear
   * camera's picture mirrored.
   */
  const showCamera = (drivingNow: boolean): void => {
    const mode = cameraRig.currentMode;
    const inCab = drivingNow && mode === 'cabin';
    truck.setCabinView(inCab);
    rain.setClearance(inCab ? CAB_RAIN_CLEARANCE_METERS : 0);
    renderHost.mirrored = drivingNow && mode === 'rear';
    root.dataset.camera = mode;
  };
  /** The camera button (or C): the next camera, named for a moment, and kept for next time. */
  const toggleCamera = (): void => {
    if (isDriving() && !paused && !hq.isOpen) {
      const mode = cameraRig.toggleMode();
      lookAround.reset();
      showCamera(true);
      settings = { ...settings, camera: mode };
      saveSettings(storage, settings);
      toasts.show(strings.t(`camera.${mode}`), 'info');
    }
  };
  // Sound starts at the page's first touch (browsers allow it only then) and follows the truck every frame.
  const audio = new GameAudio(() => (typeof AudioContext === 'undefined' ? null : new AudioContext()), settings.sound);
  const soundState = createSoundState();
  const honk = (pressed: boolean): void => audio.setHorn(pressed);
  // Steering by turning the phone reads the motion sensor while it is the picked way of steering (applySteering).
  const tilt = new TiltInput(window, settings.tiltSensitivity, (status) => showTilt(status));
  const touch = new TouchControls(ui, {
    onToggleCamera: toggleCamera,
    onHorn: honk,
    onTilt: () => {
      tilt.unlock();
      tilt.recenter();
    },
  });
  touch.size = settings.controlSize;
  const hud = new MissionHud(ui, strings, missions, navigation, driving, rivals);
  // The 2D maps: the region drawn once into paths, the minimap on the road and the full map (openMap, below).
  const mapSketch = sketchWorld(driving.world);
  const mapPainter = new MapPainter(mapSketch, { driving, navigation, missions, fleet, rivals }, strings);
  const minimap = new Minimap(ui, strings, mapPainter, driving, () => openMap());
  const toasts = new Toasts(ui);

  // From the result: the next contract, or back on the road.
  const result = new ResultDialog(ui, strings, (choice) => {
    paused = false;
    showHud();
    if (choice === 'jobs') {
      openPanel('jobs');
    }
  });
  const refuel = (roadside: boolean): void => {
    const filled = fuel.refuel(roadside);
    if (filled.ok) {
      const liters = strings.t('format.liters', { value: Math.round(filled.value.liters) });
      toasts.show(
        filled.value.cost === 0
          ? strings.t('toast.emergencyFuel', { liters })
          : strings.t('toast.refuelled', { liters, cost: strings.money(filled.value.cost) }),
        'success',
      );
    } else if (filled.error === 'insufficientFunds') {
      toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
    } else if (filled.error === 'notAtServicePoint') {
      toasts.show(strings.t('hq.serviceAway'), 'warning');
    }
  };
  const repair = (): void => {
    const repaired = damage.repair();
    if (repaired.ok) {
      toasts.show(strings.t('toast.repaired', { cost: strings.money(repaired.value) }), 'success');
    } else if (repaired.error === 'insufficientFunds') {
      toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
    } else if (repaired.error === 'notAtServicePoint') {
      toasts.show(strings.t('hq.serviceAway'), 'warning');
    }
  };
  const restArea = new RestAreaPanel(ui, strings, { driving, fuel, damage, economy }, { onRefuel: () => refuel(false), onRepair: repair });
  const roadsideFuelOffer = (): RoadsideFuelOffer => {
    if (fuel.missingLiters < 0.5) {
      return null;
    }
    if (fuel.isEmpty && economy.litersAffordable(economy.credits, true) === 0) {
      return 'emergency';
    }
    return { cost: strings.money(Math.min(fuel.fillUpCost(true), economy.credits)) };
  };
  const pause = (): void => {
    if (isDriving() && !paused && !result.isOpen && !hq.isOpen) {
      paused = true;
      pauseMenu.open(missions.active !== null, roadsideFuelOffer());
    }
  };
  const resume = (): void => {
    pauseMenu.close();
    paused = false;
  };
  const pauseMenu = new PauseMenu(ui, strings, {
    onPauseRequested: pause,
    onResume: () => {
      paused = false;
    },
    onRecover: () => {
      driving.recover();
      paused = false;
    },
    onRoadsideFuel: () => {
      refuel(true);
      paused = false;
    },
    onAbandon: () => {
      paused = false;
      missions.abandon(); // MissionFailed opens the result.
    },
    onMainMenu: () => {
      paused = false;
      gameState.transitionTo('mainMenu');
    },
    onSettings: () => openSettings(),
    onMap: () => openMap(),
  });
  const keyboard = new KeyboardInput(window, {
    onToggleCamera: toggleCamera,
    onHorn: honk,
    onMap: () => {
      if (worldMap.isOpen) {
        closeMap();
      } else if (!settingsDialog.isOpen && !newCompany.isOpen && !result.isOpen && isDriving()) {
        openMap();
      }
    },
    onPause: () => {
      if (settingsDialog.isOpen) {
        settingsDialog.close(); // Over the pause menu, which stays.
      } else if (worldMap.isOpen) {
        closeMap();
      } else if (hq.isOpen) {
        closePanel();
      } else if (pauseMenu.isOpen) {
        resume();
      } else {
        pause();
      }
    },
  });

  const menuMessage = (): string | null => (persistent ? null : strings.t('menu.storageOff'));
  /** What the garage shows on the truck before it is bought (the company panel's previews); null for nothing. */
  let truckPreview: TruckPreview | null = null;
  /**
   * Shows the truck being driven, with its paint and upgraded parts, or with
   * what the garage previews on it: another look gets its own view, and the
   * camera follows it.
   */
  const showTruck = (): void => {
    const active = garage.activeTruck;
    let definition = driving.definition;
    let paint = active.paint?.color ?? definition.factoryColor;
    let fitted = active.upgrades;
    if (truckPreview?.kind === 'paint') {
      paint = truckPreview.paintId === null ? definition.factoryColor : content.paints.get(truckPreview.paintId).color;
    } else if (truckPreview?.kind === 'upgrade') {
      const upgrade = content.upgrades.get(truckPreview.upgradeId);
      fitted = { ...fitted, [upgrade.id]: Math.min(upgrade.levels.length, (fitted[upgrade.id] ?? 0) + 1) };
    } else if (truckPreview?.kind === 'truck') {
      const model = content.vehicles.get(truckPreview.definitionId);
      const owned = garage.trucks.find((candidate) => candidate.definition.id === model.id);
      definition = model;
      paint = owned?.paint?.color ?? model.factoryColor;
      fitted = owned?.upgrades ?? {};
    }
    const options = {
      lampGlows,
      castShadows,
      sky: environment.sky,
      light: environment.light,
      paint,
      looks: truckLooks(fitted, content.upgrades.all),
    };
    if (truck.key !== truckViewKey(definition, options)) {
      truck.dispose();
      truck = new TruckView(renderHost.scene, definition, options);
      // The street lamps and the traffic's headlights light the new truck too (its own shine ahead of it), and the
      // clouds shade it.
      if (!software) {
        cloudShadows.shadeScene(renderHost.scene, prelit);
        environment.mist.shadeScene(renderHost.scene);
      }
      if (lampLight) {
        lampLighting.lightScene(renderHost.scene, prelit);
      }
      cameraRig.setBody(definition.body);
      showCamera(onRoad());
    }
    truck.setLoaded(truckPreview?.kind !== 'truck' && driving.cargoMassKg > 0);
    root.dataset.vehicle = driving.definition.id;
    root.dataset.paint = active.paint?.id ?? 'factory';
    root.dataset.truckView = truck.key;
  };
  const enterCompany = (): void => {
    truckPreview = null;
    showTruck();
    syncMissionView();
    root.dataset.tutorialStep = tutorial.step;
    gameState.transitionTo('driving');
  };
  const newCompany = new NewCompanyDialog(ui, strings, {
    onStart: (companyName) => {
      const founded = session.startNewGame(companyName);
      if (!founded.ok) {
        return founded.error;
      }
      newCompany.close();
      enterCompany();
      return null;
    },
    onBack: () => newCompany.close(),
  });
  const mainMenu = new MainMenu(ui, strings, {
    onContinue: () => {
      const continued = session.continueGame();
      if (continued.ok) {
        enterCompany();
      } else {
        mainMenu.update(session.hasSavedGame(), strings.t(`menu.problem.${continued.error}`));
      }
    },
    onNewCompany: () => newCompany.open(session.hasSavedGame()),
    onSwitchLanguage: () => {
      query.set('lang', language === 'tr' ? 'en' : 'tr');
      window.location.search = query.toString();
    },
    onSettings: () => openSettings(),
  });
  /** Keeps the clock's time in the settings as the day goes on, so the next visit picks it up. */
  const keepClock = (): void => {
    if (requestedTime === null && timeOfDay.flow !== 'device') {
      settings = { ...settings, clockMinutes: timeOfDay.minutes };
      saveSettings(storage, settings);
    }
  };
  /**
   * Marks the time of day's look on the page (`data-daylight`: day, dawn,
   * dusk or night, for the tests), and says so on the road when it turns to
   * dawn, dusk or night.
   */
  const showDaylight = (): void => {
    const shown = timeOfDay.shown;
    if (shown === shownDaylight) {
      return;
    }
    const first = shownDaylight === '';
    shownDaylight = shown;
    root.dataset.daylight = shown;
    if (!first && shown !== 'day' && isDriving()) {
      toasts.show(strings.t(`daylight.${shown}.message`), 'info');
    }
  };
  /** Says so when the morning mist comes down thick while driving (e2e tests read the page's data-mist). */
  const showMist = (mist: number): void => {
    const shown = mist >= THICK_MIST ? 'thick' : 'none';
    if (shown === shownMist) {
      return;
    }
    const first = shownMist === '';
    shownMist = shown;
    root.dataset.mist = shown;
    if (!first && shown === 'thick' && isDriving()) {
      toasts.show(strings.t('mist.message'), 'info');
    }
  };
  /** The time today of each of the Settings' clock presets (they move with the seasons). */
  const clockPresets = (): Record<ClockPreset, number> => {
    const presets = {} as Record<ClockPreset, number>;
    for (const preset of CLOCK_PRESETS) {
      presets[preset] = timeOfDay.timeOf(preset);
    }
    return presets;
  };
  const openSettings = (): void => {
    keepClock();
    settingsDialog.showClock(timeOfDay.minutes, clockPresets());
    settingsDialog.open();
  };
  const settingsDialog = new SettingsDialog(
    ui,
    strings,
    {
      ...settings,
      quality: qualityChoice,
      qualityInUse: quality,
      clockMinutes: timeOfDay.minutes,
      timeFlow: timeOfDay.flow,
      clockPresets: clockPresets(),
    },
    {
    onQuality: (choice) => {
      // A preset changes what the game builds at boot: start again with it. A `?quality=` would win over the
      // setting, so it goes, unless storage forgets the setting: then the address carries the choice. Kept in the
      // settings in memory too: leaving the page saves them again (the clock), and must not bring back the old one.
      settings = { ...settings, quality: choice };
      if (saveSettings(storage, settings) && persistent) {
        query.delete('quality');
      } else {
        query.set('quality', choice);
      }
      window.location.search = query.toString();
    },
    onSteering: (mode) => {
      settings = { ...settings, steering: mode };
      saveSettings(storage, settings);
      applySteering(mode);
    },
    onTiltSensitivity: (sensitivity) => {
      settings = { ...settings, tiltSensitivity: sensitivity };
      saveSettings(storage, settings);
      tilt.sensitivity = sensitivity;
    },
    onControlSize: (size) => {
      settings = { ...settings, controlSize: size };
      saveSettings(storage, settings);
      touch.size = size;
    },
    onSound: (on) => {
      settings = { ...settings, sound: on };
      saveSettings(storage, settings);
      audio.enabled = on;
    },
    onStats: (on) => {
      settings = { ...settings, stats: on };
      saveSettings(storage, settings);
      perfOverlay.visible = on || config.debug.showPerfOverlay;
    },
    onClock: (minutes) => {
      timeOfDay.set(minutes);
      settings = { ...settings, clockMinutes: timeOfDay.minutes };
      saveSettings(storage, settings);
    },
    onTimeFlow: (flow) => {
      timeOfDay.flow = flow;
      settings = { ...settings, timeFlow: flow, clockMinutes: timeOfDay.minutes };
      saveSettings(storage, settings);
      settingsDialog.showClock(timeOfDay.minutes, clockPresets());
    },
    onClose: () => settingsDialog.close(),
    },
  );
  const hq = new CompanyHq(
    ui,
    strings,
    { content, driving, missions, economy, company, fuel, damage, garage, upgrades, specialEvents, dailyContracts, fleet, rivals, clock },
    {
      onAccept: (missionId) => {
        const accepted = missions.accept(missionId);
        if (accepted.ok) {
          closePanel();
        } else {
          logger.warn(`Could not take ${missionId}: ${accepted.error}.`);
        }
      },
      onRefuel: () => refuel(false),
      onRepair: repair,
      onBuyTruck: (definitionId) => {
        const bought = garage.buy(definitionId);
        if (bought.ok) {
          toasts.show(strings.t('toast.truckBought', { truck: strings.vehicleName(definitionId) }), 'success');
        } else if (bought.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else if (bought.error === 'garageFull') {
          toasts.show(strings.t('toast.garageFull'), 'warning');
        } else {
          logger.warn(`Could not buy ${definitionId}: ${bought.error}.`);
        }
      },
      onPaintTruck: (instanceId, paintId) => {
        const painted = garage.paint(instanceId, paintId);
        if (painted.ok) {
          const paint = paintId === null ? strings.t('hq.garage.factoryPaint') : strings.t(`paint.${paintId}.name`);
          toasts.show(strings.t('toast.painted', { truck: strings.vehicleName(painted.value.definition.id), paint }), 'success');
        } else if (painted.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else {
          logger.warn(`Could not paint ${instanceId} ${paintId}: ${painted.error}.`);
        }
      },
      onSwitchTruck: (instanceId) => {
        const switched = garage.switchTo(instanceId);
        if (switched.ok) {
          toasts.show(strings.t('toast.truckSwitched', { truck: strings.vehicleName(switched.value.definition.id) }), 'success');
        } else if (switched.error === 'onTheRoad') {
          toasts.show(strings.t('toast.truckOnTheRoad'), 'warning');
        } else {
          logger.warn(`Could not switch to ${instanceId}: ${switched.error}.`);
        }
      },
      onHireDriver: (driverId) => {
        const hired = fleet.hire(driverId);
        if (hired.ok) {
          toasts.show(strings.t('toast.driverHired', { driver: driverName(strings, hired.value.definition) }), 'success');
        } else if (hired.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else {
          logger.warn(`Could not hire ${driverId}: ${hired.error}.`);
        }
      },
      onDismissDriver: (driverId) => {
        const dismissed = fleet.dismiss(driverId);
        if (dismissed.ok) {
          toasts.show(strings.t('toast.driverDismissed', { driver: driverName(strings, { id: driverId }) }), 'info');
        } else {
          logger.warn(`Could not dismiss ${driverId}: ${dismissed.error}.`);
        }
      },
      onAssignDriver: (driverId, instanceId) => {
        const assigned = fleet.assign(driverId, instanceId);
        if (assigned.ok) {
          const truckName = `${strings.vehicleName(garage.trucks.find((owned) => owned.instanceId === instanceId)!.definition.id)} ${truckNumber(instanceId)}`;
          toasts.show(strings.t('toast.fleetSentOut', { driver: driverName(strings, { id: driverId }), truck: truckName }), 'success');
        } else {
          logger.warn(`Could not send ${instanceId} out with ${driverId}: ${assigned.error}.`);
        }
      },
      onRecallTruck: (driverId) => {
        const instanceId = fleet.hired.find((driver) => driver.definition.id === driverId)?.truckInstanceId ?? null;
        const recalled = fleet.recall(driverId);
        if (recalled.ok && instanceId !== null) {
          const truckName = `${strings.vehicleName(garage.trucks.find((owned) => owned.instanceId === instanceId)!.definition.id)} ${truckNumber(instanceId)}`;
          toasts.show(strings.t('toast.fleetCalledBack', { truck: truckName }), 'info');
        } else if (!recalled.ok) {
          logger.warn(`Could not call ${driverId}'s truck back: ${recalled.error}.`);
        }
      },
      onCampaign: (cityId) => {
        const run = rivals.runCampaign(cityId);
        if (run.ok) {
          toasts.show(strings.t('toast.campaignRun', { city: strings.cityName(cityId) }), 'success');
        } else if (run.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else if (run.error === 'coolingDown') {
          toasts.show(strings.t('toast.campaignCoolingDown'), 'warning');
        } else {
          logger.warn(`Could not run a campaign in ${cityId}: ${run.error}.`);
        }
      },
      onBuyOut: (rivalId) => {
        const bought = rivals.acquire(rivalId);
        if (bought.ok) {
          toasts.show(strings.t('toast.rivalAcquired', { company: strings.rivalName(rivalId) }), 'success');
        } else if (bought.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else if (bought.error === 'tooStrong') {
          toasts.show(strings.t('toast.rivalTooStrong'), 'warning');
        } else {
          logger.warn(`Could not buy ${rivalId} out: ${bought.error}.`);
        }
      },
      onBuyUpgrade: (upgradeId) => {
        const fitted = upgrades.buy(upgradeId);
        if (fitted.ok) {
          toasts.show(strings.t('toast.upgraded', { upgrade: strings.upgradeName(upgradeId), level: fitted.value }), 'success');
        } else if (fitted.error === 'insufficientFunds') {
          toasts.show(strings.t('toast.notEnoughCredits'), 'warning');
        } else {
          logger.warn(`Could not fit ${upgradeId}: ${fitted.error}.`);
        }
      },
      onPreview: (preview) => {
        truckPreview = preview;
        showTruck();
        // The showroom turns to what is previewed.
        if (preview?.kind === 'upgrade') {
          cameraRig.turnShowcaseTo(SHOWCASE_PART_ANGLES[content.upgrades.get(preview.upgradeId).look]);
        } else if (preview?.kind === 'paint') {
          cameraRig.turnShowcaseTo(SHOWCASE_PAINT_ANGLE);
        }
      },
      onOpenMap: () => openMap(),
      onClose: () => closePanel(),
    },
  );
  // The company's pages from the road.
  const dock = new HudDock(ui, strings, (tab) => openPanel(tab));
  /**
   * Opens the company panel on `tab` over the road. The truck waits; if it
   * was moving, traffic and weather wait with it, else the world goes on.
   */
  const openPanel = (tab: HqTab): void => {
    if (!isDriving() || paused || result.isOpen) {
      return;
    }
    if (hq.isOpen) {
      hq.selectTab(tab);
      return;
    }
    worldHeld = Math.abs(driving.vehicle.speed) > PANEL_STANDSTILL_SPEED;
    lookAround.reset();
    hq.open(tab);
    showHud();
  };
  /** Back on the road: straight ahead the way the phone is held now. */
  const closePanel = (): void => {
    if (!hq.isOpen) {
      return;
    }
    hq.close();
    showHud();
    tilt.recenter();
  };
  /** The drive stands still while the map is open over the road; it goes on when the map closes, unless paused before. */
  let pausedForMap = false;
  const openMap = (): void => {
    if (worldMap.isOpen) {
      return;
    }
    if (isDriving() && !paused) {
      paused = true;
      pausedForMap = true;
    }
    worldMap.open();
  };
  const closeMap = (): void => {
    worldMap.close();
    if (pausedForMap) {
      pausedForMap = false;
      paused = false;
    }
  };
  const worldMap = new WorldMap(ui, strings, mapPainter, mapSketch, driving, { onClose: closeMap });
  // The performance display, with `?debug` or switched on in Settings; its last line names the preset and GPU for test reports.
  const perfOverlay = new PerfOverlay(ui, `${quality} · ${renderHost.pipeline} · ${renderHost.gpu}`);
  perfOverlay.visible = config.debug.showPerfOverlay || settings.stats;

  /** The picked way of steering: its controls show, and tilt steering listens to the motion sensor only while picked. */
  const applySteering = (mode: SteeringMode): void => {
    touch.steering = mode;
    if (mode === 'tilt') {
      tilt.enable(); // From the Settings tap, iOS can ask for the motion sensor at once.
    } else {
      tilt.disable();
    }
  };
  /** Tilt steering's state on the tilt button (and for the e2e tests). Without a motion sensor, back to the wheel. */
  function showTilt(status: TiltStatus): void {
    touch.showTilt(status);
    root.dataset.tilt = status;
    if (status === 'unavailable') {
      settings = { ...settings, steering: 'wheel' };
      saveSettings(storage, settings);
      settingsDialog.showSteering('wheel');
      applySteering('wheel');
      toasts.show(strings.t('toast.tiltUnavailable'), 'warning');
    }
  }
  root.dataset.tilt = tilt.status;
  applySteering(settings.steering);
  const tutorialHint = new TutorialHint(ui, hq.hintSlot, strings, () => tutorial.skip());
  /**
   * Where the tutorial's hint would show now: in the panel, over the road, or
   * nowhere (menus, pause, a result, or the rest area's counter in its place).
   */
  const hintPlace = (): TutorialPlace | null => {
    if (!isDriving() || paused || result.isOpen) {
      return null;
    }
    if (hq.isOpen) {
      return 'panel';
    }
    return restArea.isOpen ? null : 'road';
  };

  /** Points the depot beacon and the test hook at the contract under way, and shows a flatbed's load. */
  const syncMissionView = (): void => {
    const target = missions.target;
    depots.setTarget(target?.depot.id ?? null, target?.kind);
    root.dataset.missionState = missions.active?.state ?? 'none';
    truck.setLoaded(driving.cargoMassKg > 0);
  };
  const refreshHq = (): void => {
    if (hq.isOpen) {
      hq.refresh();
    }
    if (restArea.isOpen) {
      restArea.refresh();
    }
  };
  events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) => audio.crash(impactSpeedMetersPerSecond));
  events.on('MissionStateChanged', ({ current }) => {
    if (current === 'loaded') {
      audio.clunk();
    }
    syncMissionView();
    root.dataset.missionState = current;
  });
  events.on('CargoDamaged', () => hud.flashCargoDamage());
  events.on('MissionCompleted', (delivery) => {
    audio.chime();
    paused = true;
    pauseMenu.close();
    pauseMenu.buttonVisible = false;
    result.showCompleted(delivery.mission, delivery, economy.credits);
  });
  events.on('MissionFailed', ({ mission, reason, reputationLost }) => {
    audio.fail();
    paused = true;
    pauseMenu.close();
    pauseMenu.buttonVisible = false;
    result.showFailed(mission, reason, reputationLost);
  });
  events.on('EventProgressed', ({ eventId, bonus, progress, reward }) => {
    const name = strings.eventName(eventId);
    const objective = objectiveText(strings, content.events.get(eventId).objective, progress);
    if (result.isOpen) {
      result.showEventProgress(name, bonus, objective, reward);
    } else {
      toasts.show(reward === null ? `${name}: ${objective}` : strings.t('toast.eventCompleted', { event: name }), 'success');
    }
  });
  events.on('CompanyLevelUp', ({ level }) => {
    const name = strings.t(`company.levelName.${level}`);
    if (result.isOpen) {
      result.showLevelUp(level);
    } else {
      toasts.show(strings.t('toast.levelUp', { name }), 'success');
    }
  });
  let warnedLowFuel = false;
  events.on('FuelChanged', ({ liters }) => {
    refreshHq();
    if (!isDriving()) {
      return;
    }
    if (liters <= 0) {
      toasts.show(strings.t('toast.outOfFuel'), 'warning');
    } else if (fuel.isLow && !warnedLowFuel) {
      toasts.show(strings.t('toast.lowFuel'), 'warning');
    }
    warnedLowFuel = fuel.isLow;
  });
  events.on('VehicleDamaged', ({ damage: total, addedDamage }) => {
    if (addedDamage >= 0.02) {
      toasts.show(strings.t('toast.truckDamaged', { percent: strings.percent(total) }), 'warning');
    }
  });
  events.on('TutorialStepChanged', ({ step, previous }) => {
    root.dataset.tutorialStep = step;
    if (step === 'done' && previous === 'buyUpgrade') {
      toasts.show(strings.t('tutorial.finished'), 'success');
    }
  });
  events.on('WeatherChanged', ({ weatherId }) => {
    root.dataset.weather = weatherId;
    if (isDriving()) {
      toasts.show(strings.t(`weather.${weatherId}.message`), 'info');
    }
  });
  events.on('MoneyChanged', refreshHq);
  events.on('VehicleRepaired', refreshHq);
  events.on('VehiclePurchased', refreshHq);
  for (const name of ['DriverHired', 'DriverDismissed', 'FleetTruckAssigned', 'FleetTruckRepaired'] as const) {
    events.on(name, refreshHq);
  }
  events.on('FleetJobCompleted', ({ driverId, originCityId, destinationCityId, profit, away }) => {
    refreshHq();
    if (!away) {
      const route = `${strings.cityName(originCityId)} → ${strings.cityName(destinationCityId)}`;
      toasts.show(strings.t('toast.fleetDelivered', { driver: driverName(strings, { id: driverId }), route, profit: strings.signedMoney(profit) }), 'success');
    }
  });
  events.on('FleetTruckRepaired', ({ driverId, cost }) =>
    toasts.show(strings.t('toast.fleetRepaired', { driver: driverName(strings, { id: driverId }), cost: strings.money(cost) }), 'info'),
  );
  events.on('FleetCaughtUp', ({ jobs, credits }) => {
    if (jobs > 0) {
      toasts.show(strings.t('toast.fleetAway', { jobs: strings.number(jobs), credits: strings.signedMoney(credits) }), 'success');
    }
  });
  // The rivals: the panel keeps up; the player hears of what touches their company.
  for (const name of ['RivalTruckBought', 'RivalAcquired'] as const) {
    events.on(name, refreshHq);
  }
  events.on('CityLeaderChanged', ({ cityId, previousId, leaderId, away }) => {
    refreshHq();
    if (away) {
      return;
    }
    const city = strings.cityName(cityId);
    if (leaderId === PLAYER_COMPANY_ID) {
      toasts.show(strings.t('toast.cityWon', { city, bonus: strings.percent(rivals.terms.leaderBonus) }), 'success');
    } else if (previousId === PLAYER_COMPANY_ID) {
      toasts.show(
        leaderId === null ? strings.t('toast.cityContested', { city }) : strings.t('toast.cityLost', { city, company: strings.rivalName(leaderId) }),
        'warning',
      );
    }
  });
  events.on('CampaignRun', ({ companyId, cityId, away }) => {
    refreshHq();
    if (!away && companyId !== PLAYER_COMPANY_ID && rivals.leaderOf(cityId) === PLAYER_COMPANY_ID) {
      toasts.show(strings.t('toast.rivalCampaign', { company: strings.rivalName(companyId), city: strings.cityName(cityId) }), 'warning');
    }
  });
  events.on('TenderPosted', ({ missionId, rivalId }) => {
    refreshHq();
    const tender = rivals.tenderFor(missionId);
    if (tender !== null && isDriving()) {
      toasts.show(strings.t('toast.tenderPosted', { route: routeText(strings, tender.contract), company: strings.rivalName(rivalId) }), 'info');
    }
  });
  events.on('TenderRivalArrived', ({ rivalId }) =>
    toasts.show(strings.t('toast.tenderRivalArrived', { company: strings.rivalName(rivalId) }), 'warning'),
  );
  events.on('TenderDecided', ({ won, rivalId, prize }) => {
    if (result.isOpen) {
      result.showTender(won, strings.rivalName(rivalId), prize);
    }
  });
  events.on('LeaderBonusPaid', ({ cityId, bonus }) => {
    if (result.isOpen) {
      result.showLeaderBonus(strings.cityName(cityId), bonus);
    }
  });
  // A purchase ends any preview (refreshHq), then the truck shows what was bought.
  for (const name of ['UpgradePurchased', 'VehiclePainted', 'ActiveVehicleChanged'] as const) {
    events.on(name, () => {
      refreshHq();
      showTruck();
    });
  }

  /** The showroom frames the truck beside the panel; on the road and behind the menus the view has the whole screen. */
  const frameShowroom = (): void => {
    const covered = hq.coveredShare();
    cameraRig.frameBeside(covered.right, covered.bottom);
  };
  /**
   * What shows over the world: on the road the controls, the HUD and the
   * company's buttons; with the panel open only the panel, and the truck in
   * its showroom light beside it; behind the main menu the circling camera.
   */
  const showHud = (): void => {
    const road = onRoad();
    touch.visible = road;
    hud.visible = road;
    minimap.visible = road;
    dock.visible = road;
    pauseMenu.buttonVisible = road && !result.isOpen;
    lookAround.enabled = road;
    cameraRig.showcase = !road;
    showCamera(road);
    root.dataset.panel = hq.isOpen ? 'open' : 'none';
    frameShowroom();
  };
  const showState = (state: GameState): void => {
    root.dataset.gameState = state;
    const drivingNow = state === 'driving';
    mainMenu.visible = state === 'mainMenu';
    if (state === 'mainMenu') {
      mainMenu.update(session.hasSavedGame(), menuMessage());
    }
    if (!drivingNow) {
      hq.close();
      toasts.clear();
    } else {
      // Into the game: straight ahead the way the phone is held, in D.
      tilt.recenter();
      touch.gear = 'drive';
      if (tilt.status === 'locked') {
        toasts.show(strings.t('toast.tiltLocked'), 'info');
      }
    }
    showHud();
  };
  events.on('GameStateChanged', ({ previous, current }) => {
    if (previous === 'driving') {
      // Parked where it was left: the next drive starts from there, at rest.
      const { x, z, heading } = driving.vehicle;
      driving.placeTruck(x, z, heading);
    }
    showState(current);
  });
  root.dataset.missionState = 'none';
  root.dataset.vehicle = driving.definition.id;
  root.dataset.weather = weather.current.id;
  root.dataset.quality = quality;
  logger.info(`Graphics: ${quality}.`);
  showState(gameState.current);

  /** The player leaves for now (another tab, the app in the background): the truck waits, and the game saves. */
  const leave = (): void => {
    pause();
    session.save();
    keepClock();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      leave();
      audio.suspend();
    } else {
      adaptiveResolution.restart();
      audio.resume();
    }
  });
  // Sound may start once the page has been touched or typed on: a touch counts when the finger lifts. Starting it
  // earlier would only be refused, with a warning. iOS shares the motion sensor (tilt steering) only from a tap too.
  // A button pressed clicks (not the pedals, steering buttons or the horn: they are held).
  const unlockSound = (): void => {
    // Browsers without navigator.userActivation (older Safari and Firefox) get their chance at every gesture.
    if ((navigator.userActivation as UserActivation | undefined)?.hasBeenActive ?? true) {
      audio.unlock();
      tilt.unlock();
    }
  };
  window.addEventListener('pointerup', unlockSound, { capture: true });
  window.addEventListener('keydown', unlockSound, { capture: true });
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button:not(.pedal, .horn-button, .steer-button)') !== null) {
      audio.click();
    }
  });
  window.addEventListener('pagehide', () => session.save());

  /** Android's back button (backAction): false at the main menu, where it puts the app away. */
  const goBack = (): boolean => {
    const action = backAction({
      gameState: gameState.current,
      menuDialogOpen: settingsDialog.isOpen || newCompany.isOpen || worldMap.isOpen,
      panelOpen: hq.isOpen,
      pauseMenuOpen: pauseMenu.isOpen,
      resultOpen: result.isOpen,
    });
    switch (action) {
      case 'closeDialog':
        settingsDialog.close();
        newCompany.close();
        closeMap();
        break;
      case 'closePanel':
        closePanel();
        break;
      case 'pause':
        pause();
        break;
      case 'resume':
        resume();
        break;
      case 'stay':
        break;
      case 'leaveApp':
        return false;
    }
    return true;
  };
  if (isNativeApp(window)) {
    import('./platform/native/capacitorShell')
      .then(({ capacitorShell }) => attachNativeApp(capacitorShell(), { back: goBack, leave }))
      .catch((error: unknown) => logger.error('The Android app shell did not load.', error));
  }

  if (config.debug.showPerfOverlay) {
    // Debug: T parks the truck in the bay the mission needs next, Y at the first rest area; F runs the fleet and the rivals
    // 10 minutes on.
    window.addEventListener('keydown', (event) => {
      if (event.repeat || !onRoad() || paused) {
        return;
      }
      if (event.code === 'KeyF') {
        fleet.update(FLEET_FAST_FORWARD_SECONDS);
        rivals.update(FLEET_FAST_FORWARD_SECONDS);
        return;
      }
      const target = missions.target;
      const restArea = driving.world.restAreas[0];
      const spot = event.code === 'KeyT' ? target?.depot.bay : event.code === 'KeyY' ? restArea?.lot : undefined;
      if (spot !== undefined) {
        const parked = bayParkingPose(spot, driving.definition.body);
        driving.placeTruck(parked.x, parked.z, parked.heading);
      }
    });
  }

  /** The rain's streaks and the power lines' wires are sized in pixels. */
  const fitPixelSizes = (): void => {
    const width = canvas.clientWidth * renderHost.pixelRatio;
    const height = canvas.clientHeight * renderHost.pixelRatio;
    rain.setViewport(width, height);
    scenery.setViewport(width, height);
  };
  const resize = (): void => {
    renderHost.setSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    fitPixelSizes();
    if (hq.isOpen) {
      frameShowroom();
    }
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  /** The keyboard and the touch controls together; tilt steering joins them in `driverInput`. */
  const controlsInput = createVehicleInput();
  const driverInput = createVehicleInput();
  /** What the cab's instruments read beyond the truck's motion, refreshed every frame (no allocation). */
  const dashboard = { fuelFraction: 1, clockMinutes: 0, drivePedal: 0, brakePedal: 0 };
  let menuFrames = 0;
  const pose = { x: 0, z: 0, heading: 0 };
  const loop = new GameLoop(
    animationFrameScheduler,
    new FixedTimestep(
      config.simulation.fixedStepSeconds,
      software ? Math.max(SOFTWARE_MAX_STEPS_PER_FRAME, config.simulation.maxStepsPerFrame) : config.simulation.maxStepsPerFrame,
    ),
    {
      fixedUpdate: (stepSeconds) => {
        if (paused || (hq.isOpen && worldHeld)) {
          return;
        }
        // Traffic moves first, so the truck collides with where it is now. It drives behind the menus and the
        // panel too, under the weather, while the truck waits.
        traffic.update(stepSeconds);
        timeOfDay.update(stepSeconds);
        weather.update(stepSeconds);
        // The fleet's drivers and the rivals work on while the player is in the panel or the menus.
        fleet.update(stepSeconds);
        rivals.update(stepSeconds);
        if (!onRoad()) {
          return;
        }
        combineVehicleInputs(controlsInput, keyboard.state, touch.state);
        combineVehicleInputs(driverInput, controlsInput, tilt.state);
        driving.step(stepSeconds, driverInput);
        missions.update(stepSeconds);
        navigation.update(stepSeconds);
        fuel.update();
        session.update(stepSeconds);
      },
      frameUpdate: (deltaSeconds, alpha) => {
        const simulating = onRoad() && !paused;
        const worldStill = paused || (hq.isOpen && worldHeld);
        touch.update(deltaSeconds);
        tilt.update(deltaSeconds);
        const vehicle = driving.vehicle;
        // Standing still, show the current pose: interpolating would rock the truck between two steps.
        interpolatePose(pose, driving.previousPose, vehicle, simulating ? alpha : 1);
        roadFurniture.update(pose.x, pose.z, pose.heading);
        // The sky: the time of day's look with the weather's over it. Its lamps light up at dusk and in the rain.
        mixWeather(weather.previous.look, weather.current.look, weather.blend, weatherLook);
        composeSky(
          clearDay,
          timeOfDay.twilight.look,
          timeOfDay.nightLook.look,
          timeOfDay.weights,
          timeOfDay.sunUp,
          timeOfDay.moonlit,
          weatherLook,
          skyLook,
        );
        const lamps = skyLook.lamps;
        // The roads stay wet a while after the rain: they shine, and a low sun shows a rainbow in the drops still about.
        const wetness = keptWetness ?? weather.wetness;
        showDaylight();
        track.setLamps(lamps);
        track.setWetness(wetness);
        track.setRain(weather.rain);
        track.update(paused ? 0 : deltaSeconds);
        roadFurniture.setLamps(lamps);
        streetLamps.setLamps(lamps);
        citySigns.setLamps(lamps);
        windTurbines.setLamps(lamps);
        windTurbines.update(paused ? 0 : deltaSeconds);
        // The towns' people: fewer out at night and in the rain, their umbrellas up when it rains.
        const night = timeOfDay.weights.night + 0.4 * timeOfDay.weights.twilight;
        pedestrians.update(
          paused ? 0 : deltaSeconds,
          renderHost.camera.position,
          (1 - 0.7 * night) * (1 - 0.45 * weather.rain),
          Math.min(1, Math.max(0, (weather.rain - 0.1) / 0.3)),
        );
        scenery.update(paused ? 0 : deltaSeconds);
        cloudShadows.drift(paused ? 0 : deltaSeconds);
        harbour?.setLamps(lamps);
        harbour?.update(paused ? 0 : deltaSeconds);
        seaView?.update(paused ? 0 : deltaSeconds);
        birds.update(paused ? 0 : deltaSeconds, lamps, weather.rain);
        trafficView.setLamps(lamps);
        truck.setLamps(lamps);
        truck.setRain(weather.rain);
        // The pedals as the truck reads them (VehicleDynamics): on auto they swap roles in reverse.
        const reversing = vehicle.gear < 0;
        dashboard.fuelFraction = fuel.fraction;
        dashboard.clockMinutes = timeOfDay.minutes;
        dashboard.drivePedal = drivePedalOf(driverInput.throttle, driverInput.brake, driverInput.lever, reversing);
        dashboard.brakePedal = brakePedalOf(driverInput.throttle, driverInput.brake, driverInput.lever, reversing);
        truck.setDashboard(dashboard);
        truck.setNavigation(minimap.picture, minimap.paintCount);
        truck.update(pose, vehicle, simulating ? deltaSeconds : 0);
        trafficView.update(traffic.simulation, worldStill ? 1 : alpha);
        gpsRoute.update(vehicle.x, vehicle.z, vehicle.heading, driving.world.roads);
        const vehicles = traffic.simulation?.vehicleCount ?? 0;
        if (vehicles !== shownTraffic) {
          shownTraffic = vehicles;
          root.dataset.traffic = String(vehicles);
        }
        lookAround.update(deltaSeconds);
        cameraRig.look(lookAround.yaw, lookAround.pitch);
        cameraRig.update(pose, vehicle, deltaSeconds);
        lampLighting.setWetness(wetness);
        lampLighting.update(truck, trafficView, renderHost.camera, lamps);
        mirroredSources[0] = truck;
        wetReflections?.update(renderHost.camera, wetness, weather.rain, lamps, paused ? 0 : deltaSeconds, mirroredSources);
        // Paused, no new strike: a flash under way still dies away. Half the strikes land where the camera looks
        // (its world matrix's -Z column).
        const look = renderHost.camera.matrixWorld.elements;
        const strike = storm.update(deltaSeconds, paused ? 0 : weather.rain, Math.atan2(-look[8]!, -look[10]!));
        if (strike !== null) {
          lightning.strike(strike, renderHost.camera.position);
          audio.thunder(strike.distanceMeters);
        }
        lightning.update(storm.flash, renderHost.camera.position);
        environment.setLightning(storm.flash);
        environment.setWetness(wetness);
        // Mist lies in the morning after a clear night, thicker after rain, and lifts as the sun climbs.
        const mist =
          keptMist ?? morningMist(timeOfDay.sunElevationDegrees, timeOfDay.sunRising, weather.rain, skyLook.cloudCover, wetness);
        environment.setMist(mist);
        showMist(mist);
        environment.applySky(skyLook, timeOfDay, prelit);
        cloudShadows.setClouds(skyLook.cloudCover, environment.sunShare);
        environment.update(renderHost.camera.position, paused ? 0 : deltaSeconds);
        environment.focusShadows(pose.x, pose.z);
        const eye = renderHost.camera.position;
        roadside.update(eye.x, eye.z, paused ? 0 : deltaSeconds);
        rain.update(paused ? 0 : deltaSeconds, eye.x, eye.z, weather.rain);
        // Exhaust, dust and spray. In reverse the pedals swap roles (VehicleDynamics): the brake pedal drives.
        effectsState.driving = simulating;
        effectsState.engineRunning = driving.isEngineRunning;
        effectsState.engineRpm = vehicle.engineRpm;
        effectsState.idleRpm = driving.definition.powertrain.idleRpm;
        effectsState.maxRpm = driving.definition.powertrain.maxRpm;
        effectsState.drivePedal = dashboard.drivePedal;
        effectsState.speed = vehicle.speed;
        effectsState.heading = pose.heading;
        effectsState.offRoad = driving.surface.name === 'grass';
        effectsState.wetness = wetness;
        truckEffects.update(paused ? 0 : deltaSeconds, truck, effectsState, renderHost.camera);
        depots.update(deltaSeconds, renderHost.camera.position.x, renderHost.camera.position.z);
        hud.update(deltaSeconds);
        minimap.update(deltaSeconds);
        const clockMinute = Math.floor(timeOfDay.minutes);
        if (clockMinute !== shownClockMinute) {
          shownClockMinute = clockMinute;
          minimap.showClock(formatClock(clockMinute));
        }
        sinceClockKept += deltaSeconds;
        if (sinceClockKept > CLOCK_KEEP_SECONDS) {
          sinceClockKept = 0;
          keepClock();
        }
        sinceHqTick += deltaSeconds;
        if (sinceHqTick > HQ_TICK_SECONDS) {
          sinceHqTick = 0;
          hq.tick();
        }
        worldMap.frame();
        restArea.visible = simulating;
        restArea.update();
        const tutorialStep = tutorial.step;
        const tutorialAt = hintPlace();
        tutorialHint.show(tutorialAt !== null && tutorialShows(tutorialStep, tutorialAt) ? tutorialStep : null, tutorialAt);
        dock.busy = missions.active !== null;
        toasts.update(deltaSeconds);
        // Slow frames on the road: fewer pixels (the rain's streaks and the wires keep their width in pixels). The menus,
        // drawn at half rate, are no measure.
        if (simulating && adaptiveResolution.frame(deltaSeconds)) {
          renderHost.setResolutionScale(adaptiveResolution.scale);
          fitPixelSizes();
        }
        // Behind the menus, the panel and the pause menu the scene is a backdrop: every other frame is enough, and
        // saves the battery (and the glass's blur of it). The full map hides it all.
        menuFrames = onRoad() && !paused ? 0 : menuFrames + 1;
        if ((menuFrames & 1) === 0 && !worldMap.isOpen) {
          renderHost.setGrade(environment.grade);
          renderHost.setSun(environment.sunTowards, environment.sunGlare, environment.sunShafts);
          renderHost.render();
        }
        touch.showTelemetry(metersPerSecondToKmh(vehicle.speed), vehicle.gear);
        touch.showCondition(fuel.fraction, fuel.isLow, damage.damage);
        soundState.driving = simulating;
        soundState.engineRunning = driving.isEngineRunning;
        soundState.engineRpm = vehicle.engineRpm;
        soundState.idleRpm = driving.definition.powertrain.idleRpm;
        soundState.maxRpm = driving.definition.powertrain.maxRpm;
        soundState.drivePedal = dashboard.drivePedal;
        soundState.brakePedal = dashboard.brakePedal;
        soundState.reversing = reversing;
        soundState.speed = vehicle.speed;
        soundState.rain = weather.rain;
        audio.update(soundState);
        if (audio.status !== shownSound) {
          shownSound = audio.status;
          root.dataset.sound = shownSound;
        }
        if (perfOverlay.visible) {
          perfOverlay.frame(deltaSeconds, renderHost.renderStats, renderHost.pixelRatio, pose);
        }
      },
      onError: (error) => {
        logger.error('The game loop stopped.', error);
        root.dataset.bootState = 'error';
        showFatalError(document, 'RoadHaul stopped because of an error.', error);
      },
    },
    {
      maxFrameDeltaSeconds: config.simulation.maxFrameDeltaSeconds,
      maxSimulationDeltaSeconds: software
        ? Math.max(SOFTWARE_MAX_SIMULATION_DELTA_SECONDS, config.simulation.maxFrameDeltaSeconds)
        : config.simulation.maxFrameDeltaSeconds,
    },
  );
  // Every view is in the scene: the clouds' shadows and the morning mist on the land (not drawn in software, where
  // every pixel's instructions count: the sky and its hills still show the mist), the lamps' light on everything, and
  // the GPU compiling the shaders now, behind the menu, not on the road.
  if (!software) {
    cloudShadows.shadeScene(renderHost.scene, prelit);
    environment.mist.shadeScene(renderHost.scene);
  }
  if (lampLight) {
    lampLighting.lightScene(renderHost.scene, prelit);
  }
  renderHost.precompile();
  loop.start();
  root.dataset.bootState = 'ready';
}

document.documentElement.dataset.bootState = 'booting';
start().catch((error: unknown) => {
  console.error(error);
  document.documentElement.dataset.bootState = 'error';
  showFatalError(document, 'RoadHaul could not start.', error);
});
