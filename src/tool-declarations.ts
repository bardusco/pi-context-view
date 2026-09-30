/** Passive, process-local declaration accounting. Never retains the surrounding request. */
import { createAggregateItem, createToolItem } from "./measure.ts";
import { AGGREGATE_SOURCE, buildSnapshot, type InitialSnapshot, type InjectionItem } from "./model.ts";

const MAX_DECLARATIONS = 4096;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

export interface ObservedToolDeclaration {
	readonly name: string;
	/** Complete compact declaration, including provider framing and transformed descriptions. */
	readonly text: string;
}
export type DeclarationObservation =
	| { readonly status: "observed"; readonly tools: readonly ObservedToolDeclaration[] }
	| { readonly status: "unavailable"; readonly reason: string };

export const UNOBSERVED_DECLARATIONS: DeclarationObservation = {
	status: "unavailable", reason: "No compatible provider request observed yet.",
};
const unavailable = (reason: string): DeclarationObservation => ({ status: "unavailable", reason });
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const named = (value: unknown): value is Record<string, unknown> & { name: string } =>
	record(value) && typeof value.name === "string" && value.name.length > 0;

/** Explicit adapters: unknown APIs/shapes must never masquerade as authoritative zero tools. */
export function parseToolDeclarations(payload: unknown, api: string | undefined): DeclarationObservation {
	const openai = api === "openai-responses" || api === "openai-codex-responses" || api === "azure-openai-responses";
	const completions = api === "openai-completions";
	const anthropic = api === "anthropic-messages";
	const google = api === "google-generative-ai";
	if (!openai && !completions && !anthropic && !google) return unavailable("Unsupported provider declaration format.");
	if (!record(payload)) return unavailable("Malformed provider declaration payload.");
	if (payload.tools === undefined) return { status: "observed", tools: [] };
	if (!Array.isArray(payload.tools)) return unavailable("Malformed provider declaration list.");
	// Preflight only this subtree; never traverse messages, headers, or credentials.
	if (!boundedJson(payload.tools)) return unavailable("Provider declarations exceed limits or are not JSON data.");
	const tools: ObservedToolDeclaration[] = [];
	const names = new Set<string>();
	let bytes = 0;
	let count = 0;
	const add = (name: string, value: unknown): boolean => {
		if (names.has(name) || ++count > MAX_DECLARATIONS) return false;
		names.add(name);
		const text = JSON.stringify(value);
		bytes += Buffer.byteLength(text);
		if (bytes > MAX_BYTES) return false;
		tools.push({ name, text });
		return true;
	};
	const validFunction = (value: unknown): value is Record<string, unknown> & { name: string } =>
		named(value) && (value.description === undefined || typeof value.description === "string") && record(value.parameters);
	try {
		for (const tool of payload.tools) {
			if (!record(tool)) return unavailable("Malformed provider declaration.");
			if (openai && tool.type === "namespace") {
				// Keep namespace framing and all nested declarations once as one opaque tool row.
				if (!named(tool) || !Array.isArray(tool.tools) || !tool.tools.every(t => record(t) && t.type === "function" && validFunction(t))) {
					return unavailable("Unsupported or malformed namespace declaration.");
				}
				for (const child of tool.tools) {
					if (names.has(child.name) || ++count > MAX_DECLARATIONS) return unavailable("Duplicate or excessive provider declarations.");
					names.add(child.name);
				}
				if (!add(`namespace:${tool.name}`, tool)) return unavailable("Duplicate or excessive provider declarations.");
			} else if (openai && tool.type === "function" && validFunction(tool)) {
				if (!add(tool.name, tool)) return unavailable("Duplicate or excessive provider declarations.");
			} else if (completions && tool.type === "function" && validFunction(tool.function)) {
				if (!add(tool.function.name, tool)) return unavailable("Duplicate or excessive provider declarations.");
			} else if (anthropic && named(tool) && record(tool.input_schema) && (tool.type === undefined || tool.type === "custom")) {
				if (!add(tool.name, tool)) return unavailable("Duplicate or excessive provider declarations.");
			} else if (google && Array.isArray(tool.functionDeclarations) && Object.keys(tool).every(k => k === "functionDeclarations")) {
				if (!tool.functionDeclarations.every(validFunction)) return unavailable("Malformed Google function declaration.");
				// Google group framing stays outside the semantic per-function estimate.
				for (const child of tool.functionDeclarations) {
					if (!add(child.name, child)) return unavailable("Duplicate or excessive provider declarations.");
				}
			} else return unavailable("Unsupported or malformed provider declaration.");
		}
		return { status: "observed", tools };
	} catch {
		// Never include thrown messages, which can carry payload data.
		return unavailable("Provider declaration extraction failed.");
	}
}

