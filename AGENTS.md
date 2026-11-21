# AGENTS.md — TypeScript Coding Standards (FDH com amigos)

This document defines the code quality guidelines for this project. AI agents and developers must respect these conventions when generating, reviewing, or modifying code.

When a rule here conflicts with an established pattern in the codebase, follow the codebase and raise the conflict — do not silently "fix" unrelated code to match this document.

---

## 0. Project Overview

Multiplayer party card game (private rooms, in-memory state). Bun workspaces:

| Path | Responsibility |
|---|---|
| `server/src/` | Authoritative game server (Bun HTTP + WebSocket). Rules, rooms, sessions, bots, projections. |
| `client/src/` | React + Vite UI and Three.js 3D table. Renders snapshots; never computes rules. |
| `shared/` | Code and types imported by both sides: protocol contract, logging, theme, prompt helpers. |
| `server/cards/` | Card catalog (`prompts.json`, `responses.json`). |
| `server/tests/` | `bun:test` unit/integration tests. |
| `scripts/` | Playwright smoke tests (mobile, 3D, audio). |

### Commands

```sh
bun install --frozen-lockfile
bun run typecheck   # server, client and scripts
bun test            # server/tests
bun run build       # client build
bun run test:mobile | test:3d | test:audio   # Playwright smoke tests (build first)
```

**Before considering a task done:** `bun run typecheck` and `bun test` must pass. Run the relevant smoke test when changing the 3D table, mobile layout, or audio.

### Language

- Identifiers, types, file names: **English**.
- User-facing text, code comments, test names, README and commit messages: **Portuguese (pt-BR)**.

---

## 1. Architecture Invariants (non-negotiable)

These protect correctness and player privacy. Any change that breaks one of them is a bug, even if tests pass.

1. **The server is authoritative.** The client replaces its state with each snapshot; it never deals cards, scores, or decides phase transitions.
2. **`shared/protocol.ts` is the contract.** Changing a command or event means updating the type, the runtime validation in `server/src/protocol.ts` (`payloadKeys` + field checks), the handler, the client, tests, and the README protocol table.
3. **Types are not validation.** Every value from the network is `unknown` until validated in `server/src/protocol.ts`. Unexpected fields are rejected.
4. **Projections never leak private state.** `server/src/projections.ts` builds per-player snapshots. Never serialize internal objects directly; never expose other players' hands, session tokens, original card IDs of judging options, submission order, or authorship (except the revealed winner).
5. **Commands are synchronous.** No `await` between validating a command and applying it. There are no locks; synchronous execution is what keeps room state consistent.
6. **Time and randomness are injected where testability matters.** Rule functions receive `now: number`; services receive `now: () => number`. Never call `Date.now()` inside game rules.
7. **No third-party services or new runtime dependencies** without an explicit decision (see README "Limites e segurança").

---

## 2. SOLID, Adapted to a Function/Module Codebase

This project is written mostly with **modules, plain functions, and factory functions** (`createRoomService`, `createLogger`), not class hierarchies. Apply the intent of SOLID, not its Java shape. **Do not introduce classes or interfaces just to satisfy a principle.**

### Single Responsibility — per module and per function

Each module owns one concern (see the table in the README "Estrutura e estado"). Keep it that way:

```ts
// ❌ Wrong — rule logic leaking into the transport layer
// connections.ts
if (room.game.phase === "submitting" && player.id !== round.judgePlayerId) { ... }

// ✅ Correct — transport delegates; rules live in game.ts
service.execute(connectionId, command);
```

Large files are a smell. Files over ~400 lines (e.g. `client/src/table/scene.ts`) should be split by responsibility when you touch them substantially — not as drive-by refactors.

### Open/Closed — lookup tables over type-switch chains

```ts
// ❌ Wrong
function phaseLabel(phase: GamePhase): string {
  if (phase === "lobby") return "Sala de espera";
  if (phase === "submitting") return "Respostas";
  ...
}

// ✅ Correct — exhaustive at compile time: adding a phase forces an update here
const PHASE_LABELS = {
  lobby: "Sala de espera",
  submitting: "Respostas",
  judging: "Julgamento",
  round_result: "Resultado",
  finished: "Fim de jogo",
} as const satisfies Record<GamePhase, string>;
```

### Interface Segregation — narrow parameter and prop types

Functions and components should ask only for what they use.

```ts
// ❌ Wrong — needs one field, demands the whole snapshot
function Score({ snapshot }: { snapshot: Snapshot }) { ... }

// ✅ Correct
function Score({ score }: Pick<PlayerView, "score">) { ... }
```

