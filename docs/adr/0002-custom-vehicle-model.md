# ADR 0002: Custom deterministic truck model instead of Rapier

- **Status:** Accepted
- **Date:** 2026-09-23
- **Supersedes:** the "Vehicle physics" row of ADR 0001 (Rapier raycast vehicle)

## Context

ADR 0001 planned Rapier (`@dimforge/rapier3d-compat`, WASM) for vehicle physics in roadmap step 05. Before adding it, we measured and re-read the requirements:

- **Download size.** The package bundles its WASM as base64: 2.86 MB raw and **1.09 MB gzipped**. That is roughly 8× the entire game at the time (139 KB gzipped), paid on every first load over mobile data, plus WASM start-up time on low-end phones.
- **Scope of step 05.** Spec §49 asks for acceleration, braking, steering, reverse, basic friction, a speed limit and configurable vehicle data. That describes a vehicle model, not a general rigid-body simulation.
- **Feel.** Spec §74 names vehicle feel as the biggest technical risk. Trucks should feel heavy and planted, not bounce or drift, and the feel has to be tuned quickly.
- **Architecture.** Game rules should run headless for tests and a future authoritative server (spec §66). A WASM physics world would pull an engine dependency into the simulation.

## Decision

Implement the truck as a deterministic model in plain TypeScript, in the engine-agnostic layers:

- `src/domain/vehicles/VehicleDynamics.ts` is a kinematic bicycle model at the rear axle with a real drivetrain:
  - torque/power curve;
  - automatic gearbox with hunting protection;
  - speed governor;
  - drag, rolling resistance and engine braking;
  - brakes and grip-limited traction;
  - brake-to-reverse;
  - understeer at the truck's cornering limit (`maxLateralAccelerationG`).
- `src/domain/world/DrivingWorld.ts` handles surfaces (asphalt/grass) and collisions with trees, buildings and the map edge. It pushes the truck out of obstacles and removes the speed that went into them. A glancing contact turns the truck along the obstacle, because a truck that can only move where it points would otherwise stick to the wall.
- `src/systems/driving/DrivingService.ts` runs it at the fixed 60 Hz step and publishes `VehicleCollided`.

## Consequences

- **Size.** About 9 KB gzipped for the whole driving model, world and controls, instead of about 1.09 MB.
- **Determinism and testability.** Unit tests cover the behaviour. `vehicleTuning.test.ts` locks the H1's feel into truck-like ranges (0–50 km/h, braking distance, cornering, off-road speed).
- **Tunable per truck in data** (`VehicleDefinition.body/powertrain/handling`). A new truck needs no code.
- **Not simulated:** tyre slip and drifting, suspension physics (body pitch and roll are visual only), rigid-body interactions between objects (traffic is planned as kinematic, waypoint-driven cars), trailers and articulation, and slopes (the ground is flat for now).

## Revisit when

- trailers, articulated steering or physical cargo are in scope (spec V3); or
- device testing shows the model cannot give the feel we want.

Rapier (or another engine) can then live behind the same DrivingService boundary.
