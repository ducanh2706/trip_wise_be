# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — ts-node-dev with `--respawn --transpile-only` and `tsconfig-paths/register` preloaded
- `npm run build` — `tsc` → `dist/`
- `npm start` — runs `dist/index.js` with `tsconfig-paths/register` preloaded (required, see Path aliases below)
- `npm run lint` / `npm run lint:fix` — ESLint over `src/**/*.ts`
- `npm run format` / `npm run format:check` — Prettier
- No test runner is wired up yet

## Architecture

Layered Express 5 + TypeScript backend. Request flow: `routes/ → controllers/ → services/` (services not yet populated).

- `src/index.ts` — only responsible for `app.listen(env.port, …)`. Keep boot logic here, app composition out.
- `src/app.ts` — Express app factory. Order matters: global middleware (cors, morgan, json, urlencoded) → `/api` mount → `notFoundHandler` → `errorHandler`. The two error-stage handlers must stay last.
- `src/routes/index.ts` — aggregator. Every new feature router gets mounted here under a sub-path; do not register routers directly in `app.ts`.
- `src/middlewares/errorHandler.ts` — `notFoundHandler` is a `RequestHandler` (3-arg), `errorHandler` is an `ErrorRequestHandler` (4-arg). Don't conflate them — Express dispatches by arity.
- `src/config/env.ts` — only place that reads `process.env`. Add new env knobs here so callers stay typed.

## Path aliases

`@/*` maps to `src/*` and is used throughout (e.g. `import routes from '@/routes'`). Resolution requires `tsconfig-paths/register`, which is preloaded by both the `dev` and `start` scripts. If you write a new entry script (worker, CLI, migration), it must also preload `tsconfig-paths/register` or imports will fail at runtime even though `tsc` is happy.

## TypeScript config quirks

`tsconfig.json` sets `ignoreDeprecations: "6.0"` because TS 6 deprecates `baseUrl` and `moduleResolution: "node"`, both of which we still rely on for the `@/*` aliases. If migrating off either, update the runtime alias resolver in lockstep.

## Local port

`.env` sets `PORT=4000` (not 3000) because port 3000 is occupied locally by another Next.js app. The default was deliberately moved — don't "fix" it back to 3000 without checking.
