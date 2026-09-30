# Codemode declaration accounting — local fork spec

## Scope and achieved state

Usage and Initial must not count active-but-hidden tool schemas as declarations sent to the model. Preserve every existing raw preview and prompt-line attribution. Keep this fork local until the owner explicitly requests an upstream PR. No runtime provider, permission, active-tool, codemode, or toolkit changes.

## Trust boundaries

- The extension observes `before_provider_request` passively: no return value, mutation, abort, network call, extra model turn, or session write.
- Keep only an owned copy of recognized tool declarations in process memory, never the surrounding payload, messages, headers, credentials, or signatures. Existing explicit Enter and terminal sanitization protect previews.
- This hook is an observation point, not proof of HTTP delivery or a guaranteed final payload: later handlers may rewrite it. Label it accordingly and load the fork after other configured extensions.
- Before observation, after reload/branch/model/loadout/compaction change, on unsupported/malformed payload, and after failed observation: do not reuse incompatible evidence or claim exact measurement. Show a clear estimate/availability notice.

## Design

1. A focused module extracts complete declaration lists from supported provider payload shapes (OpenAI Responses/Chat Completions, Anthropic, Google if bounded adapters are feasible). Unsupported or malformed input is unavailable, never an empty declaration set. A recognized payload without declarations or with an explicit empty list can prove no tools at that observation point.
2. Reconcile only Definition sections in the existing semantic tool tree. Count observed provider declarations once, including transformed codemode descriptions. Preserve prompt snippets/guidelines that really occur in the prompt. Hidden definition previews remain available as zero-token Dropped inventory; their schemas never enter category/map totals.
3. Initial receives at most one tools-only refinement for its matching first capture/request. A silent-probe Initial is not silently relabeled as an observed real request. Usage uses a latest observation only with a compatible branch/model/loadout identity; otherwise keep clearly labeled fallback estimates.
4. Surface fixed notices in both views: observed declaration scope, hidden-inventory semantics, unobserved/stale/unsupported fallback. Token amounts remain chars/4 estimates; Pi-reported usage is separate. No claim of exact whole-request accounting.
5. Keep command grammar, probe behavior, ordinary message accounting, and upstream known message-replacement limitations unchanged.

## Acceptance and fault-first evidence

| Requirement / failure | Test / evidence |
| --- | --- |
| Codemode-only hides raw schemas but counts expanded codemode description | Fixtures with large hidden schemas + transformed codemode; assert tokens and preview content |
| On-mode/direct tools remain counted | Recognized provider declarations containing all tools |
| Empty tools are authoritative; unsupported/malformed are not | Absent/empty/mixed/duplicate/invalid/non-object fixtures with explicit adapter identity |
| Input is immutable and owned | Deep-freeze source, mutate source after observation, assert snapshot unchanged |
| No payload messages/secrets/signatures retained | Sentinel payload fields absent from captured result and previews; hook returns undefined |
| Prompt snippets survive while hidden Definition is zero | Section/child/parent/category sums and preserved prompt ownership |
| No double-counting or loss of provider-only tool | Aggregation tests, including unregistered declaration |
| Evidence freshness | Tests for branch/model/loadout changes, compaction/reload, repeated calls and failed payload parsing |
| Initial semantics and probes preserved | Existing capture/probe tests + matching-first-request refinement tests; real Pi smoke in both extension orders |
| No UI overflow | Existing rendering suite and notice checks at 60/80/120 columns and short heights |
| Same executable package entrypoint works | `pnpm check`; actual Pi CLI/PTY with native codemode and synthetic declarations; fresh interactive `/reload` verification |

## Delivery slices

- Slice 1: extractor/reconciliation/freshness unit with fault-first tests. No global installation change.
- Slice 2: passive event and view wiring, documentation, integration/regression tests. This is a justified multi-file final diff because the upstream contract splits model, measurement, wiring, both views, and owning docs; do not add unrelated refactors.
- After final mutation, fresh full tests + independent branch-wide review. Install by replacing only the npm package declaration with this checkout's absolute local source, keep a settings backup and rollback instructions. No upstream push/PR/tag/release.