### Dependency Inversion — inject through options objects

```ts
// ❌ Wrong — hidden global dependencies, untestable timing
export function createRoomService(catalog: Catalog) {
  const now = Date.now;
  ...
}

// ✅ Correct (existing pattern)
export function createRoomService(catalog: Catalog, options: { now: () => number; logger?: Logger; ... }) { ... }
```

---

## 3. Low Cyclomatic Complexity

Aim for **≤ 5** per function. State-machine code (e.g. clock sync across phases) may go up to **10**; beyond that, split it. Each `if`, `else if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `??`, `?:` adds a branch.

**Strategies:**
- Extract blocks into well-named functions.
- Replace conditionals with lookup tables (`Record<Union, T>`).
- Early return to remove nesting.

```ts
// ❌ High complexity
function scoreLabel(score: number): string {
  if (score >= 90) {
    if (score === 100) return "Perfeito";
    else return "Excelente";
  } else if (score >= 70) {
    return "Bom";
  } else {
    return "Regular";
  }
}

// ✅ Decision table
const SCORE_LABELS: ReadonlyArray<readonly [min: number, label: string]> = [
  [100, "Perfeito"], [90, "Excelente"], [70, "Bom"], [0, "Regular"],
];

function scoreLabel(score: number): string {
  return SCORE_LABELS.find(([min]) => score >= min)![1];
}
```

---

## 4. Early Return — Avoid Unnecessary `else`

Handle invalid or trivial cases first; keep the main flow unindented.

```ts
// ❌ Wrong
function syncRound(room: GameRoom, now: number): void {
  const round = room.game.round;
  if (round) {
    if (room.game.phase === "submitting") {
      ...
    }
  }
}

// ✅ Correct
function syncRound(room: GameRoom, now: number): void {
  const round = room.game.round;
  if (!round) return;
  if (room.game.phase !== "submitting") return;
  ...
}
```

---

## 5. Validations — `requireRule` and Named Predicates

Rule violations use the existing assertion helper `requireRule(condition, ErrorCode)` from `server/src/errors.ts`. Put validations at the **top** of the command handler, before any mutation.

When a condition is compound or reused, extract it into a named predicate:

```ts
// ❌ Wrong — intent is hidden in the expression
requireRule([...room.players.values()].every(p => p.disconnectedAt === null), "PLAYERS_DISCONNECTED");

// ✅ Correct
function everyoneConnected(room: GameRoom): boolean {
  return [...room.players.values()].every(player => player.disconnectedAt === null);
}

requireRule(everyoneConnected(room), "PLAYERS_DISCONNECTED");
```

Group several related checks into a `validateX(room, ...)` function when a handler starts with more than ~3 of them. Never mutate state before all validations have passed.

---

## 6. Naming

**Do not abbreviate**, except in widely accepted contexts.

| Context | Acceptable | Preferred |
|---|---|---|
| Numeric loop index | `i`, `j` | descriptive (`offset`, `index`) when it carries meaning |
| One-line lambda params | `p`, `id`, `card` | full name if the lambda spans more than one line |
| Domain names | ❌ `plr`, `rnd`, `resp` | ✅ `player`, `round`, `response` |
| Project conventions | `T` for `import * as T from "three"`; `h` for the test harness from `table()` | — |
| 3D geometry math | `x`, `y`, `z`, `w`, `h`, `d` for coordinates/dimensions | descriptive names for meshes, materials, textures and canvas contexts (`mesh`, `material`, `texture`, `context`) |

- Constants: `UPPER_SNAKE_CASE` (`RESULT_DURATION_MS`, `HAND_SIZE`). Include the unit in the name (`_MS`, `_SECONDS`, `_BYTES`).
- Functions: verbs (`startGame`, `projectSnapshot`). Predicates: `is`/`has`/`can` (`isPaused`, `hasPlayerPlaceholder`).
- React components and their files: `PascalCase`. Other modules: `camelCase`.
- Protocol event/command names and log events: `dot.case` (`round.submit`, `command.rejected`).

---

## 7. TypeScript Strictness

- `strict`, `noUnusedLocals`, `noUnusedParameters` are on. Keep them on.
- **No `any`.** Use `unknown` and narrow with type guards (see `isRecord`, `isIntegerInRange`, `isBoundedString` in `server/src/guards.ts`).
- **Avoid `as` casts.** Allowed only right after runtime validation or for DOM/library typing gaps; leave a reason if not obvious.
- **Non-null assertion `!`** only for invariants already guaranteed (e.g. an ID that was validated a few lines above). Prefer narrowing otherwise.
- Use `import type` for type-only imports.
- Use `satisfies` to check literal objects against a type without widening them.
- No TypeScript `enum` or `namespace` — use string literal unions and `as const` (see §10).
- Exported functions declare their return type when it is not trivially inferred.

---

## 8. Errors

- **Expected rule violations** → `throw new RuleError(code)` / `requireRule(...)`. `ErrorCode` is a union in `shared/protocol.ts`; add a new code there instead of reusing an unrelated one.
- **Unexpected errors** are converted to `INTERNAL_ERROR` at the command boundary. Never send internal error messages to the client.
- Never `throw "string"` or `throw new Error()` for an expected game condition.
- **Empty `catch` is only allowed with a comment explaining why the failure is safe to ignore** (e.g. `localStorage` blocked in private mode, Web Audio context already closed). This is an existing, deliberate pattern on the client:

```ts
// ❌ Wrong
try { localStorage.setItem(KEY, value); } catch {}

