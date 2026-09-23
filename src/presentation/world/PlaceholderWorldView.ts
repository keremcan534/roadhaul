import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from 'three';

const SKY_COLOR = 0x9ec9e8;
const GROUND_COLOR = 0x6d8f4b;
const ROAD_COLOR = 0x3b3f45;
const MARKING_COLOR = 0xf2f2ee;
const CAB_COLOR = 0xe0622a;
const WINDSHIELD_COLOR = 0x2d3a48;
const CARGO_BOX_COLOR = 0xe9e5dc;
const CHASSIS_COLOR = 0x2c2f33;
const TIRE_COLOR = 0x1c1c1c;

const ROAD_LENGTH_METERS = 600;
const ROAD_WIDTH_METERS = 9;
const LANE_MARK_SPACING_METERS = 12;
const TRUCK_LANE_OFFSET_METERS = 2.25;

const ORBIT_RADIUS_METERS = 16;
const ORBIT_HEIGHT_METERS = 5.5;
const ORBIT_SPEED_RADIANS_PER_SECOND = 0.15;

/**
 * Stand-in scene that proves the rendering pipeline on target phones: ground,
 * a road with instanced lane markings and a box truck, circled by a slow
 * camera. It holds no gameplay and is replaced by the driving prototype
 * (roadmap steps 05–08).
 *
 * Lambert materials, no shadows and 8 draw calls keep it cheap on
 * low-end GPUs.
 */
export class PlaceholderWorldView {
  private readonly root = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly orbitCenter = new Vector3(TRUCK_LANE_OFFSET_METERS, 1.8, 0);
  private orbitAngle = Math.PI * 0.2;

  constructor(private readonly scene: Scene) {
    scene.background = new Color(SKY_COLOR);
    scene.fog = new Fog(SKY_COLOR, 80, 260);

    const sun = new DirectionalLight(0xfff4e0, 2.4);
    sun.position.set(40, 60, 25);
    this.root.add(new HemisphereLight(0xdcecff, 0x55643c, 1.4), sun);
    this.root.add(this.createGround(), this.createRoad(), this.createLaneMarkings(), this.createTruck());
    scene.add(this.root);
  }

  /** Advances the camera orbit. Runs every frame, so it must not allocate. */
  update(deltaSeconds: number, camera: PerspectiveCamera): void {
    this.orbitAngle += deltaSeconds * ORBIT_SPEED_RADIANS_PER_SECOND;
    camera.position.set(
      this.orbitCenter.x + Math.cos(this.orbitAngle) * ORBIT_RADIUS_METERS,
      ORBIT_HEIGHT_METERS,
      this.orbitCenter.z + Math.sin(this.orbitAngle) * ORBIT_RADIUS_METERS,
    );
    camera.lookAt(this.orbitCenter);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.scene.background = null;
    this.scene.fog = null;
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }

  private createGround(): Mesh {
    const ground = new Mesh(
      this.track(this.geometries, new PlaneGeometry(ROAD_LENGTH_METERS, ROAD_LENGTH_METERS)),
      this.lambert(GROUND_COLOR),
    );
    ground.rotation.x = -Math.PI / 2;
    return ground;
  }

  private createRoad(): Mesh {
    const road = new Mesh(
      this.track(this.geometries, new BoxGeometry(ROAD_WIDTH_METERS, 0.1, ROAD_LENGTH_METERS)),
      this.lambert(ROAD_COLOR),
    );
    road.position.y = 0.05;
    return road;
  }

  /** One draw call for every dash on the centre line. */
  private createLaneMarkings(): InstancedMesh {
    const count = Math.floor(ROAD_LENGTH_METERS / LANE_MARK_SPACING_METERS);
    const markings = new InstancedMesh(
      this.track(this.geometries, new BoxGeometry(0.2, 0.02, 3)),
      this.lambert(MARKING_COLOR),
      count,
    );
    const placement = new Matrix4();
    for (let i = 0; i < count; i++) {
      placement.makeTranslation(0, 0.115, -ROAD_LENGTH_METERS / 2 + (i + 0.5) * LANE_MARK_SPACING_METERS);
      markings.setMatrixAt(i, placement);
    }
    markings.instanceMatrix.needsUpdate = true;
    return markings;
  }

  /** A generic box truck facing +Z. Original shapes: no real-world models. */
  private createTruck(): Group {
    const truck = new Group();
    truck.position.x = TRUCK_LANE_OFFSET_METERS;
    truck.add(
      this.box([2.3, 0.35, 8.2], [0, 0.85, 0], CHASSIS_COLOR),
      this.box([2.4, 2.4, 2.1], [0, 2.1, 3.0], CAB_COLOR),
      this.box([2.1, 0.9, 0.05], [0, 2.6, 4.06], WINDSHIELD_COLOR),
      this.box([2.5, 2.8, 5.6], [0, 2.4, -1.1], CARGO_BOX_COLOR),
      this.createWheels(),
    );
    return truck;
  }

  private createWheels(): InstancedMesh {
    const axlesZ = [3.0, -2.0, -3.2];
    const sidesX = [-1.05, 1.05];
    const tire = this.track(this.geometries, new CylinderGeometry(0.5, 0.5, 0.35, 16));
    tire.rotateZ(Math.PI / 2); // Axle along X.
    const wheels = new InstancedMesh(tire, this.lambert(TIRE_COLOR), axlesZ.length * sidesX.length);
    const placement = new Matrix4();
    let index = 0;
    for (const z of axlesZ) {
      for (const x of sidesX) {
        wheels.setMatrixAt(index++, placement.makeTranslation(x, 0.5, z));
      }
    }
    wheels.instanceMatrix.needsUpdate = true;
    return wheels;
  }

  private box(
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    color: number,
  ): Mesh {
    const mesh = new Mesh(this.track(this.geometries, new BoxGeometry(...size)), this.lambert(color));
    mesh.position.set(...position);
    return mesh;
  }

  private lambert(color: number): MeshLambertMaterial {
    return this.track(this.materials, new MeshLambertMaterial({ color }));
  }

  /** Remembers GPU resources so dispose() can release them. */
  private track<TBase, T extends TBase>(list: TBase[], resource: T): T {
    list.push(resource);
    return resource;
  }
}
