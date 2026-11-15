import { Color, Group, Mesh, MeshLambertMaterial, type BufferGeometry, type Scene } from 'three';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import { vehicleGeometry } from '../traffic/TrafficView';

/** The rivals' paint, after the player's car's own. */
const RIVAL_PAINTS = [0x2f6dff, 0x2bb673, 0xf2b233] as const;

/** Where the cars of a race are (RaceService, and the player's car's pose). */
export interface RaceCarsSource {
  readonly rivalX: Float64Array;
  readonly rivalZ: Float64Array;
  readonly rivalHeading: Float64Array;
}

/**
 * The cars of a street race (RaceService): the player's, in its paint, where
 * the drive puts it, and the rivals', in theirs, on the road where their
 * plans have them. Low, sporty bodies from the traffic's car shapes. One
 * draw call each, and none between races.
 */
export class RaceCarsView {
  private readonly root = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly geometries: BufferGeometry[] = [];
  private readonly player: Mesh;
  private readonly rivals: Mesh[];

  constructor(
    private readonly scene: Scene,
    body: VehicleBody,
    paint: number,
  ) {
    this.root.name = 'race-cars';
    const shape: TrafficVehicleDefinition = {
      id: 'race_car',
      kind: 'car',
      carBody: 'saloon',
      lengthMeters: body.lengthMeters,
      widthMeters: body.widthMeters,
      heightMeters: body.heightMeters,
      cruiseSpeedFactor: 1,
      accelerationMetersPerSecondSquared: 1,
      spawnWeight: 0,
      colors: [paint],
    };
    const painted = (hex: number): BufferGeometry => {
      const geometry = paintedBody(shape, hex);
      this.geometries.push(geometry);
      return geometry;
    };
    this.player = new Mesh(painted(paint), this.material);
    this.player.name = 'race-car:player';
    this.rivals = RIVAL_PAINTS.map((hex, index) => {
      const mesh = new Mesh(painted(hex), this.material);
      mesh.name = `race-car:rival-${index}`;
      return mesh;
    });
    this.root.add(this.player, ...this.rivals);
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * Per frame: hidden between races; in one, the player's car at `pose` (its
   * rear axle, on the ground at `y`, pitched with `grade`) and the rivals
   * where `race` has them, on the ground `groundAt` gives. Allocation-free.
   */
  update(
    racing: boolean,
    pose: { readonly x: number; readonly z: number; readonly heading: number },
    body: { readonly y: number; readonly grade: number },
    race: RaceCarsSource,
    groundAt: (x: number, z: number) => number,
    wheelbaseMeters: number,
  ): void {
    if (this.root.visible !== racing) {
      this.root.visible = racing;
    }
    if (!racing) {
      return;
    }
    // The body's middle is half a wheelbase ahead of the rear axle.
    const ahead = wheelbaseMeters / 2;
    this.player.position.set(pose.x + Math.sin(pose.heading) * ahead, body.y, pose.z + Math.cos(pose.heading) * ahead);
    this.player.rotation.set(-Math.atan(body.grade), pose.heading, 0, 'YXZ');
    for (let i = 0; i < this.rivals.length; i++) {
      const mesh = this.rivals[i]!;
      const shown = i < race.rivalX.length;
      mesh.visible = shown;
      if (shown) {
        const x = race.rivalX[i]!;
        const z = race.rivalZ[i]!;
        mesh.position.set(x, groundAt(x, z), z);
        mesh.rotation.set(0, race.rivalHeading[i]!, 0);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    this.material.dispose();
  }
}

/** A car body of `type` in `hex`: its painted parts recoloured. */
function paintedBody(type: TrafficVehicleDefinition, hex: number): BufferGeometry {
  const body = vehicleGeometry(type);
  const paint = body.getAttribute('paint');
  const colors = body.getAttribute('color');
  const color = new Color(hex);
  for (let i = 0; i < colors.count; i++) {
    if (paint !== undefined && paint.getX(i) > 0.5) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }
  return body;
}