// ✅ Correct
try { localStorage.setItem(KEY, value); } catch { /* Continuar em memória se o armazenamento estiver bloqueado. */ }
```

- Promises: never leave one floating. Either `await` it or mark it with `void promise.catch(...)` and a reason.

---

## 9. Absence of Value — `null` vs `undefined`

(Replaces Java's `Optional`.)

- **State and protocol data** use `T | null` for "known to be absent" (`deadlineAt: number | null`, `winnerPlayerId: string | null`). `null` survives JSON; `undefined` does not.
- **Optional parameters, props, and payload fields** use `?` (`targetScore?: number`).
- Do not mix both meanings in the same field (`x?: T | null`) unless the protocol needs "omitted = keep" vs "null = clear" — as `room.configure` does; document it when you do.
- Use `?.` and `??` for safe chaining; do not use `||` for defaults on numbers or strings that can legitimately be `0` or `""`.

---

## 10. Immutability — Where It Applies Here

The server **deliberately mutates room state in place**: it is single-threaded, commands are synchronous, and every change bumps the room version. Do not rewrite game rules to an immutable style.

What *is* required:

- **Mutation is confined to rule/room modules** (`game.ts`, `rooms.ts`, `bots.ts`, `cards.ts`). Projections, HTTP handlers, and logging must not mutate state.
- **Never hand out internal references.** Projections copy (`{ ...settings }`, `structuredClone(history)`) so a snapshot can't alias live state.
- **Client state is immutable.** Snapshots and React state are treated as read-only; produce new objects/arrays instead of mutating.
- Prefer `const`, `readonly` fields on view/config types, `ReadonlyArray`, and `as const` for fixed tables.

---

## 11. Avoid Primitive Obsession — Unions and Typed IDs

**Use string literal unions instead of magic strings or TS `enum`:**

```ts
// ❌ Wrong
function setPhase(phase: string) { if (phase === "judgng") ... }   // typo compiles

// ✅ Correct (existing pattern)
export type GamePhase = "lobby" | "submitting" | "judging" | "round_result" | "finished";
```

**Derive types from constant arrays** so values and type never drift:

```ts
export const PHASE_TIME_LIMITS = [30, 60, 90, 120, 180] as const;
export type PhaseTimeLimit = typeof PHASE_TIME_LIMITS[number];
```

**Attach behavior via exhaustive maps**, not scattered `if`s (see §2 OCP). For a `switch`, add an exhaustiveness check:

```ts
default: {
  const unreachable: never = phase;
  throw new Error(`Fase não tratada: ${unreachable}`);
}
```

**Typed IDs (optional, for new code):** many IDs are plain `string` (`playerId`, `roundId`, `cardId`, `optionId`), which makes swapping arguments easy. When writing new functions that take two or more IDs, consider branded types:

```ts
type PlayerId = string & { readonly __brand: "PlayerId" };
type RoundId = string & { readonly __brand: "RoundId" };
```

Introduce them incrementally; do not do a project-wide migration as part of an unrelated change.

---

## 12. Tests

- Framework: `bun:test` (`describe`, `test`, `expect`). Tests live in `server/tests/`.
- **Test names describe behavior in pt-BR**, not function names: `test("somente anfitrião configura e inicia", ...)`.
- Use the `table()` harness from `server/tests/helpers.ts` to drive rooms through the real command pipeline (`parseMessage` → `service.execute`) instead of calling internals directly.
- **Deterministic time:** control the injected clock; never use real timers or `sleep`.
- Do not mock internal modules. Fake only the boundaries (clock, logger writer, socket).
- Every new command, error code, or rule needs at least one test for the happy path and one for each rejection reason.
- Privacy rules (§1.4) need explicit tests asserting what is *absent* from other players' snapshots.
- **No hidden randomness in assertions:** the judge and the decks are random. Never assume which connection is the judge; find it from the snapshot. Derive expected counts from the catalog instead of hard-coding them.
- Follow Arrange / Act / Assert; with compact harness tests, a blank line between the sections is enough.
- UI, 3D, and audio changes are covered by the Playwright smoke scripts in `scripts/`.

---

## 13. Logging

Use the structured logger (`server/src/logger.ts`, `client/src/connection/logger.ts`). Never `console.log` directly. Exception: the CLI smoke scripts in `scripts/` print their summary with `console.info`.

```ts
// ❌ Wrong
console.log("Player " + playerId + " joined room " + roomCode);

