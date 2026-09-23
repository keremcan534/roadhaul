import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { metersPerSecondToKmh } from './core/math/scalar';
import { systemClock } from './core/time/Clock';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import { DEFAULT_GAME_CONFIG } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { combineVehicleInputs, createVehicleInput } from './domain/vehicles/VehicleInput';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { applyConfigOverrides } from './platform/browser/configOverrides';
import { showFatalError } from './platform/browser/fatalError';
import { KeyboardInput } from './platform/input/KeyboardInput';
import { CameraRig } from './presentation/cameras/CameraRig';
import { RenderHost } from './presentation/RenderHost';
import { TruckView } from './presentation/vehicles/TruckView';
import { TrackView } from './presentation/world/TrackView';
import { interpolatePose } from './systems/driving/DrivingService';
import { TouchControls } from './ui/controls/TouchControls';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import './ui/styles.css';

/**
 * Browser entry point and composition root. It boots the headless game
 * services, then adds rendering, input, the frame loop and debug tooling.
 *
 * `<html data-boot-state>` (booting | ready | error) and `data-game-state`
 * let the end-to-end tests follow progress.
 */
async function start(): Promise<void> {
  const root = document.documentElement;
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  if (canvas === null) {
    throw new Error('Missing <canvas id="game-canvas">.');
  }

  const config = applyConfigOverrides(DEFAULT_GAME_CONFIG, new URLSearchParams(window.location.search));
  const logger = new ConsoleLogger({ sink: console, minLevel: config.debug.logLevel });
  const services = await new GameBootstrapper({
    config,
    content: GAME_CONTENT,
    logger,
    clock: systemClock,
  }).boot();

  const gameState = services.resolve(ServiceKeys.gameState);
  const driving = services.resolve(ServiceKeys.driving);

  // Menus and missions arrive later on the roadmap: the prototype drives straight away.
  driving.start(config.newGame.startingVehicleId, config.newGame.startingMapId);

  const renderHost = new RenderHost(canvas, config.rendering);
  new TrackView(renderHost.scene, driving.world); // Adds itself to the scene for the page's lifetime.
  const truck = new TruckView(renderHost.scene, driving.definition);
  const cameraRig = new CameraRig(renderHost.camera, driving.definition.body);
  const toggleCamera = (): void => {
    truck.setCabinView(cameraRig.toggleMode() === 'cabin');
  };
  const keyboard = new KeyboardInput(window, toggleCamera);
  const touch = new TouchControls(document.body, { onToggleCamera: toggleCamera });
  const perfOverlay = config.debug.showPerfOverlay ? new PerfOverlay(document.body) : null;

  const showState = (state: string): void => {
    root.dataset.gameState = state;
    touch.visible = state === 'driving';
  };
  showState(gameState.current);
  services.resolve(ServiceKeys.events).on('GameStateChanged', ({ current }) => showState(current));
  gameState.transitionTo('companyHq');
  gameState.transitionTo('driving');

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
        combineVehicleInputs(driverInput, keyboard.state, touch.state);
        driving.step(stepSeconds, driverInput);
      },
      frameUpdate: (deltaSeconds, alpha) => {
        touch.update(deltaSeconds);
        const vehicle = driving.vehicle;
        interpolatePose(pose, driving.previousPose, vehicle, alpha);
        truck.update(pose, vehicle, deltaSeconds);
        cameraRig.update(pose, vehicle.speed, deltaSeconds);
        renderHost.render();
        touch.showTelemetry(metersPerSecondToKmh(vehicle.speed), vehicle.gear);
        perfOverlay?.frame(deltaSeconds, renderHost.renderStats, renderHost.pixelRatio);
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
