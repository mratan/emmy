// H8 — dispose() lifecycle and resource leakage.
// Spawn N child sessions, each running one prompt, then dispose. Snapshot
// resource handles + memory before and after. Pass if no monotonic growth.

import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

const N = 50;

function getActiveHandleCount(): number {
	const proc: any = process;
	if (typeof proc._getActiveHandles === "function") {
		return proc._getActiveHandles().length;
	}
	return -1;
}

function memoryRss(): number {
	return process.memoryUsage().rss;
}

async function spawnAndDispose(services: any, model: any): Promise<void> {
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model,
	});
	await session.prompt("ping");
	session.dispose();
}

async function main() {
	const findings: any = { hypothesis: "H8 — dispose() leak across N spawn/dispose", checks: [] };

	const reg = registerFauxProvider({
		api: "spike-h8",
		provider: "spike-h8",
		models: [{ id: "h8-model", contextWindow: 200_000, maxTokens: 1024 }],
	});
	reg.setResponses(Array(8 * N).fill(fauxAssistantMessage("ok", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h8", "fake-key");

	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	// Warm up — first session has init costs we don't want to count.
	await spawnAndDispose(services, reg.getModel());
	if (typeof Bun !== "undefined") Bun.gc(true);

	const beforeHandles = getActiveHandleCount();
	const beforeRss = memoryRss();
	const t0 = Date.now();

	for (let i = 0; i < N; i++) {
		await spawnAndDispose(services, reg.getModel());
	}

	if (typeof Bun !== "undefined") Bun.gc(true);
	// One more cycle to let async cleanups settle.
	await new Promise((r) => setTimeout(r, 100));

	const afterHandles = getActiveHandleCount();
	const afterRss = memoryRss();
	const elapsedMs = Date.now() - t0;

	findings.N = N;
	findings.beforeHandles = beforeHandles;
	findings.afterHandles = afterHandles;
	findings.beforeRssMB = (beforeRss / 1024 / 1024).toFixed(1);
	findings.afterRssMB = (afterRss / 1024 / 1024).toFixed(1);
	findings.elapsedMsTotal = elapsedMs;
	findings.elapsedMsPerCycle = (elapsedMs / N).toFixed(1);
	findings.totalProviderCalls = reg.state.callCount;

	if (beforeHandles >= 0) {
		findings.checks.push({
			name: "active handle count stable (within +5)",
			pass: afterHandles - beforeHandles <= 5,
			delta: afterHandles - beforeHandles,
		});
	} else {
		findings.checks.push({
			name: "handle introspection not available — only memory check",
			pass: true,
			note: "Bun does not expose process._getActiveHandles",
		});
	}

	// Memory: a small linear creep is expected from session JSONL records
	// kept by the SessionManager.inMemory caches. Anything >50MB across 50
	// cycles suggests a real leak.
	const rssDeltaMB = (afterRss - beforeRss) / 1024 / 1024;
	findings.rssDeltaMB = rssDeltaMB.toFixed(1);
	findings.checks.push({
		name: "RSS delta < 50 MB across N spawn/dispose cycles",
		pass: rssDeltaMB < 50,
	});

	reg.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H8 FAILED with exception:", e);
	process.exit(2);
});
