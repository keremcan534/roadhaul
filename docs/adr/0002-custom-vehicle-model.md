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
- **Not simulated:** tyre slip and drifting, trailers and articulation, and slopes (the ground is flat for now). Suspension, rollover and rigid-body blows were not simulated at first either; the amendment below adds them.

## Amendment (2026-09-27): the body in motion and impulse collisions

Players found the truck "glued to the ground": a side contact made it jump sideways (the position was corrected and the heading turned along the wall in one step), and nothing short of a wall stopped it. They asked for trucks that lean, tip onto two wheels and roll over when swerved hard at speed, as in the big truck simulators, and that get thrown about by a hard hit. We kept the decision above and grew the same model, still without an engine:

- **Impulse collisions** (`DrivingWorld.resolveCollisions`). Each contact strikes the truck as a rigid body in the ground's plane, with its mass and turning inertia: the impulse stops the point that touched, bounces it back a little and drags it along the surface (Coulomb friction). Speed, a sideways slide and a spin change together, so a glancing blow turns the truck over a few steps instead of snapping it. Traffic has masses and shares the blow.
- **A sideways slide and a spin** in `VehicleDynamics`, which the tyres take away over a moment (a shove, not a drift: the tyres still do not drift in plain driving).
- **The body** (`bodyMotion.ts`): lean and pitch on damped springs; the inside wheels lifting past the rollover threshold; past the tipping point a rigid solid rolling on its section's corners, bouncing and sliding to rest on its side or roof; hops over wrecked cars. The centre of mass is placed so the rigid truck tips 12% past the definition's cornering limit, so a truck's data needs nothing new.
- **Cornering by speed.** At town speeds the truck corners no harder than its limit, well inside the threshold, so a junction on full lock never rolls it (a first tuning let it go over at 20 km/h, and the steering tests caught it). On the open road the limit opens up to where the tyres hold, past the threshold: a turn taken too fast at 50 km/h or more rolls the truck.

It stays deterministic, allocation-free per step and headless-testable (`bodyMotion.test.ts`, `DrivingWorld.test.ts`). It is still not a general rigid-body simulation: the body's roll and pitch are solved separately, each as a rolling polygon, and the ground is flat.

## Revisit when

- trailers, articulated steering or physical cargo are in scope (spec V3); or
- device testing shows the model cannot give the feel we want.

Rapier (or another engine) can then live behind the same DrivingService boundary.
