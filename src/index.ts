/**
 * pi-context-view - inspect what occupies the model context.
 *
 * Passively captures the first real turn, or runs one on-demand silent probe
 * when a context view is opened before any real turn.
 */
import { buildSessionContext, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { branchHasContextChange, declarationEvidence, type DeclarationEvidence } from "./declaration-evidence.ts";
import {
	declarationNotice, initialDeclarationNotice, projectToolDeclarations, ToolDeclarationCapture, UNOBSERVED_DECLARATIONS,
	type DeclarationObservation,
} from "./tool-declarations.ts";

import { ConfigStore, createDefaultConfigFile } from "./config.ts";
import {
	CONTEXT_COMMAND_DESCRIPTION,
	getContextArgumentCompletions,
	parseContextCommand,
	reportCommandMessage,
	reportConfigCreation,
	reportTuiOnly,
	resolveInitialCapture,
} from "./command.ts";
import {
	buildUsageSnapshot,
	collectPromptSources,
	CompactionState,
	InitialCaptureState,
	parsePersistedIdentities,
	PROBE_IDENTITIES_CUSTOM_TYPE,
	SilentProbeState,
} from "./capture.ts";
import { readProbeToken } from "./probe-token.ts";
import { readAutoCompactReserveTokens } from "./settings.ts";
import { showInjectionsView } from "./ui/injections-view.ts";
import { showUsageView } from "./ui/usage-view.ts";
import { computeUsage, toReportedUsage } from "./usage.ts";

export default function (pi: ExtensionAPI) {
	const capture = new InitialCaptureState();
	const probe = new SilentProbeState();
	const compaction = new CompactionState();
	const configStore = new ConfigStore();
	let persistedIdentityCount = 0;
	const declarations = new ToolDeclarationCapture();
	let initialDeclarations: DeclarationObservation = UNOBSERVED_DECLARATIONS;
	let pendingInitial: (DeclarationEvidence & { turn: number }) | undefined;
	let turnSequence = 0;
	let inTurn = false;
	let capturedBranchLength = 0;

	function invalidateDeclarations(): void {
		declarations.invalidate();
		pendingInitial = undefined;
		inTurn = false;
	}
	function latestDeclarations(ctx: ExtensionContext): DeclarationObservation {
		if (branchHasContextChange(ctx, capturedBranchLength)) declarations.invalidate();
		const evidence = declarationEvidence(pi, ctx);
		return declarations.read(evidence.key, evidence.branchIds);
	}
	pi.on("session_tree", invalidateDeclarations);
	pi.on("session_before_switch", invalidateDeclarations);
	pi.on("session_before_fork", invalidateDeclarations);
	pi.on("model_select", invalidateDeclarations);

	/** Persist identities (role and timestamp only, never content) not yet written this runtime. */
	function persistProbeIdentities(): void {
		const identities = probe.syntheticMessages;
		if (identities.length <= persistedIdentityCount) return;
		pi.appendEntry(PROBE_IDENTITIES_CUSTOM_TYPE, { messages: identities });
		persistedIdentityCount = identities.length;
	}

	pi.on("session_start", (_event, ctx) => {
		invalidateDeclarations();
		initialDeclarations = UNOBSERVED_DECLARATIONS;
		compaction.finish();
		// Rehydrate probe identities from all prior runtimes so persisted probe
		// messages stay out of later model contexts and Usage after resume,
		// reload, or fork. Restored identities are already persisted.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === PROBE_IDENTITIES_CUSTOM_TYPE) {
				probe.restoreIdentities(parsePersistedIdentities(entry.data));
			}
		}
		persistedIdentityCount = probe.syntheticMessages.length;
	});

	pi.on("session_before_compact", (event) => {
		invalidateDeclarations();
		compaction.begin(event.signal);
	});

	// Pi ends every observed compaction with exactly one of these two events.
	pi.on("session_compact", () => {
		invalidateDeclarations();
		compaction.finish();
	});

	pi.on("session_compact_failed", () => {
		invalidateDeclarations();
		compaction.finish();
	});

	pi.on("input", (event) => {
		// Reset text earlier input transforms added to our own synthetic prompt:
		// the probe carries no instructions, and its run is identified by token.
		if (event.text === "" || !probe.isProbeInput(event.source, readProbeToken())) return undefined;
		return { action: "transform", text: "" } as const;
	});

	pi.on("before_agent_start", (event) => {
		invalidateDeclarations();
		probe.beginRun(readProbeToken());
		// The chained prompt here already carries additions from extensions loaded
		// earlier; anything the context event adds came from extensions after us.
		capture.prepare(event.systemPromptOptions, event.systemPrompt);
	});

	pi.on("turn_start", (_event, ctx) => {
		turnSequence += 1;
		pendingInitial = undefined;
		inTurn = !probe.isCurrentRun;
		if (probe.isCurrentRun) ctx.abort();
	});
	pi.on("turn_end", () => { inTurn = false; });

	pi.on("message_start", (event) => {
		probe.recordMessage(event.message);
	});

	pi.on("message_end", (event) => {
		const message = probe.sanitizeMessage(event.message);
		return message === undefined ? undefined : { message };
	});

	pi.on("context", (event, ctx) => {
		const messages = probe.filterMessages(event.messages);
		// Lazy: this event fires once per LLM request, but only the freezing call
		// reads these inputs, and the baseline rebuild alone is O(session).
		const firstCapture = capture.snapshot === undefined;
		capture.finalize(() => ({
			systemPrompt: ctx.getSystemPrompt(),
			messages,
			baselineMessages: probe.filterMessages(
				buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
			),
			allTools: pi.getAllTools(),
			activeToolNames: pi.getActiveTools(),
			promptSources: collectPromptSources(pi.getAllTools(), pi.getCommands()),
			origin: probe.isCurrentRun ? "synthetic-probe" : "real-turn",
		}));
		if (firstCapture && capture.snapshot !== undefined && inTurn && !probe.isCurrentRun) {
			pendingInitial = { ...declarationEvidence(pi, ctx), turn: turnSequence };
		}
		return messages === event.messages ? undefined : { messages };
	});

	pi.on("before_provider_request", (event, ctx) => {
		// Compaction/auxiliary calls and silent probes are not ordinary turn evidence.
		if (!inTurn || probe.isCurrentRun || compaction.isActive) return;
		const evidence = declarationEvidence(pi, ctx);
		const observation = declarations.observe(event.payload, ctx.model?.api, evidence.key, evidence.branchIds);
		capturedBranchLength = evidence.branchIds.length;
		const pending = pendingInitial;
		pendingInitial = undefined; // One shot, including unsupported or malformed payloads.
		if (pending?.turn === turnSequence && pending.key === evidence.key &&
			pending.branchIds.length === evidence.branchIds.length &&
			pending.branchIds.every((id, index) => evidence.branchIds[index] === id)) {
			initialDeclarations = observation;
		}
		// Notification-only observer: never return or mutate the provider payload.
	});

	pi.on("agent_settled", (_event, ctx) => {
		inTurn = false;
		pendingInitial = undefined;
		if (!probe.isCurrentRun) return;
		if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
		probe.settle(capture.snapshot !== undefined);
		persistProbeIdentities();
	});

	pi.on("session_shutdown", () => {
		invalidateDeclarations();
		compaction.finish();
		// A shutdown mid-probe can leave probe messages already persisted in the
		// session; write their identities so the next runtime keeps filtering them.
		persistProbeIdentities();
		probe.fail("Session ended before the silent probe completed.");
	});

	pi.registerCommand("context", {
		description: CONTEXT_COMMAND_DESCRIPTION,
		getArgumentCompletions: getContextArgumentCompletions,
		handler: async (args, ctx) => {
			const command = parseContextCommand(args);
			if (command.type === "invalid") {
				reportCommandMessage(ctx, command.message, "error");
				return;
			}
			// Creating the file needs no UI, so it stays available in every run mode.
			if (command.type === "config") {
				reportConfigCreation(ctx, createDefaultConfigFile());
				return;
			}
			if (ctx.mode !== "tui") {
				reportTuiOnly(ctx, command.view);
				return;
			}
			const initial = await resolveInitialCapture(pi, capture, probe, compaction, ctx);
			if (command.view === "injections") {
				await showInjectionsView(ctx, {
					snapshot: projectToolDeclarations(initial.snapshot, initialDeclarations),
					degradedReason: initial.degradedReason,
					notices: [initialDeclarationNotice(initialDeclarations, initial.snapshot.origin)],
				});
				return;
			}
			// Loaded only for the Usage view, the sole consumer of configured colors.
			const loadedConfig = configStore.load();
			// ReadonlySessionManager lacks buildSessionContext(); use pi's exported builder.
			const messages = probe.filterMessages(
				buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
			);
			const current = buildUsageSnapshot({
				messages,
				initial: initial.snapshot,
				systemPrompt: ctx.getSystemPrompt(),
				options: ctx.getSystemPromptOptions(),
				allTools: pi.getAllTools(),
				activeToolNames: pi.getActiveTools(),
				promptSources: collectPromptSources(pi.getAllTools(), pi.getCommands()),
			});
			const observed = latestDeclarations(ctx);
			await showUsageView(ctx, {
				usage: computeUsage({
					snapshot: projectToolDeclarations(current, observed),
					messages,
					reported: toReportedUsage(ctx.getContextUsage()),
					modelLabel: ctx.model?.id,
					autoCompactReserveTokens: readAutoCompactReserveTokens(ctx),
				}),
				degradedReason: initial.degradedReason,
				// Reported inside the view: a notification would stay hidden behind the fullscreen overlay.
				notices: [declarationNotice(observed), ...loadedConfig.warnings],
				categoryColors: loadedConfig.config.categoryColors,
				mapSize: loadedConfig.config.mapSize,
			});
		},
	});
}