/** Bound depth/count/bytes before serialization; reject cycles and non-JSON objects. */
function boundedJson(value: unknown): boolean {
	let nodes = 0;
	let bytes = 0;
	const ancestors = new Set<object>();
	const visit = (current: unknown, depth: number): boolean => {
		if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
		if (typeof current === "string") { bytes += Buffer.byteLength(current); return bytes <= MAX_BYTES; }
		if (current === null || current === undefined || typeof current === "boolean") return true;
		if (typeof current === "number") return Number.isFinite(current);
		if (typeof current !== "object" || ancestors.has(current)) return false;
		if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false;
		ancestors.add(current);
		for (const [key, child] of Object.entries(current)) {
			bytes += Buffer.byteLength(key) + 4;
			if (bytes > MAX_BYTES || !visit(child, depth + 1)) return false;
		}
		ancestors.delete(current);
		return true;
	};
	try { return visit(value, 0); } catch { return false; }
}

/** Replace only Definition sections: prompt lines retain their original ownership and estimate. */
export function projectToolDeclarations(snapshot: InitialSnapshot, observation: DeclarationObservation): InitialSnapshot {
	const declarations = new Map(observation.status === "observed" ? observation.tools.map(t => [t.name, t]) : []);
	const used = new Set<string>();
	const project = (item: InjectionItem): InjectionItem => {
		if (item.kind !== "tool") return item;
		if (item.children !== undefined) {
			const children = item.children.map(project);
			return createAggregateItem(item.id, item.kind, item.source, item.label, children);
		}
		const declaration = declarations.get(item.label);
		if (declaration) used.add(declaration.name);
		const sections = (item.sections ?? []).map(section => section.label !== "Definition" ? section : declaration ? {
			label: "Definition", text: declaration.text, jsonSpan: { start: 0, end: declaration.text.length },
		} : { ...section, dropped: true });
		const projected = createToolItem(item.id, item.source, item.label, sections);
		return { ...projected, dropped: declaration === undefined && projected.tokens === 0 ? true : undefined };
	};
	const items = snapshot.groups.flatMap(g => g.items).map(project);
	for (const declaration of declarations.values()) {
		if (used.has(declaration.name)) continue;
		items.push(createToolItem(`tool:provider:${declaration.name}`, AGGREGATE_SOURCE, declaration.name, [{
			label: "Definition", text: declaration.text, jsonSpan: { start: 0, end: declaration.text.length },
		}]));
	}
	return buildSnapshot(items, snapshot.origin, snapshot.capturedAt);
}

/** Single latest request, bound to loadout and a prefix of the still-active branch. */
export class ToolDeclarationCapture {
	private latest: { observation: DeclarationObservation; key: string; branchIds: readonly string[] } | undefined;
	observe(payload: unknown, api: string | undefined, key: string, branchIds: readonly string[]): DeclarationObservation {
		const observation = parseToolDeclarations(payload, api);
		this.latest = { observation, key, branchIds: [...branchIds] };
		return observation;
	}
	read(key: string, branchIds: readonly string[]): DeclarationObservation {
		const latest = this.latest;
		if (latest === undefined) return UNOBSERVED_DECLARATIONS;
		if (latest.key !== key || latest.branchIds.some((id, i) => branchIds[i] !== id)) {
			return unavailable("Provider declaration observation is stale for this branch/model/loadout.");
		}
		return latest.observation;
	}
	invalidate(): void { this.latest = undefined; }
}

/** Fixed, non-payload notice; never describe an observation as proof of HTTP delivery. */
export function declarationNotice(observation: DeclarationObservation): string {
	return observation.status === "observed"
		? "Tool definitions observed at the provider hook (estimated tokens; later handlers may change them). Dropped schemas are inventory only, not counted."
		: `${observation.reason} Tool-definition estimates are incomplete: inventory schemas are inspectable as Dropped but excluded from totals.`;
}
