# CLAUDE.md

Guidance for Claude Code sessions working in this repository.

## What this repo is

Long-term fork of [`Lumysia/copilot-api-plus`](https://github.com/Lumysia/copilot-api-plus) (which itself forks `ericc-ch/copilot-api`).

A Hono HTTP proxy that exposes GitHub Copilot via OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) APIs.

## Workflow — two-machine collaboration

Two machines collaborate via this repo:

- **Dev machine** (no active Copilot subscription): writes code, unit tests, integration tests with mocks, opens upstream PRs
- **Validation machine** (active Copilot subscription): pulls feature branches, runs e2e tests against real Copilot, captures fixtures + reports, commits them back

If another `copilot-api` instance is already running on the validation machine (e.g. as an editor backend), e2e tests must NOT collide with it. They spawn their own server on `COPILOT_API_E2E_PORT` (default `14141`) — pick a different port from any running instance.

## Branch strategy

- **`master`** = our integration branch. Inherits from `upstream/master` plus our infrastructure (this CLAUDE.md, tests/, helpers, fixtures).
- **Feature branches for upstream PRs** branch from **`upstream/master`** — NOT from our `master`. This keeps PR diffs free of our infra files.
- After upstream PR opened: same commit fast-forward-merged into our `master`. Follow-up commits add e2e mirror + fixture-loading integration variant.
- **Never push directly to `master`.** Branch + PR (own-fork PR for review trail).
- **Never `git push --force` to `master`.**
- Quarterly `git fetch upstream && git rebase upstream/master`. If upstream merges our patches → squash out on rebase.

## Upstream PR policy

- **Send to upstream**: bug-fixes that any upstream user benefits from
- **Don't send**: refactors-for-our-style, e2e infra, fixture commits, this CLAUDE.md, fork-exclusive features
- **If upstream requests cleanup before merge**: add reasonable surface; if request pulls in our infra, politely decline and keep fix in our fork only
- **Tone**: standard upstream contribution. No mention of fork strategy or downstream tooling.

## Test layout

```
tests/
├── *.test.ts                  # unit + integration (mock-based), always-on
├── *.e2e.test.ts              # e2e (real Copilot), opt-in via RUN_E2E=1
├── __fixtures__/<scenario>/*.json
├── __reports__/<branch>/<date>-<sha>.md
└── _helpers/
    ├── client.ts              # MakeRequest interface
    ├── client-real.ts         # E2E transport (HTTP to local copilot-api)
    ├── client-mock.ts         # Integration transport (load fixture)
    ├── sanitize.ts            # auto-strip sensitive fields
    ├── report.ts              # generate markdown report
    └── scenarios/<patch>.ts   # describe-blocks shared between integration + e2e
```

## How to run tests

```bash
bun test                        # unit + integration only (e2e skipped via test.skipIf)
RUN_E2E=1 bun test              # all tests, including e2e
RUN_E2E=1 bun test tests/<name>.e2e.test.ts   # single e2e file
bun run test:fixtures-check     # grep-guard for sensitive data in staged fixtures
```

E2E tests spawn `copilot-api start --port $COPILOT_API_E2E_PORT` (default `14141`) as a subprocess in `beforeAll` and kill it in `afterAll`. They authenticate via the existing Copilot login state — same as a normal `copilot-api` install.

## 🚨 FIXTURE SANITIZATION (CRITICAL — read before EVERY fixture commit)

E2E tests capture real Copilot responses. Real responses contain **sensitive data**: account IDs, request IDs, rate limit headers, organization metadata, infrastructure identifiers. Committing these is a leak.

**Three layers of defense:**

### Layer 1 — Auto-strip during capture (`tests/_helpers/sanitize.ts`)

`client-real.ts` calls `sanitize()` on EVERY captured response BEFORE writing fixture. Drops:

**Headers (case-insensitive):**
- `authorization`, `cookie`, `set-cookie`
- `x-github-*`, `x-ratelimit-*`, `cf-*`
- `x-request-id`, `x-trace-id`, `via`
- Anything matching `/^x-amz-/i` or `/^x-azure-/i`

