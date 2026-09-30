# Local fork validation — 2026-09-30

## Identity and scope

- Upstream baseline: `234cfcd` (v0.6.0), remote `upstream` = dimk90/pi-context-view.
- Local branch: `fix/codemode-payload-accounting`. No GitHub fork publication, upstream PR, npm publish, tag, or release.
- Runtime and development pins: Pi 0.99.1. Modern upstream workspace format requires pnpm 12.8.1 here; local pnpm 9.7.0 rejects it before installation.
- Spec/acceptance contract: `CODEMODE-ACCOUNTING-SPEC.md`.

## Pre-code and slice review decisions

Bounded architecture, security and testability reviewers identified missing first-request correlation, undefined freshness, unbounded declaration copies, and incomplete test oracles. The spec now defines a one-shot local turn/branch/key match, exact-prefix freshness and invalidation rules, conservative byte/depth/node/count caps, and fixture outputs.

Focal review of the first committed slice identified duplicate semantic labels consuming the same declaration twice. Added a negative regression (failed with 2 visible Definition sections instead of 1), then a consume-once guard. Size-preflight differences were addressed with conservative JSON-escaping bounds before serialization, descriptor-only traversal, count bounds, and depth/node/accessor tests. The second name-space observation is covered by comparing the candidate's provider name; namespace wrappers count once. An item with surviving real prompt Guidelines intentionally is not wholly Dropped: only its hidden Definition section reads zero.

## Executed evidence

```sh
npm exec --yes --package=pnpm@12.8.1 -- pnpm check
node scripts/smoke-codemode.mjs
git diff --check
```

- Typecheck + **268 tests passed**, zero failures/skips at this checkpoint.
- Tests cover codemode-only and direct/on-mode, transformed description, hidden inventory, real prompt-line attribution, aggregate/category/section sums, provider-only functions, namespace wrappers, duplicate labels, empty/unknown/malformed payloads, source ownership/nonmutation, limits/accessors, Initial one-shot semantics, later requests, stale branch/model/loadout/context-edit/compaction evidence, and notices at 60/80/120 columns with 16/24/40-row resizing.
- Real Pi CLI/PTY smoke passed in **both extension orders**, using upstream marker/forced-prompt/input-transform fixtures. A private synthetic agent directory and a loopback OpenAI Responses SSE server prevent personal data/credentials or paid model calls.
- The first explicit probe produced **zero HTTP requests** and zero `after_provider_response` sentinel entries.
- A real synthetic prompt serialized only `codemode`, including the synthetic callable signature. The direct synthetic schema was absent from HTTP declarations and appeared as **0 Dropped** inventory in Injections. Usage had observed Built-in Tools and no raw-schema Custom Tools category.
- Repeated open/Enter preview/reopen/reload performed no additional provider requests. Reload showed incomplete declaration evidence rather than reusing stale process memory. The probe-created Initial stayed unobserved; the real-prompt-first Initial in the other order received matching evidence.
- Temporary test processes, server, agent directory and synthetic sessions/output were cleaned up.

## Remaining limits

- The hook observes its own position in registration order, not guaranteed final HTTP delivery; later handlers can change the payload. The installed fork should be last in the configured package list.
- Definition counts are heuristic, not exact tokenizer counts. Pi's header usage is independently reported/estimated and is not forced to match category sums.
- Initial remains historical. After a probe-created Initial, use Usage for later compatible real declaration evidence.
- Prompt/message replacements and late provider prompt rewrites retain upstream limitations; this change fixes declaration accounting, not complete payload accounting.
- Unsupported provider built-in/custom tool formats degrade with an incomplete-estimate warning, never a partial/zero-tools claim. Google is a semantic per-function estimate without group framing.
- The real smoke is synthetic/isolated. Owner `/reload` plus a normal GPT-6 Luna turn and `/context` remains the final personal-session acceptance test.

An independent final branch-wide review is required after the committed candidate; its result is reported separately rather than predicted in this evidence record.