// ✅ Correct
logger.info("room.joined", { roomCode, playerId, playerCount: room.players.size });
```

- Event names are `dot.case`, stable, and searchable.
- Only fields in the allowlist in `shared/logging.ts` are written. Adding a field is a deliberate decision — never add fields carrying **card text, nicknames, session tokens, raw payloads, or error messages**.
- Pass errors as the third argument of `logger.error`; the logger keeps only the error name and stack frames.
- Level guide: `debug` per command, `info` lifecycle events, `warn` rejected/recoverable, `error` unexpected failures.

---

## 14. React (client)

- Function components only; type props inline or with a local type.
- Components render state; game logic stays on the server and connection logic stays in `client/src/connection/`.
- Every interactive control is keyboard-accessible and has an accessible name in pt-BR (`aria-label` when there is no visible text).
- Layout must work on phones (see `bun run test:mobile`).
- Respect the theme tokens in `shared/theme.ts` / CSS variables instead of hard-coded colors.

---

## 15. Three.js (client/src/table)

- **Dispose what you create:** geometries, materials, textures, and render targets must be disposed on unmount/rebuild.
- **No allocations in the render loop:** reuse `Vector3`, `Matrix4`, etc. hoisted to module or closure scope.
- Keep scene construction (`scene.ts`), props (`props.ts`), textures (`textures.ts`), and data mapping (`model.ts`) separated.
- Provide a non-WebGL fallback path when adding features that depend on GPU support.

---

## 16. Card Catalog

- Card IDs are unique across `prompts.json` and `responses.json`.
- Prompts may set `pick` (1–3) and `draw` (0–2). Rules use these fields; never count blanks in the text.
- `{player}` in a prompt is replaced by player nicknames (`shared/prompts.ts`).
- The server validates the catalog at startup; keep `bun test` green after editing cards.

---

## 17. General Rules

- **No magic numbers** — named constants with units and numeric separators (`15_000`, `RESULT_DURATION_MS`).
  - **Game rules shared by client and server** (`MIN_PLAYERS`, `MAX_PLAYERS`, `HAND_SIZE`, `HISTORY_LIMIT`, `RECONNECT_GRACE_SECONDS`, `TARGET_SCORE_RANGE`, `NICKNAME_LENGTH`, `PICK_RANGE`, `DRAW_RANGE`) live in `shared/protocol.ts`. Never repeat their values as literals in UI text or inputs.
  - **Exception — visual tuning in `client/src/table/`:** material, lighting, geometry and texture values are art parameters; inline literals are acceptable when local to the object they shape. When a value varies by kind (card type, seat state), use a lookup table (see `CARD_FINISHES` in `scene.ts`).
  - HTTP status codes are self-describing; WebSocket close codes are not (use `CLOSE_CODES` in `server/src/connections.ts`).
- **Comments only when strictly necessary for understanding.** Add a comment *only* to explain **why** a non-obvious decision, invariant, or workaround exists — **never** to describe *what* the code does. If the code is clear on its own, do not comment it; remove comments that merely restate the code.
- **Keep the README in sync** when changing commands, protocol, limits, environment variables, or gameplay rules.
- **No unrelated changes** in a task: no drive-by reformatting, renaming, or refactors outside the scope.
- **Commits:** pt-BR, imperative, short subject (`Adiciona reinício na mesma sala`). Feature branches use a prefix such as `edicao/…` or `redesign/…`.
- Never commit `.env`, backups (`*.tar.gz`), or build output.

---

*This document should evolve alongside the project. Update it whenever new conventions are established during code reviews.*
