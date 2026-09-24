import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { metersPerSecondToKmh } from './core/math/scalar';
import { shiftedClock, systemClock } from './core/time/Clock';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import type { SteeringMode, TiltStatus } from './data/config/controls';
import { applyQualityPreset, DEFAULT_GAME_CONFIG } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { bayParkingPose } from './domain/missions/loadingBay';
import { combineVehicleInputs, createVehicleInput } from './domain/vehicles/VehicleInput';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { browserStorage } from './platform/browser/browserStorage';
import { applyConfigOverrides, requestedDateMs } from './platform/browser/configOverrides';
import { chooseQuality, detectQuality, deviceHints, qualitySetting } from './platform/browser/deviceQuality';
import { loadSettings, saveSettings } from './platform/browser/deviceSettings';
import { attachNativeApp, isNativeApp } from './platform/native/nativeApp';
import { showFatalError } from './platform/browser/fatalError';
import { KeyboardInput } from './platform/input/KeyboardInput';
import { TiltInput } from './platform/input/TiltInput';
import { CameraRig } from './presentation/cameras/CameraRig';
import { AdaptiveResolution } from './presentation/AdaptiveResolution';
import { createSoundState, GameAudio } from './presentation/audio/GameAudio';
import { RenderHost } from './presentation/RenderHost';
import { TruckView } from './presentation/vehicles/TruckView';
import { createTruckEffectsState, TruckEffects } from './presentation/vehicles/TruckEffects';
import { DepotView } from './presentation/world/DepotView';
import { EnvironmentView } from './presentation/world/EnvironmentView';
import { GpsRouteView } from './presentation/navigation/GpsRouteView';
import { TrafficView } from './presentation/traffic/TrafficView';
import { RainView } from './presentation/weather/RainView';
import { PrelitMaterials } from './presentation/world/lighting';
import { CitySignView } from './presentation/world/CitySignView';
import { FarmlandView } from './presentation/world/FarmlandView';
import { RestAreaView } from './presentation/world/RestAreaView';
import { StreetLampView } from './presentation/world/StreetLampView';
import { WindTurbineView } from './presentation/world/WindTurbineView';
import { TrackView } from './presentation/world/TrackView';
import { interpolatePose } from './systems/driving/DrivingService';
import type { GameState } from './systems/gameState/GameState';
import { LookAround } from './ui/controls/LookAround';
import { TouchControls } from './ui/controls/TouchControls';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import { CompanyHq } from './ui/hq/CompanyHq';
import { objectiveText } from './ui/hq/eventText';
import { Minimap } from './ui/hud/Minimap';
import { MissionHud } from './ui/hud/MissionHud';
import { RestAreaPanel } from './ui/hud/RestAreaPanel';
import { Toasts } from './ui/hud/Toasts';
import { TutorialHint, tutorialPlace } from './ui/hud/TutorialHint';
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
 * and debug tooling, and wires the game flow: main menu → company HQ (job
 * board, garage, upgrades, fuel, repairs) → driving the contract → result →
 * HQ. A company is started or continued from the main menu and saves itself
 * as it goes.
 *
 * `<html data-boot-state>` (booting | ready | error), `data-game-state`,
 * `data-mission-state`, `data-vehicle`, `data-traffic` and `data-weather`
 * let the end-to-end tests follow progress.
 */
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
  const services = await new GameBootstrapper({
    config,
    content: GAME_CONTENT,
    logger,
    clock,
    storage,
  }).boot();

  const content = services.resolve(ServiceKeys.content);
  const events = services.resolve(ServiceKeys.events);
  const gameState = services.resolve(ServiceKeys.gameState);
  const driving = services.resolve(ServiceKeys.driving);
  const traffic = services.resolve(ServiceKeys.traffic);
  const weather = services.resolve(ServiceKeys.weather);
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
  const environment = new EnvironmentView(renderHost.scene);
  const track = new TrackView(renderHost.scene, driving.world, { anisotropy: renderHost.anisotropy, prelit });
  const depots = new DepotView(renderHost.scene, driving.world.depots, { anisotropy: renderHost.anisotropy, prelit });
  new RestAreaView(renderHost.scene, driving.world, { anisotropy: renderHost.anisotropy, prelit });
  const lampGlows = config.rendering.lampGlows;
  const streetLamps = new StreetLampView(renderHost.scene, driving.world.streetLamps, { lampGlows });
  new FarmlandView(renderHost.scene, driving.world.fields, driving.world.hayBales, {
    anisotropy: renderHost.anisotropy,
    prelit,
  });
  const windTurbines = new WindTurbineView(renderHost.scene, driving.world.windTurbines, { lampGlows });
  const citySigns = new CitySignView(renderHost.scene, driving.world.citySigns, (cityId) => strings.cityName(cityId), {
    anisotropy: renderHost.anisotropy,
  });
  const trafficView = new TrafficView(renderHost.scene, content.trafficVehicles.all, config.traffic.maxVehicles, {
    lampGlows,
  });
  const gpsRoute = new GpsRouteView(renderHost.scene, navigation);
  const rain = new RainView(renderHost.scene, config.rendering.rainDensity);
  const truckEffects = new TruckEffects(renderHost.scene, config.rendering.particleDensity, prelit);
  const effectsState = createTruckEffectsState();
  const adaptiveResolution = new AdaptiveResolution(config.rendering.minResolutionScale);
  /** Vehicles on the road, as last written to the page (e2e tests read it). */
  let shownTraffic = -1;
  /** Whether sound plays, as last written to the page (e2e tests read it). */
  let shownSound = '';
  // Rebuilt whenever the player drives another truck (showActiveTruck).
  let truck = new TruckView(renderHost.scene, driving.definition, { lampGlows });
  const cameraRig = new CameraRig(renderHost.camera, driving.definition.body);
  cameraRig.currentMode = settings.camera;
  // Dragging across the road looks round, within what the current camera allows.
  const lookAround = new LookAround(canvas, () => cameraRig.lookLimits);

  /** The simulation stands still while a menu or the result is open over the road. */
  let paused = false;
  const isDriving = (): boolean => gameState.current === 'driving';

  const ui = document.body;
  /** The camera in use, shown: the cab's inside from the driver's seat, the rear camera's picture mirrored. */
  const showCamera = (drivingNow: boolean): void => {
    const mode = cameraRig.currentMode;
    truck.setCabinView(drivingNow && mode === 'cabin');
    renderHost.mirrored = drivingNow && mode === 'rear';
    root.dataset.camera = mode;
  };
  /** The camera button (or C): the next camera, named for a moment, and kept for next time. */
  const toggleCamera = (): void => {
    if (isDriving() && !paused) {
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
  const hud = new MissionHud(ui, strings, missions, navigation, driving);
  // The 2D maps: the region drawn once into paths, the minimap on the road and the full map (openMap, below).
  const mapSketch = sketchWorld(driving.world);
  const mapPainter = new MapPainter(mapSketch, { driving, navigation, missions }, strings);
  const minimap = new Minimap(ui, strings, mapPainter, driving, () => openMap());
  const toasts = new Toasts(ui);

  const result = new ResultDialog(ui, strings, () => {
    paused = false;
    gameState.transitionTo('companyHq');
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
    if (isDriving() && !paused && !result.isOpen) {
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
    onCompanyHq: () => {
      paused = false;
      gameState.transitionTo('companyHq');
    },
    onSettings: () => settingsDialog.open(),
    onMap: () => openMap(),
  });
  const keyboard = new KeyboardInput(window, {
    onToggleCamera: toggleCamera,
    onHorn: honk,
    onMap: () => {
      if (worldMap.isOpen) {
        closeMap();
      } else if (!settingsDialog.isOpen && !newCompany.isOpen && !result.isOpen && (isDriving() || gameState.current === 'companyHq')) {
        openMap();
      }
    },
    onPause: () => {
      if (settingsDialog.isOpen) {
        settingsDialog.close(); // Over the pause menu, which stays.
      } else if (worldMap.isOpen) {
        closeMap();
      } else if (pauseMenu.isOpen) {
        resume();
      } else {
        pause();
      }
    },
  });

  const menuMessage = (): string | null => (persistent ? null : strings.t('menu.storageOff'));
  /** Shows the truck being driven: a new model or a new coat of paint gets its own view, and the camera follows it. */
  const showActiveTruck = (): void => {
    const paint = garage.activeTruck.paint?.color ?? driving.definition.factoryColor;
    if (truck.definition.id !== driving.definition.id || truck.paint !== paint) {
      truck.dispose();
      truck = new TruckView(renderHost.scene, driving.definition, { lampGlows, paint });
      cameraRig.setBody(driving.definition.body);
      showCamera(isDriving());
    }
    truck.setLoaded(driving.cargoMassKg > 0);
    root.dataset.vehicle = driving.definition.id;
    root.dataset.paint = garage.activeTruck.paint?.id ?? 'factory';
  };
  const enterCompany = (): void => {
    showActiveTruck();
    syncMissionView();
    root.dataset.tutorialStep = tutorial.step;
    gameState.transitionTo('companyHq');
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
    onSettings: () => settingsDialog.open(),
  });
  const settingsDialog = new SettingsDialog(ui, strings, { ...settings, quality: qualityChoice, qualityInUse: quality }, {
    onQuality: (choice) => {
      // A preset changes what the game builds at boot: start again with it. A `?quality=` would win over the
      // setting, so it goes, unless storage forgets the setting: then the address carries the choice.
      if (saveSettings(storage, { ...settings, quality: choice }) && persistent) {
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
    onClose: () => settingsDialog.close(),
  });
  const hq = new CompanyHq(
    ui,
    strings,
    { driving, missions, economy, company, fuel, damage, garage, upgrades, specialEvents, dailyContracts },
    {
      onAccept: (missionId) => {
        const accepted = missions.accept(missionId);
        if (accepted.ok) {
          gameState.transitionTo('driving');
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
        } else {
          logger.warn(`Could not switch to ${instanceId}: ${switched.error}.`);
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
      onFreeDrive: () => gameState.transitionTo('driving'),
      onMainMenu: () => gameState.transitionTo('mainMenu'),
      onOpenMap: () => openMap(),
    },
  );
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
  const perfOverlay = new PerfOverlay(ui, `${quality} · ${renderHost.gpu}`);
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
  events.on('UpgradePurchased', refreshHq);
  events.on('VehiclePainted', () => {
    showActiveTruck();
    refreshHq();
  });
  events.on('ActiveVehicleChanged', () => {
    showActiveTruck();
    refreshHq();
  });

  const showState = (state: GameState): void => {
    root.dataset.gameState = state;
    const drivingNow = state === 'driving';
    touch.visible = drivingNow;
    hud.visible = drivingNow;
    minimap.visible = drivingNow;
    pauseMenu.buttonVisible = drivingNow;
    mainMenu.visible = state === 'mainMenu';
    if (state === 'mainMenu') {
      mainMenu.update(session.hasSavedGame(), menuMessage());
    }
    if (state === 'companyHq') {
      hq.show();
    } else {
      hq.hide();
    }
    if (!drivingNow) {
      toasts.clear();
    } else {
      // Each drive starts straight ahead the way the phone is held.
      tilt.recenter();
      if (tilt.status === 'locked') {
        toasts.show(strings.t('toast.tiltLocked'), 'info');
      }
    }
    cameraRig.showcase = !drivingNow;
    lookAround.enabled = drivingNow;
    showCamera(drivingNow);
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
      pauseMenuOpen: pauseMenu.isOpen,
      resultOpen: result.isOpen,
    });
    switch (action) {
      case 'closeDialog':
        settingsDialog.close();
        newCompany.close();
        closeMap();
        break;
      case 'pause':
        pause();
        break;
      case 'resume':
        resume();
        break;
      case 'mainMenu':
        gameState.transitionTo('mainMenu');
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
    // Debug: T parks the truck in the bay the mission needs next, Y at the first rest area.
    window.addEventListener('keydown', (event) => {
      if (event.repeat || !isDriving() || paused) {
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

  const fitRain = (): void => {
    rain.setViewport(canvas.clientWidth * renderHost.pixelRatio, canvas.clientHeight * renderHost.pixelRatio);
  };
  const resize = (): void => {
    renderHost.setSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    fitRain();
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  /** The keyboard and the touch controls together; tilt steering joins them in `driverInput`. */
  const controlsInput = createVehicleInput();
  const driverInput = createVehicleInput();
  let menuFrames = 0;
  const pose = { x: 0, z: 0, heading: 0 };
  const loop = new GameLoop(
    animationFrameScheduler,
    new FixedTimestep(config.simulation.fixedStepSeconds, config.simulation.maxStepsPerFrame),
    {
      fixedUpdate: (stepSeconds) => {
        if (paused) {
          return;
        }
        // Traffic moves first, so the truck collides with where it is now. It drives behind the menus too,
        // under the weather.
        traffic.update(stepSeconds);
        weather.update(stepSeconds);
        if (!isDriving()) {
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
        const simulating = isDriving() && !paused;
        touch.update(deltaSeconds);
        tilt.update(deltaSeconds);
        const vehicle = driving.vehicle;
        // Standing still, show the current pose: interpolating would rock the truck between two steps.
        interpolatePose(pose, driving.previousPose, vehicle, simulating ? alpha : 1);
        const lamps = weather.lamps;
        track.setLamps(lamps);
        streetLamps.setLamps(lamps);
        citySigns.setLamps(lamps);
        windTurbines.setLamps(lamps);
        windTurbines.update(paused ? 0 : deltaSeconds);
        trafficView.setLamps(lamps);
        truck.setLamps(lamps);
        truck.update(pose, vehicle, simulating ? deltaSeconds : 0);
        trafficView.update(traffic.simulation, paused ? 1 : alpha);
        gpsRoute.update(vehicle.x, vehicle.z, vehicle.heading, driving.world.roads);
        const vehicles = traffic.simulation?.vehicleCount ?? 0;
        if (vehicles !== shownTraffic) {
          shownTraffic = vehicles;
          root.dataset.traffic = String(vehicles);
        }
        lookAround.update(deltaSeconds);
        cameraRig.look(lookAround.yaw, lookAround.pitch);
        cameraRig.update(pose, vehicle, deltaSeconds);
        environment.applyWeather(weather.previous.look, weather.current.look, weather.blend, prelit);
        environment.update(renderHost.camera.position, paused ? 0 : deltaSeconds);
        const eye = renderHost.camera.position;
        rain.update(paused ? 0 : deltaSeconds, eye.x, eye.z, weather.rain);
        // Exhaust, dust and spray. In reverse the pedals swap roles (VehicleDynamics): the brake pedal drives.
        effectsState.driving = simulating;
        effectsState.engineRunning = driving.isEngineRunning;
        effectsState.engineRpm = vehicle.engineRpm;
        effectsState.idleRpm = driving.definition.powertrain.idleRpm;
        effectsState.maxRpm = driving.definition.powertrain.maxRpm;
        effectsState.drivePedal = vehicle.gear < 0 ? driverInput.brake : driverInput.throttle;
        effectsState.speed = vehicle.speed;
        effectsState.heading = pose.heading;
        effectsState.offRoad = driving.surface.name === 'grass';
        effectsState.rain = weather.rain;
        truckEffects.update(paused ? 0 : deltaSeconds, truck, effectsState, renderHost.camera);
        depots.update(deltaSeconds, renderHost.camera.position.x, renderHost.camera.position.z);
        hud.update(deltaSeconds);
        minimap.update(deltaSeconds);
        worldMap.frame();
        const tutorialStep = tutorial.step;
        const tutorialAt = tutorialPlace(tutorialStep);
        tutorialHint.show(tutorialAt === gameState.current && !paused && !result.isOpen ? tutorialStep : null, tutorialAt);
        restArea.visible = simulating;
        restArea.update();
        toasts.update(deltaSeconds);
        // Slow frames on the road: fewer pixels (the rain's streaks keep their width in pixels). The menus,
        // drawn at half rate, are no measure.
        if (simulating && adaptiveResolution.frame(deltaSeconds)) {
          renderHost.setResolutionScale(adaptiveResolution.scale);
          fitRain();
        }
        // Behind the menus the scene is a backdrop: every other frame is enough, and saves the battery. The full
        // map hides it all.
        menuFrames = isDriving() ? 0 : menuFrames + 1;
        if ((menuFrames & 1) === 0 && !worldMap.isOpen) {
          renderHost.render();
        }
        touch.showTelemetry(metersPerSecondToKmh(vehicle.speed), vehicle.gear);
        touch.showCondition(fuel.fraction, fuel.isLow, damage.damage);
        // In reverse the pedals swap roles (VehicleDynamics): the brake pedal drives, the gas pedal brakes.
        const reversing = vehicle.gear < 0;
        soundState.driving = simulating;
        soundState.engineRunning = driving.isEngineRunning;
        soundState.engineRpm = vehicle.engineRpm;
        soundState.idleRpm = driving.definition.powertrain.idleRpm;
        soundState.maxRpm = driving.definition.powertrain.maxRpm;
        soundState.drivePedal = reversing ? driverInput.brake : driverInput.throttle;
        soundState.brakePedal = reversing ? driverInput.throttle : driverInput.brake;
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
    { maxFrameDeltaSeconds: config.simulation.maxFrameDeltaSeconds },
  );
  loop.start();
  root.dataset.bootState = 'ready';
}

document.documentElement.dataset.bootState = 'booting';
start().catch((error: unknown) => {
  console.error(error);
  document.documentElement.dataset.bootState = 'error';
  showFatalError(document, 'RoadHaul could not start.', error);
});
