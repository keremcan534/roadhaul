import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { metersPerSecondToKmh } from './core/math/scalar';
import { shiftedClock, systemClock } from './core/time/Clock';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import { applyQualityPreset, DEFAULT_GAME_CONFIG } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { bayParkingPose } from './domain/missions/loadingBay';
import { combineVehicleInputs, createVehicleInput } from './domain/vehicles/VehicleInput';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { browserStorage } from './platform/browser/browserStorage';
import { applyConfigOverrides, requestedDateMs } from './platform/browser/configOverrides';
import { chooseQuality, detectQuality, deviceHints, qualitySetting } from './platform/browser/deviceQuality';
import { loadSettings, saveSettings } from './platform/browser/deviceSettings';
import { showFatalError } from './platform/browser/fatalError';
import { KeyboardInput } from './platform/input/KeyboardInput';
import { CameraRig } from './presentation/cameras/CameraRig';
import { AdaptiveResolution } from './presentation/AdaptiveResolution';
import { RenderHost } from './presentation/RenderHost';
import { TruckView } from './presentation/vehicles/TruckView';
import { DepotView } from './presentation/world/DepotView';
import { EnvironmentView } from './presentation/world/EnvironmentView';
import { GpsRouteView } from './presentation/navigation/GpsRouteView';
import { TrafficView } from './presentation/traffic/TrafficView';
import { RainView } from './presentation/weather/RainView';
import { PrelitMaterials } from './presentation/world/lighting';
import { RestAreaView } from './presentation/world/RestAreaView';
import { TrackView } from './presentation/world/TrackView';
import { interpolatePose } from './systems/driving/DrivingService';
import type { GameState } from './systems/gameState/GameState';
import { TouchControls } from './ui/controls/TouchControls';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import { CompanyHq } from './ui/hq/CompanyHq';
import { objectiveText } from './ui/hq/eventText';
import { MissionHud } from './ui/hud/MissionHud';
import { RestAreaPanel } from './ui/hud/RestAreaPanel';
import { Toasts } from './ui/hud/Toasts';
import { TutorialHint, tutorialPlace } from './ui/hud/TutorialHint';
import { chooseLanguage, stringsFor } from './ui/i18n';
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
  const settings = loadSettings(storage);
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
  const trafficView = new TrafficView(renderHost.scene, content.trafficVehicles.all, config.traffic.maxVehicles, {
    lampGlows,
  });
  const gpsRoute = new GpsRouteView(renderHost.scene, navigation);
  const rain = new RainView(renderHost.scene, config.rendering.rainDensity);
  const adaptiveResolution = new AdaptiveResolution(config.rendering.minResolutionScale);
  /** Vehicles on the road, as last written to the page (e2e tests read it). */
  let shownTraffic = -1;
  // Rebuilt whenever the player drives another truck (showActiveTruck).
  let truck = new TruckView(renderHost.scene, driving.definition, { lampGlows });
  const cameraRig = new CameraRig(renderHost.camera, driving.definition.body);

  /** The simulation stands still while a menu or the result is open over the road. */
  let paused = false;
  const isDriving = (): boolean => gameState.current === 'driving';

  const ui = document.body;
  const toggleCamera = (): void => {
    if (isDriving() && !paused) {
      truck.setCabinView(cameraRig.toggleMode() === 'cabin');
    }
  };
  const touch = new TouchControls(ui, { onToggleCamera: toggleCamera });
  const hud = new MissionHud(ui, strings, missions, navigation, driving);
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
  });
  const keyboard = new KeyboardInput(window, {
    onToggleCamera: toggleCamera,
    onPause: () => {
      if (pauseMenu.isOpen) {
        pauseMenu.close();
        paused = false;
      } else {
        pause();
      }
    },
  });

  const menuMessage = (): string | null => (persistent ? null : strings.t('menu.storageOff'));
  /** Shows the truck being driven: a new model gets its own view, and the camera follows it. */
  const showActiveTruck = (): void => {
    if (truck.definition.id !== driving.definition.id) {
      truck.dispose();
      truck = new TruckView(renderHost.scene, driving.definition, { lampGlows });
      cameraRig.setBody(driving.definition.body);
      truck.setCabinView(isDriving() && cameraRig.currentMode === 'cabin');
    }
    truck.setLoaded(driving.cargoMassKg > 0);
    root.dataset.vehicle = driving.definition.id;
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
  const settingsDialog = new SettingsDialog(ui, strings, qualityChoice, quality, {
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
    onClose: () => settingsDialog.close(),
  });
  const hq = new CompanyHq(
    ui,
    strings,
    { driving, missions, economy, company, fuel, damage, garage, upgrades, specialEvents },
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
    },
  );
  const perfOverlay = config.debug.showPerfOverlay ? new PerfOverlay(ui) : null;
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
  events.on('MissionStateChanged', ({ current }) => {
    syncMissionView();
    root.dataset.missionState = current;
  });
  events.on('CargoDamaged', () => hud.flashCargoDamage());
  events.on('MissionCompleted', (delivery) => {
    paused = true;
    pauseMenu.close();
    pauseMenu.buttonVisible = false;
    result.showCompleted(content.missions.get(delivery.missionId), delivery, economy.credits);
  });
  events.on('MissionFailed', ({ missionId, reason, reputationLost }) => {
    paused = true;
    pauseMenu.close();
    pauseMenu.buttonVisible = false;
    result.showFailed(content.missions.get(missionId), reason, reputationLost);
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
  events.on('ActiveVehicleChanged', () => {
    showActiveTruck();
    refreshHq();
  });

  const showState = (state: GameState): void => {
    root.dataset.gameState = state;
    const drivingNow = state === 'driving';
    touch.visible = drivingNow;
    hud.visible = drivingNow;
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
    }
    cameraRig.showcase = !drivingNow;
    truck.setCabinView(drivingNow && cameraRig.currentMode === 'cabin');
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

  // Closing or hiding the tab keeps the latest state.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      session.save();
    } else {
      adaptiveResolution.restart();
    }
  });
  window.addEventListener('pagehide', () => session.save());

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
        combineVehicleInputs(driverInput, keyboard.state, touch.state);
        driving.step(stepSeconds, driverInput);
        missions.update(stepSeconds);
        navigation.update(stepSeconds);
        fuel.update();
        session.update(stepSeconds);
      },
      frameUpdate: (deltaSeconds, alpha) => {
        const simulating = isDriving() && !paused;
        touch.update(deltaSeconds);
        const vehicle = driving.vehicle;
        // Standing still, show the current pose: interpolating would rock the truck between two steps.
        interpolatePose(pose, driving.previousPose, vehicle, simulating ? alpha : 1);
        const lamps = weather.lamps;
        track.setLamps(lamps);
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
        cameraRig.update(pose, vehicle.speed, deltaSeconds);
        environment.applyWeather(weather.previous.look, weather.current.look, weather.blend, prelit);
        environment.update(renderHost.camera.position);
        const eye = renderHost.camera.position;
        rain.update(paused ? 0 : deltaSeconds, eye.x, eye.z, weather.rain);
        depots.update(deltaSeconds, renderHost.camera.position.x, renderHost.camera.position.z);
        hud.update(deltaSeconds);
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
        // Behind the menus the scene is a backdrop: every other frame is enough, and saves the battery.
        menuFrames = isDriving() ? 0 : menuFrames + 1;
        if ((menuFrames & 1) === 0) {
          renderHost.render();
        }
        touch.showTelemetry(metersPerSecondToKmh(vehicle.speed), vehicle.gear);
        touch.showCondition(fuel.fraction, fuel.isLow, damage.damage);
        perfOverlay?.frame(deltaSeconds, renderHost.renderStats, renderHost.pixelRatio, pose);
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
