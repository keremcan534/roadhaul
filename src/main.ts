import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { metersPerSecondToKmh } from './core/math/scalar';
import { systemClock } from './core/time/Clock';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import { DEFAULT_GAME_CONFIG } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { bayParkingPose } from './domain/missions/loadingBay';
import { combineVehicleInputs, createVehicleInput } from './domain/vehicles/VehicleInput';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { browserStorage } from './platform/browser/browserStorage';
import { applyConfigOverrides } from './platform/browser/configOverrides';
import { showFatalError } from './platform/browser/fatalError';
import { KeyboardInput } from './platform/input/KeyboardInput';
import { CameraRig } from './presentation/cameras/CameraRig';
import { RenderHost } from './presentation/RenderHost';
import { TruckView } from './presentation/vehicles/TruckView';
import { DepotView } from './presentation/world/DepotView';
import { EnvironmentView } from './presentation/world/EnvironmentView';
import { TrackView } from './presentation/world/TrackView';
import { interpolatePose } from './systems/driving/DrivingService';
import type { GameState } from './systems/gameState/GameState';
import { TouchControls } from './ui/controls/TouchControls';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import { CompanyHq } from './ui/hq/CompanyHq';
import { MissionHud } from './ui/hud/MissionHud';
import { chooseLanguage, stringsFor } from './ui/i18n';
import { MainMenu } from './ui/menus/MainMenu';
import { PauseMenu } from './ui/menus/PauseMenu';
import { ResultDialog } from './ui/menus/ResultDialog';
import './ui/styles.css';

/**
 * Browser entry point and composition root. It boots the headless game
 * services, then adds rendering, input, the menus, the HUD, the frame loop
 * and debug tooling, and wires the game flow: main menu → company HQ (job
 * board) → driving the contract → result → HQ.
 *
 * `<html data-boot-state>` (booting | ready | error), `data-game-state` and
 * `data-mission-state` let the end-to-end tests follow progress.
 */
