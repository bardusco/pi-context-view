# Native OpenAI grammar declaration fix

## Reproduction and boundary

The owner reported Usage rejecting a real GPT-6 Luna request as `Unsupported or malformed provider declaration`. Metadata-only inspection confirmed its OpenAI Responses compatibility flag `supportsOpenAIGrammarTools=true`. Pi 0.99.1 `convertResponsesTools` emits codemode as `{type:'custom',name,description,format:{type:'grammar',syntax:'lark'|'regex',definition}}`, not a JSON-schema function. The prior smoke model left this flag false, so it tested only the function fallback.

This is a correction inside the existing supported OpenAI adapters, not permission to execute grammars or change model/provider/tools. No real request payload, prompt, header, credential, or signature is read/logged/persisted. Passive observation, whole-set failure, owned compact declaration JSON, original Initial correlation and privacy limits stay unchanged.

## Narrow change

- Recognize Pi's OpenAI Responses custom grammar shape, including custom children in a namespace wrapper. Keep namespace framing and every child exactly once.
- Recognize Pi's corresponding Chat Completions shape: `{type:'custom',custom:{name,description,format:{type:'grammar',grammar:{syntax,definition}}}}`.
- Require nonempty name, absent/string description, grammar format, `lark`/`regex` syntax and nonempty grammar definition. Unknown custom formats, bad nested shapes, mixed malformed lists, duplicate function/custom names, excessive count/bytes/depth/nodes, cycles and accessors still invalidate the entire set. Never parse/evaluate the grammar or widen root-schema acceptance.
- Count the full serialized declaration, including grammar, once under its existing name; native function fallback remains unchanged. Token estimates remain heuristic provider-declaration estimates, not proof of tokenizer cost or HTTP delivery.
- Fix the Initial notice for a probe-created historical snapshot: explicitly say it has no declaration observation, and direct the user to Usage for later real-turn evidence. Do not retroactively attach the later turn to Initial or change capture lifecycle.

## Observable criteria / evidence

| Requirement / failure | Test |
| --- | --- |
| Prior parser rejects native grammar | Add failing exact Responses fixture and real CLI smoke with native grammar capability enabled before changing parser |
| Native grammar accepted and counted once | Lark + regex fixtures, compact JSON/ceil(chars/4), grammar-only codemode + hidden inventory, namespace child once |
| Unsupported/malformed remains unavailable | Empty/nonstring grammar, unknown syntax/format, invalid description/custom wrapper, mixed list and cross-kind duplicates |
| Input stays owned/passive/bounded | Frozen input, mutation after parse, secret header/message sentinels absent, oversized grammar rejected |
| Actual Pi serializer covered, not hand-built alone | Synthetic loopback CLI/PTY in both extension orders, with function fallback AND GPT-6 Luna-compatible grammar flags; assert actual declaration type/format, Usage observed notice, hidden Dropped 0, no probe/provider side effect |
| Historical Initial is distinguishable | Notice regression for probe origin; ordinary Initial and Usage warnings unchanged |

Run canonical `pnpm check` and `node scripts/smoke-codemode.mjs` after the final mutation; independent final branch-wide review precedes committing the follow-up. Keep checkout source installation and codemode-only; no upstream publication. Owner `/reload` + normal turn + Usage remains final personal-session acceptance.
