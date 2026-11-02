import type { MapPavedArea, MapRelief } from './mapSketch';
import type { TerrainAnswer, TerrainRequest } from './terrainWorker';

/** A land's relief is drawn over at most this many cells along its longer side, none smaller than MIN_CELL_METERS. */
const MAX_CELLS = 520;
const MIN_CELL_METERS = 18;

/** A land and its relief image once drawn, placed over its bounds in the map's meters. */
export interface TerrainLayer {
  readonly land: MapPavedArea;
  /** The land's coast as a path, to clip the image to (the coast stays sharp however near the map zooms). */
  readonly coast: Path2D;
  readonly minX: number;
  readonly minZ: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  image: HTMLCanvasElement | null;
}

/**
 * The relief of every land on the maps (mapRelief.ts: rolling meadows,
 * hills, the mountains round each region with rock and snow on their tops,
 * lit from the north-west), each drawn once into an image by a worker
 * (terrainWorker.ts), off the main thread, while the game starts. Until an
 * image comes, its land is drawn flat. `version` grows as each comes in, so
 * a map waiting for a change repaints. Without workers (or a document) no
 * relief is drawn.
 */
export class MapTerrain {
  readonly layers: readonly TerrainLayer[];
  version = 0;
  private worker: Worker | null = null;
  private waiting = 0;

  constructor(lands: readonly { readonly land: MapPavedArea; readonly relief: MapRelief; readonly coast: Path2D }[], document: Document | null) {
    // Each land's grid: its cells' size, and the image's size in cells (its meters a whole number of cells).
    const grids = lands.map(({ land }) => {
      const cell = Math.max(MIN_CELL_METERS, Math.max(land.maxX - land.minX, land.maxZ - land.minZ) / MAX_CELLS);
      return { cell, width: Math.ceil((land.maxX - land.minX) / cell), height: Math.ceil((land.maxZ - land.minZ) / cell) };
    });
    this.layers = lands.map(({ land, coast }, index) => ({
      land,
      coast,
      minX: land.minX,
      minZ: land.minZ,
      widthMeters: grids[index]!.width * grids[index]!.cell,
      heightMeters: grids[index]!.height * grids[index]!.cell,
      image: null,
    }));
    if (document === null || typeof Worker === 'undefined' || lands.length === 0) {
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<TerrainAnswer>) => {
      const { id, width, height, pixels } = event.data;
      const layer = this.layers[id];
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (layer !== undefined && context !== null) {
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
        layer.image = canvas;
        this.version++;
      }
      this.waiting--;
      if (this.waiting <= 0) {
        this.dispose();
      }
    };
    worker.onerror = () => this.dispose();
    lands.forEach(({ relief }, id) => {
      const layer = this.layers[id]!;
      const { cell, width, height } = grids[id]!;
      const request: TerrainRequest = { id, relief, minX: layer.minX, minZ: layer.minZ, cell, width, height };
      worker.postMessage(request);
      this.waiting++;
    });
  }

  /** Stops the worker (its images are kept). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