**Body keys (recursive, case-insensitive):**
- `account_id`, `user_id`, `email`, `login`
- `request_id`, `trace_id`, `session_id`
- `org_id`, `client_id`, `installation_id`
- Any host/machine identifier (`hostname`, `machine_id`, `device_id`)
- UUID-shaped values at any `id` field EXCEPT top-level `model.id` (model IDs are public)

**`_meta` whitelist** — only these keys allowed in fixture metadata:
`scenario`, `captured_at`, `commit`, `branch`, `copilot_api_version`

Anything else (hostnames, subscription tier, usernames, paths) — dropped or never recorded.

### Layer 2 — Pre-commit guard (`scripts/check-fixtures.sh`)

Runs automatically on `git commit` (via `simple-git-hooks`). Greps staged fixture files for forbidden patterns. **Blocks commit on hit.**

Manually: `bun run test:fixtures-check`.

### Layer 3 — Human review (THIS RULE)

**Before `git add tests/__fixtures__/`:**

1. Run `bun run test:fixtures-check` — must pass
2. **Visually review every changed `.json` file**
3. Open each fixture, scan for: emails, GitHub usernames, account IDs, hostnames, subscription/tier strings, any string that looks like a personal identifier
4. Only then `git add`

**NEVER skip step 3.** Sanitization helpers can have bugs. Pre-commit guards have false negatives. Your eyes are the last line.

If sensitive data slipped through and was pushed:
1. Rotate the leaked credential (Copilot token re-auth)
2. Rewrite git history with `git filter-repo` to remove the leaked content
3. Force-push (one-time exception to the no-force-push rule, with explicit owner confirmation)
4. Document the gap in `tests/_helpers/sanitize.ts` and add a regression test

## Commit & PR conventions

- **No AI-attribution footers** in commit messages or PR descriptions. No "Generated with Claude" / "Co-Authored-By: Claude" blocks.
- Conventional Commits style: `fix:`, `feat:`, `test:`, `docs:`, `chore:`
- One logical change per commit. Tests live in the same commit as the code they cover.
- PR descriptions: problem statement → fix summary → test coverage. Three sections, terse.

## Known model capabilities

Upstream's `Model.capabilities.supports` (in `src/services/copilot/get-models.ts`) exposes:
- `reasoning_effort: boolean` — discrete low/medium/high model
- `adaptive_thinking: boolean` — auto-effort model (no discrete level)
- `min_thinking_budget`, `max_thinking_budget` — budget bounds for thinking

The `thinking → reasoning_effort` translation reads these dynamically. Do NOT introduce a static model→capability table — it would drift. Re-validate fields against the live `/models` response if Copilot API surface shifts.

## Common tasks

### Adding a new patch (with upstream PR target)

1. `git fetch upstream`
2. `git checkout -b feat/<name> upstream/master`
3. Implement: source change + unit tests + integration tests with **inlined mocks** (no fixture-file dependency in the PR-bound branch)
4. `bun run lint:all && bun run typecheck && bun test` — all green
5. Push, open PR to upstream master
6. `git checkout master && git merge --ff-only feat/<name>` (or PR into our master)
7. On master, follow-up commit: add `tests/<name>.e2e.test.ts` mirror + switch integration to load from `tests/__fixtures__/<name>/`
8. Open issue documenting the bug + linking upstream PR + our merge commit
9. Notify the validation machine to pull `master` and run `RUN_E2E=1 bun test tests/<name>.e2e.test.ts`

### E2E validation workflow (validation machine)

1. `git fetch && git checkout master && git pull`
2. `bun install` (if dependencies changed)
3. `RUN_E2E=1 bun test tests/<name>.e2e.test.ts` — runs real Copilot requests, captures fixtures + report
4. `bun run test:fixtures-check` — must pass
5. Visually review changed fixtures (see CRITICAL section above)
6. `git add tests/__fixtures__/<name>/ tests/__reports__/master/`
7. Commit + push

### Updating from upstream

1. `git fetch upstream`
2. `git checkout master && git rebase upstream/master`
3. Resolve conflicts (rare — patches additive)
4. If upstream merged one of our patches → that patch's commit is now redundant; drop it during rebase (`git rebase` will detect via patch-id, or manually skip)
5. `bun install && bun test && bun run build` — verify still green
6. Push (regular push, never `--force` to master)
