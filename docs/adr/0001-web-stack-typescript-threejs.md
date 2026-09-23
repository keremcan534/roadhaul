# ADR 0001: Web stack (TypeScript + three.js) instead of Unity

- **Status:** Accepted
- **Date:** 2026-09-23
- **Supersedes:** spec §6 "Technical stack" (Unity 6 LTS + C# + URP)

## Context

The design spec (`docs/ROADHAUL_Game_Design_Technical_Spec.md`) recommends Unity 6 LTS. Three facts change that:

1. **The project owner does not have Unity** and explicitly allowed three.js if it suits mobile better.
2. **Development happens mainly through Claude Code.** Much of it runs in cloud sessions that have no Unity editor, no GPU and no Unity license. The spec's own workflow requires every change to compile and pass tests (§46, §47, §70). Unity cannot compile, test or run a project without an installed, licensed editor. Under Unity, Claude Code could therefore never verify its own work.
3. **The target is modest:** stylized low/mid-poly visuals, 30 FPS on low/mid Android, a 3-city MVP (§5, §43, §60). This is within reach of WebGL2 on current Android devices.

## Decision

Build RoadHaul as a web game:

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Rendering | three.js, WebGL2 (`WebGLRenderer`) |
| Build / dev server | Vite |
| Unit tests (spec: EditMode) | Vitest |
| End-to-end tests (spec: PlayMode) | Playwright on emulated Android phones |
| Vehicle physics (roadmap step 05) | ~~Rapier (`@dimforge/rapier3d-compat`, WASM), raycast vehicle controller~~. Superseded by [ADR 0002](0002-custom-vehicle-model.md): a custom deterministic truck model in TypeScript |
| Android / iOS packaging (step 28) | Capacitor wrapper around the same build, built in CI |
| Windows | The browser, or a desktop wrapper later |

## Reasons

- **Verifiable by the main developer.** Claude Code can typecheck, unit test, build, run the game in headless Chromium and screenshot it. CI can repeat all of that on every pull request.
- **Zero install for the owner.** Any phone browser runs a build. No 15+ GB editor, no Android modules, no license activation.
- **Everything is text.** Scenes, content and configuration are code and data, so diffs are reviewable. There are no binary scene or prefab merges and no Git LFS for authored content.
- **The architecture carries over unchanged.** Layering, services, the event bus, data-driven definitions and versioned saves (§7, §54–§57) do not depend on the engine. The engine-agnostic layers are plain TypeScript and could also run on a Node server for the future server-authoritative mode (§66).

## Consequences and risks

- **No visual editor.** Levels are built from code and data (and Blender glTF assets once art exists). *Mitigation:* data-driven road and city generation.
- **Vehicle physics is not built in.** It needs Rapier plus tuning (ADR 0002 replaced Rapier with a custom model). The spec already names vehicle feel as the biggest technical risk (§74). *Mitigation:* prototype first (steps 04–08) and test on a real phone early.
- **Lower performance ceiling than native Unity**, with WebView variance on old devices. *Mitigation:* the `?debug` overlay, explicit budgets (ARCHITECTURE.md §11) and device tests from step 07.
- **Stores need a wrapper.** Google Play needs a Capacitor build, and CI needs the Android SDK.
- **Large worlds (V2+) need streaming.** Dynamic `import()` per region replaces Addressables.
- **The spec uses Unity vocabulary.** CLAUDE.md contains the translation table.

## Alternatives considered

- **Unity 6 (spec default):** the strongest engine for mobile 3D, but unusable in this workflow: the owner cannot run it and cloud sessions cannot compile or test it.
- **Godot 4:** free, light, exports to Android. The owner would still need the editor, and its scene files and tooling are harder to verify in this environment.
- **Babylon.js:** more built in (physics, GUI, inspector) and a valid option. three.js won on ecosystem size, examples and a smaller core, and it was the owner's suggestion.
- **PlayCanvas:** its editor-centric, cloud-hosted workflow fits git-based, code-first development poorly.

## Revisit when

- the driving prototype (steps 05–08) cannot reach good vehicle feel, or 30 FPS on a mid-range Android phone (step 29); or
- the scope moves to large streaming open worlds (V2+ "100 cities").