async function start(): Promise<void> {
  const root = document.documentElement;
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (canvas === null) {
    throw new Error('Missing <canvas id="game-canvas">.');
  }

  const query = new URLSearchParams(window.location.search);
  const config = applyConfigOverrides(DEFAULT_GAME_CONFIG, query);
  const logger = new ConsoleLogger({ sink: console, minLevel: config.debug.logLevel });
  const { storage, persistent } = browserStorage(window);
  if (!persistent) {
    logger.warn('Storage is unavailable: this game will not be saved after the page closes.');
  }
  const services = await new GameBootstrapper({
    config,
    content: GAME_CONTENT,
    logger,
    clock: systemClock,
    storage,
  }).boot();

  const content = services.resolve(ServiceKeys.content);
  const events = services.resolve(ServiceKeys.events);
  const gameState = services.resolve(ServiceKeys.gameState);
  const driving = services.resolve(ServiceKeys.driving);
  const missions = services.resolve(ServiceKeys.missions);

  // Older WebViews may only have navigator.language.
  const language = chooseLanguage(query.get('lang'), navigator.languages ?? [navigator.language]);
  root.lang = language;
  const strings = stringsFor(language);

  // The company's truck waits at the start of the map; the menus show it from a circling camera.
  driving.start(config.newGame.startingVehicleId, config.newGame.startingMapId);

  const renderHost = new RenderHost(canvas, config.rendering);
  // The views add themselves to the scene for the page's lifetime.
  const environment = new EnvironmentView(renderHost.scene);
  new TrackView(renderHost.scene, driving.world, { anisotropy: renderHost.anisotropy });
  const depots = new DepotView(renderHost.scene, driving.world.depots, { anisotropy: renderHost.anisotropy });
  const truck = new TruckView(renderHost.scene, driving.definition);
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
  const hud = new MissionHud(ui, strings, missions, driving);
  const result = new ResultDialog(ui, strings, () => {
    paused = false;
    gameState.transitionTo('companyHq');
  });
  const pause = (): void => {
    if (isDriving() && !paused && !result.isOpen) {
      paused = true;
      pauseMenu.open(missions.active !== null);
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
  const mainMenu = new MainMenu(ui, strings, {
    onPlay: () => gameState.transitionTo('companyHq'),
    onSwitchLanguage: () => {
      query.set('lang', language === 'tr' ? 'en' : 'tr');
      window.location.search = query.toString();
    },
  });
  const hq = new CompanyHq(ui, strings, {
    onAccept: (missionId) => {
      const accepted = missions.accept(missionId);
      if (accepted.ok) {
        gameState.transitionTo('driving');
      } else {
        logger.warn(`Could not take ${missionId}: ${accepted.error}.`);
      }
    },
    onFreeDrive: () => gameState.transitionTo('driving'),
    onMainMenu: () => gameState.transitionTo('mainMenu'),
  });
  const perfOverlay = config.debug.showPerfOverlay ? new PerfOverlay(ui) : null;

  events.on('MissionStateChanged', ({ current }) => {
    const target = missions.target;
    depots.setTarget(target?.depot.id ?? null, target?.kind);
    root.dataset.missionState = current;
  });
  events.on('CargoDamaged', () => hud.flashCargoDamage());
  events.on('MissionCompleted', (delivery) => {
    paused = true;
    pauseMenu.close();
    result.showCompleted(content.missions.get(delivery.missionId), delivery);
  });
  events.on('MissionFailed', ({ missionId, reason }) => {
    paused = true;
    pauseMenu.close();
    result.showFailed(content.missions.get(missionId), reason);
  });

  const showState = (state: GameState): void => {
    root.dataset.gameState = state;
    const drivingNow = state === 'driving';
    touch.visible = drivingNow;
    hud.visible = drivingNow;
    pauseMenu.buttonVisible = drivingNow;
    mainMenu.visible = state === 'mainMenu';
    if (state === 'companyHq') {
      hq.show(missions.jobBoard());
    } else {
      hq.hide();
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
  showState(gameState.current);

  if (config.debug.showPerfOverlay) {
    // Debug: T parks the truck in the bay the mission needs next.
    window.addEventListener('keydown', (event) => {
      const target = missions.target;
      if (event.code === 'KeyT' && !event.repeat && isDriving() && !paused && target !== null) {
        const parked = bayParkingPose(target.depot.bay, driving.definition.body);
        driving.placeTruck(parked.x, parked.z, parked.heading);
      }
    });
  }

  const resize = (): void => {
    renderHost.setSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const driverInput = createVehicleInput();
  const pose = { x: 0, z: 0, heading: 0 };
  const loop = new GameLoop(
    animationFrameScheduler,
    new FixedTimestep(config.simulation.fixedStepSeconds, config.simulation.maxStepsPerFrame),
    {
      fixedUpdate: (stepSeconds) => {
        if (!isDriving() || paused) {
          return;
        }
        combineVehicleInputs(driverInput, keyboard.state, touch.state);
        driving.step(stepSeconds, driverInput);
        missions.update(stepSeconds);
      },
      frameUpdate: (deltaSeconds, alpha) => {
        const simulating = isDriving() && !paused;
        touch.update(deltaSeconds);
        const vehicle = driving.vehicle;
        // Standing still, show the current pose: interpolating would rock the truck between two steps.
        interpolatePose(pose, driving.previousPose, vehicle, simulating ? alpha : 1);
        truck.update(pose, vehicle, simulating ? deltaSeconds : 0);
        cameraRig.update(pose, vehicle.speed, deltaSeconds);
        environment.update(renderHost.camera.position);
        depots.update(deltaSeconds, renderHost.camera.position.x, renderHost.camera.position.z);
        hud.update(deltaSeconds);
        renderHost.render();
        touch.showTelemetry(metersPerSecondToKmh(vehicle.speed), vehicle.gear);
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
