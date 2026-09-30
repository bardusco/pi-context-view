# Codemode declaration accounting — local fork spec

## Scope and achieved state

Usage and Initial must not count active-but-hidden tool schemas as declarations sent to the model. Preserve every existing raw preview and prompt-line attribution. Keep this fork local until the owner explicitly requests an upstream PR. No runtime provider, permission, active-tool, codemode, or toolkit changes.

## Trust boundaries

- The extension observes `before_provider_request` passively: no return value, mutation, abort, network call, extra model turn, or session write.
- Keep only an owned copy of recognized tool declarations in process memory, never the surrounding payload, messages, headers, credentials, or signatures. Existing explicit Enter and terminal sanitization protect previews.
- This hook is an observation point, not proof of HTTP delivery or a guaranteed final payload: later handlers may rewrite it. Label it accordingly and load the fork after other configured extensions.
- Before observation, after reload/branch/model/loadout/compaction change, on unsupported/malformed payload, and after failed observation: do not reuse incompatible evidence or claim exact measurement. Show a clear estimate/availability notice. Initial remains a historical snapshot; invalidating latest Usage evidence does not discard a previously compatible frozen Initial declaration record.

## Design

1. A focused module extracts complete declaration lists from explicit supported API identities (OpenAI Responses/Chat Completions, Anthropic messages, Google generative AI). Unsupported or malformed input is unavailable, never an empty declaration set. Only a recognized API plus a well-formed payload without declarations or with an explicit empty list can prove no tools at that observation point. Cap 4096 declarations, 8 MiB serialized declaration bytes, depth 64 and 100000 visited JSON nodes; reject the whole set, never truncate silently. Check bounds before owned-copy creation; do not recurse into payload messages or headers.
2. Reconcile only Definition sections in the existing semantic tool tree. Count observed provider declarations once, including transformed codemode descriptions. Preserve prompt snippets/guidelines that really occur in the prompt. Hidden definition previews remain available as zero-token Dropped inventory; their schemas never enter category/map totals.
3. Keep the original Initial snapshot frozen; a separate one-shot declaration record may refine its view. Increment a local turn sequence and clear the pending record on `turn_start`. When `context` creates the first real Initial, arm the record with this sequence, active branch entry IDs, and the loadout fingerprint. Consume it on the first `before_provider_request` of the same sequence with identical branch IDs and fingerprint, even on parse failure; clear it on the next turn/invalidation. A probe never arms it. Later observations update Usage only, never Initial.
   - Fingerprint = SHA-256 of model provider/API/id, active-tool names/order, all registered name/description/schema/exposure records, the replayed branch tool declarations, and codemode mode/inlineBudget settings. No raw fingerprint inputs are logged or persisted.
   - Latest observation stores fingerprint + branch IDs at observation. Read it only if fingerprint matches and those IDs are an exact prefix of the current branch; appended compaction/context-edit entries invalidate it. Reset on session start/shutdown/tree, before-switch/fork, model select, compaction start/success/failure, and each new real agent run. Branch/model/key mismatch is unavailable, not an empty set.
   - Before observation or on stale/unsupported/malformed evidence, Definition sections remain inspectable but contribute zero, with an always-visible warning that declaration estimates are incomplete. This avoids knowingly summing the callable inventory as context; it is not a claim of zero actual tool cost.
4. Surface fixed notices in both views: observed declaration scope, hidden-inventory semantics, unobserved/stale/unsupported fallback. Count each visible Definition as `ceil(serializedDeclaration.length / 4)` before combining with its existing prompt sections; allocate sections cumulatively so parent/child totals agree. For `{type:'function',name:'codemode',description:'expanded: tools.hidden(args)',parameters:{type:'object'},strict:true}`, preview the complete compact JSON and count every character, not the registered original description. Hidden `hidden` keeps its old Definition as Dropped with zero tokens; its real Guidelines still count. An unregistered observed function gets one unattributed tool row. Duplicate/invalid/mixed declarations invalidate the whole set; OpenAI namespaces retain their complete framing/description/children once as an unattributed `namespace:NAME` tool row; member direct schemas remain zero-cost inventory, not duplicated. Google uses semantic per-function declarations (group framing is not estimated). Token amounts remain chars/4 estimates; Pi-reported usage is separate. No claim of exact whole-request accounting.
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
