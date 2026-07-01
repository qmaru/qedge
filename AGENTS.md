# qedge

## Project Overview

`qedge` is a lightweight agent project collection running on edge devices, providing different entry points for different access scenarios.

This repository currently includes two capabilities:

- Specific gateway forwarding: based on authentication information in the request, forward traffic to preconfigured upstream services.
- MQTT subscription agent: subscribe to specified topics, receive task messages, and complete agent tasks through command execution or API calls.

These subprojects are not business-related and do not share runtime state. They are placed in the same repository and reuse a small set of common functions, logging, shutdown hooks, and basic utilities.

## Directory Responsibilities

- `src/gateway`: edge gateway entry point. Reads `GATEWAY_*` configuration, derives a routing key from the Bearer token, and forwards requests.
- `src/mqtt`: MQTT agent entry point. Connects to the broker, subscribes to topics, handles `start` / `cancel` / `error` messages, and returns execution results.
- `src/shared`: shared capability layer containing only utilities that are not specific to a subproject, such as logging, graceful shutdown, encoding conversion, and shared client wrappers.
- `src/config.ts`: repository-level base configuration, mainly used for debug switches.
- `tests`: tests around the MQTT agent execution flow.

## Architectural Boundaries

- `gateway` and `mqtt` are two independent subprojects and should not depend on each other.
- Shared code should remain generic and should not place a specific subproject's business rules into `src/shared`.
- If new edge subprojects are added in the future, continue organizing them as independent entry points with independent configuration and shared utilities only.
- Prefer environment variables for configuration rather than hard-coding deployment differences into the code.

## Running the Project

The project runs on Bun. Common scripts are:

- `bun run dev:gw`: start gateway mode.
- `bun run dev:mqtt`: start MQTT mode.
- `bun run build:gw`: build the gateway artifact.
- `bun run build:mqtt`: build the MQTT artifact.

Example environment variables are shown in `.env.example`. For local runs, you can use the `.env` file in the project root.

## Notes for Collaborating Agents

- When modifying `src/gateway`, focus on forwarding logic, authorization header parsing, and `GATEWAY_ROUTE_*` mappings.
- When modifying `src/mqtt`, focus on topic naming, message format, start/stop semantics, and result feedback.
- When modifying the shared layer, prioritize backward compatibility and avoid introducing coupling for a single entry point.
- If a requirement only affects one subproject, keep the change limited to that directory and do not pull the other entry point into it.
