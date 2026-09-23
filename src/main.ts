import { GameBootstrapper } from './app/GameBootstrapper';
import { ServiceKeys } from './app/ServiceKeys';
import { ConsoleLogger } from './core/logging/ConsoleLogger';
import { systemClock } from './core/time/Clock';
import { FixedTimestep } from './core/time/FixedTimestep';
import { GameLoop } from './core/time/GameLoop';
import { DEFAULT_GAME_CONFIG } from './data/config/GameConfig';
import { GAME_CONTENT } from './data/content';
import { animationFrameScheduler } from './platform/browser/animationFrameScheduler';
import { applyConfigOverrides } from './platform/browser/configOverrides';
import { showFatalError } from './platform/browser/fatalError';
import { RenderHost } from './presentation/RenderHost';
import { PlaceholderWorldView } from './presentation/world/PlaceholderWorldView';
import { PerfOverlay } from './ui/debug/PerfOverlay';
import './ui/styles.css';

/**
 * Browser entry point and composition root. It boots the headless game
 * services, then adds rendering, the frame loop and debug tooling.
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

  root.dataset.gameState = services.resolve(ServiceKeys.gameState).current;
  services.resolve(ServiceKeys.events).on('GameStateChanged', ({ current }) => {
    root.dataset.gameState = current;
  });

  const renderHost = new RenderHost(canvas, config.rendering);
  const world = new PlaceholderWorldView(renderHost.scene);
  const perfOverlay = config.debug.showPerfOverlay ? new PerfOverlay(document.body) : null;

  const resize = (): void => {
    renderHost.setSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const loop = new GameLoop(
    animationFrameScheduler,
    new FixedTimestep(config.simulation.fixedStepSeconds, config.simulation.maxStepsPerFrame),
    {
      fixedUpdate: () => {
        // Vehicle physics and mission rules arrive with the driving prototype (roadmap step 05).
      },
      frameUpdate: (deltaSeconds) => {
        world.update(deltaSeconds, renderHost.camera);
        renderHost.render();
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
