import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot, PI_SOURCE, extensionSource } from "../src/model.ts";
import { createToolItem } from "../src/measure.ts";
import { parseToolDeclarations, projectToolDeclarations, initialDeclarationNotice, declarationNotice, UNOBSERVED_DECLARATIONS } from "../src/tool-declarations.ts";

test("probe Initial notice is explicitly historical, while Usage and parse-failure notices remain precise", () => {
	const notice = initialDeclarationNotice(UNOBSERVED_DECLARATIONS, "synthetic-probe");
	assert.match(notice, /silent probe without a provider request/);
	assert.match(notice, /stays frozen; open Usage/);
	assert.match(notice, /estimates are incomplete/);
	assert.ok(!notice.includes("No compatible provider request observed yet"));
	assert.match(declarationNotice(UNOBSERVED_DECLARATIONS), /No compatible provider request observed yet/);
	assert.match(initialDeclarationNotice(UNOBSERVED_DECLARATIONS, "real-turn"), /for this Initial snapshot/);
	const failed = parseToolDeclarations({ tools: null }, "openai-responses");
	assert.equal(initialDeclarationNotice(failed, "synthetic-probe"), declarationNotice(failed));
	const observed = parseToolDeclarations({ tools: [] }, "openai-responses");
	assert.equal(initialDeclarationNotice(observed, "real-turn"), declarationNotice(observed));
});

const grammar = (syntax = "lark") => ({ type: "custom", name: "codemode", description: "expanded: tools.hidden(args)", format: { type: "grammar", syntax, definition: "start: /[a-z]+/" } });
const fn = { type: "function", name: "plain", parameters: { type: "object" } };
const snapshot = () => buildSnapshot([
	createToolItem("native", PI_SOURCE, "codemode", [{ label: "Definition", text: "original schema" }]),
	createToolItem("hidden", extensionSource("local"), "hidden", [{ label: "Definition", text: "hidden schema" }]),
], "real-turn", new Date(0));

test("native Responses custom grammar counts complete codemode once, not hidden direct inventory", () => {
	for (const syntax of ["lark", "regex"]) {
		const tool = grammar(syntax);
		for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
			const observed = parseToolDeclarations({ tools: [tool] }, api);
			assert.equal(observed.status, "observed");
			const projected = projectToolDeclarations(snapshot(), observed);
			const items = projected.groups.flatMap(g => g.items);
			assert.equal(items.find(t => t.label === "codemode")!.text, JSON.stringify(tool));
			assert.equal(items.find(t => t.label === "hidden")!.tokens, 0);
			assert.equal(projected.totalTokens, Math.ceil(JSON.stringify(tool).length / 4));
		}
	}
});

test("Pi Chat Completions nests custom grammar under custom.format.grammar", () => {
	for (const syntax of ["lark", "regex"]) {
		const tool = { type: "custom", custom: { name: "codemode", description: "expanded", format: { type: "grammar", grammar: { syntax, definition: "start: /.+/" } } } };
		const observed = parseToolDeclarations({ tools: [tool] }, "openai-completions");
		assert.equal(observed.status, "observed");
		if (observed.status === "observed") assert.deepEqual(observed.tools, [{ name: "codemode", text: JSON.stringify(tool) }]);
		assert.equal(parseToolDeclarations({ tools: [grammar()] }, "openai-completions").status, "unavailable");
		assert.equal(parseToolDeclarations({ tools: [tool] }, "openai-responses").status, "unavailable");
	}
});

test("mixed function/grammar namespace keeps wrapper once, with global child-name dedupe", () => {
	const wrapper = { type: "namespace", name: "functions", tools: [fn, grammar()] };
	const observed = parseToolDeclarations({ tools: [wrapper] }, "openai-responses");
	assert.equal(observed.status, "observed");
	if (observed.status === "observed") assert.deepEqual(observed.tools, [{ name: "namespace:functions", text: JSON.stringify(wrapper) }]);
	assert.equal(projectToolDeclarations(snapshot(), observed).totalTokens, Math.ceil(JSON.stringify(wrapper).length / 4));
	for (const tools of [[wrapper, grammar()], [grammar(), wrapper], [grammar(), { ...fn, name: "codemode" }], [{ ...fn, name: "codemode" }, grammar()]]) {
		assert.equal(parseToolDeclarations({ tools }, "openai-responses").status, "unavailable");
	}
});

test("custom grammar unknown/malformed formats invalidate the whole set", () => {
	for (const tool of [
		{ ...grammar(), name: "" }, { ...grammar(), description: 3 },
		{ ...grammar(), format: null }, { ...grammar(), format: { type: "text" } },
		{ ...grammar(), format: { type: "grammar", syntax: "javascript", definition: "start" } },
		{ ...grammar(), format: { type: "grammar", syntax: "lark", definition: " " } },
		{ ...grammar(), format: { type: "grammar", syntax: "regex", definition: 1 } },
	]) assert.equal(parseToolDeclarations({ tools: [fn, tool] }, "openai-responses").status, "unavailable");
	const wrongNested = { type: "custom", custom: { name: "x", format: grammar().format } };
	assert.equal(parseToolDeclarations({ tools: [wrongNested] }, "openai-completions").status, "unavailable");
});

test("grammar data stays opaque, owned and bounded; no payload secrets or execution", () => {
	const tool = grammar();
	tool.format.definition = "globalThis.__grammarMustNotExecute = true";
	const before = JSON.stringify(tool);
	const observed = parseToolDeclarations({ tools: [tool], messages: "SECRET_SENTINEL", headers: "SECRET_SENTINEL" }, "openai-responses");
	assert.equal(observed.status, "observed");
	assert.equal(JSON.stringify(tool), before);
	tool.format.definition = "mutated";
	assert.ok(!JSON.stringify(observed).includes("mutated"));
	assert.ok(!JSON.stringify(observed).includes("SECRET_SENTINEL"));
	assert.ok(!("__grammarMustNotExecute" in globalThis));
	Object.freeze(tool.format); Object.freeze(tool);
	assert.equal(parseToolDeclarations(Object.freeze({ tools: Object.freeze([tool]) }), "openai-responses").status, "observed");
	const huge = { ...grammar(), format: { ...grammar().format, definition: "x".repeat(8 * 1024 * 1024) } };
	assert.equal(parseToolDeclarations({ tools: [huge] }, "openai-responses").status, "unavailable");
});
