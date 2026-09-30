import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot, PI_SOURCE, extensionSource } from "../src/model.ts";
import { createToolItem, createAggregateItem } from "../src/measure.ts";
import {
	parseToolDeclarations, projectToolDeclarations, ToolDeclarationCapture,
} from "../src/tool-declarations.ts";
import { computeUsage } from "../src/usage.ts";

const codemode = { type: "function", name: "codemode", description: "expanded: tools.hidden(args)", parameters: { type: "object" }, strict: true };
const hidden = { type: "function", name: "hidden", description: "private inventory".repeat(1000), parameters: { type: "object" } };
const fixture = () => buildSnapshot([
	createAggregateItem("tool:builtin", "tool", PI_SOURCE, "Built-in Tools (1)", [
		createToolItem("tool:builtin:codemode", PI_SOURCE, "codemode", [{ label: "Definition", text: "original codemode" }]),
	]),
	createToolItem("tool:local:hidden", extensionSource("local"), "hidden", [
		{ label: "Guidelines", text: "\n- Real prompt guideline" },
		{ label: "Definition", text: JSON.stringify(hidden) },
	]),
], "real-turn", new Date(0));
const leaves = (snapshot: ReturnType<typeof fixture>) => snapshot.groups.flatMap(g => g.items).flatMap(i => i.children ?? [i]);

test("codemode-only counts transformed provider definition once, preserves hidden inventory and prompt lines", () => {
	const source = fixture();
	const projected = projectToolDeclarations(source, parseToolDeclarations({ tools: [codemode] }, "openai-responses"));
	const tools = leaves(projected);
	const visible = tools.find(t => t.label === "codemode")!;
	const invisible = tools.find(t => t.label === "hidden")!;
	assert.equal(visible.text, JSON.stringify(codemode));
	assert.equal(visible.tokens, Math.ceil(JSON.stringify(codemode).length / 4));
	assert.equal(invisible.text, "\n- Real prompt guideline");
	assert.equal(invisible.sections!.find(s => s.label === "Definition")!.tokens, 0);
	assert.equal(invisible.sections!.find(s => s.label === "Definition")!.dropped, true);
	assert.ok(invisible.sections!.find(s => s.label === "Definition")!.text.includes("private inventory"));
	assert.equal(source.groups.flatMap(g => g.items).find(i => i.label === "hidden")!.sections![1]!.dropped, undefined);
	assert.equal(projected.totalTokens, tools.reduce((sum, t) => sum + t.tokens, 0));
	assert.equal(computeUsage({ snapshot: projected, messages: [] }).estimatedTokens, projected.totalTokens);
	for (const tool of tools) assert.equal(tool.tokens, tool.sections!.reduce((n, s) => n + s.tokens, 0));
});

test("direct/on-mode declarations stay counted and provider-only tools are not lost", () => {
	const extra = { type: "function", name: "unknown", description: "provider-added", parameters: {} };
	const projected = projectToolDeclarations(fixture(), parseToolDeclarations({ tools: [codemode, hidden, extra] }, "openai-responses"));
	assert.equal(leaves(projected).find(t => t.label === "hidden")!.sections![1]!.dropped, undefined);
	assert.equal(leaves(projected).find(t => t.label === "unknown")!.text, JSON.stringify(extra));
	assert.equal(leaves(projected).filter(t => t.label === "codemode").length, 1);
});

test("unobserved and authoritative empty sets exclude definitions, never invent evidence", () => {
	for (const payload of [{}, { tools: [] }]) {
		const observation = parseToolDeclarations(payload, "openai-responses");
		assert.equal(observation.status, "observed");
		if (observation.status === "observed") assert.deepEqual(observation.tools, []);
	}
	for (const api of ["unknown", "openai-responses"]) {
		const observation = parseToolDeclarations({ tools: "not an array" }, api);
		assert.equal(observation.status, "unavailable");
		const projected = projectToolDeclarations(fixture(), observation);
		assert.ok(leaves(projected).every(t => t.sections!.find(s => s.label === "Definition")!.tokens === 0));
	}
});

test("adapters cover nested OpenAI, namespaces, Anthropic and Google without retaining unrelated payload", () => {
	const cases = [
		["openai-completions", { tools: [{ type: "function", function: { name: "nested", description: "d", parameters: {} } }] }, "nested"],
		["openai-responses", { tools: [{ type: "namespace", name: "functions", description: "namespace text", tools: [codemode] }] }, "namespace:functions"],
		["anthropic-messages", { tools: [{ name: "anthropic", description: "d", input_schema: {} }] }, "anthropic"],
		["google-generative-ai", { tools: [{ functionDeclarations: [{ name: "google", description: "d", parameters: {} }] }] }, "google"],
	] as const;
	for (const [api, payload, expected] of cases) {
		const observed = parseToolDeclarations({ ...payload, headers: { authorization: "SECRET_SENTINEL" }, messages: [{ content: "SECRET_SENTINEL" }] }, api);
		assert.equal(observed.status, "observed");
		if (observed.status === "observed") {
			assert.ok(observed.tools.some(t => t.name === expected));
			assert.ok(!JSON.stringify(observed).includes("SECRET_SENTINEL"));
		}
	}
});

test("malformed, duplicate, mixed, oversized and unsupported declarations fail as a complete set", () => {
	for (const tools of [[codemode, null], [codemode, codemode], [{ type: "function", name: "x" }], [{ type: "mystery", name: "x" }], [{ ...codemode, description: "x".repeat(8 * 1024 * 1024) }]]) {
		assert.equal(parseToolDeclarations({ tools }, "openai-responses").status, "unavailable");
	}
	const circular: Record<string, unknown> = { type: "object" }; circular.self = circular;
	assert.equal(parseToolDeclarations({ tools: [{ ...codemode, parameters: circular }] }, "openai-responses").status, "unavailable");
});

test("observation is owned and source payload is unchanged", () => {
	const payload = { tools: [structuredClone(codemode)] };
	const original = JSON.stringify(payload);
	const result = parseToolDeclarations(payload, "openai-responses");
	assert.equal(JSON.stringify(payload), original);
	payload.tools[0]!.description = "mutated";
	assert.ok(!JSON.stringify(result).includes("mutated"));
	Object.freeze(codemode); Object.freeze(codemode.parameters);
	assert.equal(parseToolDeclarations(Object.freeze({ tools: Object.freeze([codemode]) }), "openai-responses").status, "observed");
});

test("latest capture is branch-prefix/loadout bound and invalidation never revives stale declarations", () => {
	const capture = new ToolDeclarationCapture();
	assert.equal(capture.read("model/loadout", ["root"]).status, "unavailable");
	capture.observe({ tools: [codemode] }, "openai-responses", "model/loadout", ["root", "user"]);
	assert.equal(capture.read("model/loadout", ["root", "user", "reply"]).status, "observed");
	assert.equal(capture.read("other-model", ["root", "user"]).status, "unavailable");
	assert.equal(capture.read("model/loadout", ["root", "alternate"]).status, "unavailable");
	capture.observe({ tools: null }, "openai-responses", "model/loadout", ["root", "user"]);
	assert.equal(capture.read("model/loadout", ["root", "user"]).status, "unavailable");
	capture.observe({ tools: [codemode] }, "openai-responses", "model/loadout", ["root", "user"]);
	capture.invalidate();
	assert.equal(capture.read("model/loadout", ["root", "user"]).status, "unavailable");
});
