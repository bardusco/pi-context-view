/** Metadata-only freshness checks for process-local provider observations. */
import { createHash } from "node:crypto";
import { buildSessionContext, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { replaySystemMessages } from "./transcript.ts";

export interface DeclarationEvidence {
	readonly key: string;
	readonly branchIds: readonly string[];
}

/** Hash only tool/model inputs; do not retain/log settings, prompts or branch messages. */
export function declarationEvidence(pi: ExtensionAPI, ctx: ExtensionContext): DeclarationEvidence {
	const branch = ctx.sessionManager.getBranch();
	const tools = pi.getAllTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters, exposure: t.exposure }));
	const settings = pi.getSettings().codemode;
	const transcript = replaySystemMessages(buildSessionContext(branch, ctx.sessionManager.getLeafId()).messages);
	const key = createHash("sha256").update(JSON.stringify({
		model: ctx.model && { provider: ctx.model.provider, api: ctx.model.api, id: ctx.model.id },
		active: pi.getActiveTools(), tools, recordedTools: transcript?.tools,
		codemode: settings && { mode: settings.mode, inlineBudget: settings.inlineBudget },
	})).digest("hex");
	return { key, branchIds: branch.map(entry => entry.id) };
}

/** Context edits/compaction after the observed prefix invalidate declaration evidence. */
export function branchHasContextChange(ctx: ExtensionContext, capturedLength: number): boolean {
	return ctx.sessionManager.getBranch().slice(capturedLength).some(e => e.type === "compaction" || e.type === "context_edit");
}
