import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry, ToolInfo } from "@earendil-works/pi-coding-agent";
import { normalizeBuildSystemPromptOptions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import registerExtension from "../src/index.ts";
import { declarationEvidence } from "../src/declaration-evidence.ts";

function harness() {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let command: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	let screen: string[] = [];
	const entries: SessionEntry[] = [];
	const tools: ToolInfo[] = ["codemode", "hidden"].map(name => ({
		name, description: name === "codemode" ? "registered codemode" : "HIDDEN_SCHEMA_SENTINEL",
		parameters: { type: "object" } as ToolInfo["parameters"], exposure: "direct",
		sourceInfo: { source: name === "codemode" ? "builtin" : "local", path: `/${name}.ts`, scope: "temporary", origin: "top-level" },
	}));
	const settings = { codemode: { mode: "only", inlineBudget: 3000 } };
	const pi = {
		on: (event: string, handler: (event: any, ctx: any) => any) => { handlers.set(event, handler); return () => handlers.delete(event); },
		registerCommand: (_name: string, options: any) => { command = options.handler; },
		getAllTools: () => tools, getActiveTools: () => tools.map(t => t.name), getSettings: () => settings,
		getCommands: () => [], appendEntry: () => { throw new Error("unexpected persistence"); },
	} as unknown as ExtensionAPI;
	const ctx = {
		mode: "tui", cwd: "/nonexistent-synthetic-workspace", hasUI: true,
		model: { provider: "openai", api: "openai-responses", id: "synthetic" },
		getSystemPrompt: () => "Synthetic prompt", getSystemPromptOptions: () => ({ cwd: "/synthetic" }),
		getContextUsage: () => ({ tokens: 500, contextWindow: 10000, percent: 5 }),
		isProjectTrusted: () => false, waitForIdle: async () => {},
		sessionManager: { getEntries: () => entries, getBranch: () => entries, getLeafId: () => entries.at(-1)?.id ?? null },
		ui: {
			setWorkingVisible: () => {}, notify: () => {},
			custom: async (factory: any) => {
				const component = factory({ terminal: { rows: 45 }, requestRender: () => {} }, {
					fg: (_color: string, text: string) => text, bold: (text: string) => text,
					getFgAnsi: () => "", getBgAnsi: () => "",
				}, {}, () => {});
				screen = component.render(120);
			},
		},
	} as unknown as ExtensionCommandContext;
	registerExtension(pi);
	const emit = (type: string, data: object = {}) => handlers.get(type)?.({ type, ...data }, ctx);
	let id = 0;
	const append = (message: any) => { const entryId = String(++id); entries.push({ type: "message", id: entryId, parentId: entries.at(-1)?.id ?? null, timestamp: new Date().toISOString(), message }); };
	const start = () => {
		append({ role: "user", content: "Synthetic user", timestamp: id + 1 });
		emit("before_agent_start", { prompt: "Synthetic user", systemPrompt: "Synthetic prompt", systemPromptOptions: normalizeBuildSystemPromptOptions({ cwd: "/synthetic" }) });
		emit("turn_start"); emit("context", { messages: entries.filter(e => e.type === "message").map(e => (e as any).message) });
	};
	const observe = (description: string) => {
		const payload = Object.freeze({ tools: Object.freeze([{ type: "function", name: "codemode", description, parameters: { type: "object" } }]), headers: { authorization: "SECRET" }, messages: [{ content: "SECRET" }] });
		assert.equal(emit("before_provider_request", { payload }), undefined);
	};
	return { pi, ctx, entries, tools, settings, emit, start, observe, append, open: async (view: string) => { await command!(view, ctx); return screen.join("\n"); } };
}

test("passive hook observes only current turns, Initial refines once and latest follows later requests", async () => {
	const h = harness();
	h.observe("OUTSIDE_TURN");
	h.start(); h.observe("FIRST_OBSERVED");
	assert.match(await h.open("usage"), /Tool definitions observed/);
	assert.doesNotMatch(await h.open("usage"), /Custom Tools/);
	assert.match(await h.open("injections"), /hidden.*0.*Dropped/);
	const initialScreen = await h.open("injections");
	h.emit("turn_end");
	h.start(); h.observe("SECOND_OBSERVED_WITH_MUCH_LARGER_DESCRIPTION".repeat(300));
	assert.equal(await h.open("injections"), initialScreen, "later turn must not rewrite Initial declarations");
	assert.match(await h.open("usage"), /Built-in Tools/);
	h.emit("turn_end");
	h.observe("OUTSIDE_TURN_AGAIN");
	assert.match(await h.open("usage"), /Tool definitions observed/);
});

test("invalidations and malformed payloads exclude inventory and state incompleteness", async () => {
	for (const event of ["model_select", "session_tree", "session_before_compact", "session_compact", "session_compact_failed", "session_before_switch", "session_before_fork"]) {
		const h = harness(); h.start(); h.observe("observed"); h.emit(event, { signal: new AbortController().signal });
		assert.match(await h.open("usage"), /estimates are incomplete/);
		assert.doesNotMatch(await h.open("usage"), /Built-in Tools/);
	}
	const h = harness(); h.start(); h.observe("observed");
	h.emit("before_provider_request", { payload: { tools: "malformed", secret: "SECRET" } });
	assert.match(await h.open("usage"), /Malformed provider declaration list/);
	assert.doesNotMatch(await h.open("usage"), /SECRET/);
});

test("model/loadout fingerprint includes description, schema, active names and codemode budget", () => {
	const h = harness();
	const original = declarationEvidence(h.pi, h.ctx).key;
	h.settings.codemode.inlineBudget = 0;
	assert.notEqual(declarationEvidence(h.pi, h.ctx).key, original);
	h.settings.codemode.inlineBudget = 3000;
	h.tools[1]!.description = "updated";
	assert.notEqual(declarationEvidence(h.pi, h.ctx).key, original);
	assert.match(declarationEvidence(h.pi, h.ctx).key, /^[a-f0-9]{64}$/);
});

test("branch context edits invalidate, while ordinary appended messages keep the observation", async () => {
	const h = harness(); h.start(); h.observe("observed");
	h.append({ role: "assistant", content: [], timestamp: 20 });
	assert.match(await h.open("usage"), /Tool definitions observed/);
	h.entries.push({ type: "context_edit", id: "edit", parentId: h.entries.at(-1)!.id, timestamp: new Date().toISOString(), targetId: h.entries[0]!.id, replacement: null } as SessionEntry);
	assert.match(await h.open("usage"), /estimates are incomplete/);
});

test("Initial request correlation is one-shot and cannot mix a later followup", async () => {
	const h = harness(); h.start();
	h.emit("turn_end"); h.emit("turn_start"); h.observe("TOO_LATE_FOR_INITIAL");
	assert.match(await h.open("injections"), /No provider declarations observed for this Initial snapshot/);
	assert.match(await h.open("usage"), /Tool definitions observed/);
});
