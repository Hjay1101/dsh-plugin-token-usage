// dsh-plugin-token-usage —— Host 半。
//
// 职责：
//   1. 扫描 ~/.dsh/sessions/**/session*.jsonl.zstd（兼容 v3 代命名），按 provider/model 聚合
//      input/output/cacheRead/cacheWrite/reasoning tokens 与命中率，
//      并产出「按天」「按会话」两个维度。
//   2. 注册模型工具 usage_report（对话中可随时调用）。
//   3. 挂载 POST /token-usage/api/report 路由，供浏览器面板调用。
//
// 只读设计：仅解压读取会话日志，不写任何文件。

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import z from "schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

const execFileAsync = promisify(execFile);

export const name = "dsh-plugin-token-usage";

/** Loader 配置模式：结果缓存窗口。 */
export const Config = z.object({
	/** 报告结果缓存时长（毫秒），窗口内重复请求直接返回缓存。 */
	ttlMs: z.number().default(15_000),
	/** 单次全量扫描超时（毫秒）。 */
	scanTimeoutMs: z.number().default(180_000),
});

export const inject = ["webServer", "tools"];

// ---------- 会话日志发现 ----------

/**
 * 递归收集 root 下所有会话日志的绝对路径。
 * 兼容两代命名：旧 `session.jsonl.zstd` 与新 `session.v3.jsonl.zstd`。
 * 同一会话目录里两者并存时只取「最高版本」那份——新版是同一会话的全量重写，
 * 两份都读会把同一段历史重复计数。
 */
async function findSessionLogs(root) {
	const byDir = new Map();
	async function walk(dir) {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const child = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(child);
				continue;
			}
			if (!/^session(\.[0-9A-Za-z_-]+)?\.jsonl\.zstd$/.test(entry.name)) continue;
			const list = byDir.get(dir);
			if (list === undefined) byDir.set(dir, [entry.name]);
			else list.push(entry.name);
		}
	}
	await walk(root);
	const found = [];
	for (const [dir, names] of byDir) {
		const versioned = names.filter((name) => name !== "session.jsonl.zstd").sort();
		const pick = versioned.length > 0 ? versioned[versioned.length - 1] : "session.jsonl.zstd";
		found.push(join(dir, pick));
	}
	return found;
}

// ---------- 事件解析（只取标量叶子字段） ----------

function newBucket(key) {
	const slash = key.indexOf("/");
	return {
		key,
		requests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		firstAt: 0,
		lastAt: 0,
		cwd: "",
	};
}

function addUsage(bucket, usage, time) {
	bucket.requests += 1;
	bucket.input += typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
	bucket.output += typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
	bucket.cacheRead += typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0;
	bucket.cacheWrite += typeof usage.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0;
	bucket.reasoning += typeof usage.reasoningTokens === "number" ? usage.reasoningTokens : 0;
	if (time > 0) {
		if (!bucket.firstAt || time < bucket.firstAt) bucket.firstAt = time;
		if (time > bucket.lastAt) bucket.lastAt = time;
	}
}

function finishBucket(bucket) {
	const promptTokens = bucket.input + bucket.cacheRead + bucket.cacheWrite;
	const out = {
		key: bucket.key,
		requests: bucket.requests,
		promptTokens,
		totalTokens: promptTokens + bucket.output,
		hitRate: promptTokens > 0 ? Math.round((bucket.cacheRead * 10000) / promptTokens) / 100 : null,
		input: bucket.input,
		output: bucket.output,
		cacheRead: bucket.cacheRead,
		cacheWrite: bucket.cacheWrite,
		reasoning: bucket.reasoning,
		firstAt: bucket.firstAt,
		lastAt: bucket.lastAt,
	};
	if (bucket.cwd !== "") out.cwd = bucket.cwd;
	return out;
}

function totalsOf(buckets) {
	const totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
	for (const b of buckets) {
		totals.requests += b.requests;
		totals.input += b.input;
		totals.output += b.output;
		totals.cacheRead += b.cacheRead;
		totals.cacheWrite += b.cacheWrite;
		totals.reasoning += b.reasoning;
	}
	const prompt = totals.input + totals.cacheRead + totals.cacheWrite;
	totals.promptTokens = prompt;
	totals.totalTokens = prompt + totals.output;
	totals.hitRate = prompt > 0 ? Math.round((totals.cacheRead * 10000) / prompt) / 100 : null;
	return totals;
}

/** 本地时区的 YYYY-MM-DD（日界跟随系统时区，而非 UTC）。 */
function localDayOf(time) {
	const d = new Date(time);
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const date = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${month}-${date}`;
}

// ---------- 全量扫描 ----------

async function scanAllLogs(timeoutMs) {
	const root = join(homedir(), ".dsh", "sessions");
	const logs = await findSessionLogs(root);
	const byModel = new Map();
	// 模型 × 日 二级聚合：支撑「模型明细跟随日/周/月」的窗口内统计。
	const byModelDay = new Map();
	const byDay = new Map();
	const bySession = new Map();
	// 会话 × 日 二级聚合：支撑「近 30 天最耗会话」的窗口内精确统计。
	const bySessionDay = new Map();
	let failed = 0;

	let index = 0;
	async function processLog(log) {
		let stdout;
		try {
			({ stdout } = await execFileAsync("zstd", ["-dc", log], {
				maxBuffer: 1 << 28,
				timeout: timeoutMs,
			}));
		} catch {
			failed += 1;
			return;
		}
		let sessionId = "";
		let cwd = "";
		let modelKey = null;
		// 把一次用量记进五个维度（模型 / 模型×日 / 日 / 会话 / 会话×日）。
		function record(mk, usage, time) {
			addUsage(byModel.get(mk) ?? byModel.set(mk, newBucket(mk)).get(mk), usage, time);
			let day = "unknown";
			if (time > 0) day = localDayOf(time);
			let mdMap = byModelDay.get(mk);
			if (mdMap === undefined) byModelDay.set(mk, (mdMap = new Map()));
			const mdb = mdMap.get(day) ?? mdMap.set(day, newBucket(day)).get(day);
			addUsage(mdb, usage, time);
			addUsage(byDay.get(day) ?? byDay.set(day, newBucket(day)).get(day), usage, time);
			const sessionKey = sessionId || log;
			const sessionBucket = bySession.get(sessionKey) ?? bySession.set(sessionKey, newBucket(sessionKey)).get(sessionKey);
			addUsage(sessionBucket, usage, time);
			if (!sessionBucket.cwd) sessionBucket.cwd = cwd;
			let dayMap = bySessionDay.get(sessionKey);
			if (dayMap === undefined) bySessionDay.set(sessionKey, (dayMap = new Map()));
			const sdBucket = dayMap.get(day) ?? dayMap.set(day, newBucket(day)).get(day);
			addUsage(sdBucket, usage, time);
		}
		for (const line of stdout.split("\n")) {
			if (!line) continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			if (event.type === "session") {
				sessionId = typeof event.id === "string" ? event.id : "";
				cwd = typeof event.cwd === "string" ? event.cwd : "";
				continue;
			}
			if (event.type === "request/header") {
				const cfg = event.data?.header?.config;
				if (cfg && typeof cfg.provider === "string" && typeof cfg.model === "string") {
					modelKey = `${cfg.provider}/${cfg.model}`;
				}
				continue;
			}
			const time = typeof event.time === "number" ? event.time : 0;
			// 新一代格式：assistant/message 顶层带 usage，并按消息来源精确归属模型
			// （会话中途换模型也不会误记到旧模型上）。
			if (event.type === "assistant/message") {
				const usage = event.data?.usage;
				if (!usage || typeof usage !== "object") continue;
				const src = event.data?.message?.source;
				const mk = src && typeof src.provider === "string" && typeof src.model === "string"
					? `${src.provider}/${src.model}`
					: modelKey;
				if (mk === null) continue;
				record(mk, usage, time);
				continue;
			}
			// 旧一代格式：assistant/chunk 内的 usage 块，沿用最近一次 request/header 的模型。
			if (event.type !== "assistant/chunk" || modelKey === null) continue;
			const chunk = event.data?.chunk;
			if (!chunk || chunk.type !== "usage" || !chunk.usage) continue;
			record(modelKey, chunk.usage, time);
		}
	}
	// 8 路并发解压解析，全量扫描从 ~4s 压到亚秒级。
	const workers = Array.from({ length: Math.min(8, logs.length) || 1 }, async () => {
		while (index < logs.length) {
			const log = logs[index];
			index += 1;
			await processLog(log);
		}
	});
	await Promise.all(workers);

	const ranked = Array.from(byModel.values(), finishBucket).sort((a, b) => b.totalTokens - a.totalTokens);
	// 零耗模型（prompt 与输出全为 0，仅存在请求记录）不进明细，也不计入请求总数。
	const models = ranked.filter((m) => m.totalTokens > 0);
	const modelsHidden = ranked.length - models.length;
	const days = Array.from(byDay.values(), finishBucket).sort((a, b) => (a.key < b.key ? -1 : 1));
	// 「最耗会话」只统计近 30 天活跃会话在窗口内的消耗（与面板图表时间观一致），
	// 终身累计榜会随历史增长而僵化。
	const windowStart = Date.now() - 30 * 86400000;
	const recentSessions = [];
	for (const [sessionKey, dayMap] of bySessionDay) {
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let reasoning = 0;
		let requests = 0;
		let firstAt = Infinity;
		let lastAt = 0;
		let lastDay = "";
		for (const [day, b] of dayMap) {
			if (day === "unknown") continue;
			const dayStart = new Date(day + "T00:00:00").getTime();
			if (dayStart < windowStart) continue;
			input += b.input;
			output += b.output;
			cacheRead += b.cacheRead;
			cacheWrite += b.cacheWrite;
			reasoning += b.reasoning ?? 0;
			requests += b.requests;
			firstAt = Math.min(firstAt, dayStart);
			lastAt = Math.max(lastAt, dayStart + 86399000);
			if (day > lastDay) lastDay = day;
		}
		if (input + output + cacheRead + cacheWrite <= 0) continue;
		recentSessions.push({ sessionKey, input, output, cacheRead, cacheWrite, reasoning, requests, firstAt, lastAt, lastDay });
	}
	recentSessions.sort((a, z) => (z.input + z.output + z.cacheRead + z.cacheWrite) - (a.input + a.output + a.cacheRead + a.cacheWrite));
	const sessionsTop = recentSessions.slice(0, 12).map((b) => {
		const finished = finishBucket({
			key: b.sessionKey,
			requests: b.requests,
			input: b.input,
			output: b.output,
			cacheRead: b.cacheRead,
			cacheWrite: b.cacheWrite,
			reasoning: b.reasoning,
			firstAt: b.firstAt === Infinity ? 0 : b.firstAt,
			lastAt: b.lastAt,
		});
		finished.lastDay = b.lastDay;
		return finished;
	});

	// 自然周期窗口（A1）：今天 / 本周（周日首，与热力网格列对齐）/ 本月。
	// 从二级聚合精确统计窗口内消耗，供面板「模型明细 / 最耗会话」跟随粒度切换。
	const nowDate = new Date();
	const todayIso = localDayOf(nowDate.getTime());
	const todayStart = new Date(todayIso + "T00:00:00").getTime();
	const weekStartDate = new Date(todayStart);
	weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay());
	const weekStart = weekStartDate.getTime();
	const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();

	function windowAgg(byKeyDay, startMs, attachCwd) {
		const rows = [];
		for (const [key, dayMap] of byKeyDay) {
			let input = 0;
			let output = 0;
			let cacheRead = 0;
			let cacheWrite = 0;
			let reasoning = 0;
			let requests = 0;
			let firstAt = Infinity;
			let lastAt = 0;
			let lastDay = "";
			for (const [day, b] of dayMap) {
				if (day === "unknown") continue;
				const dayStartTime = new Date(day + "T00:00:00").getTime();
				if (dayStartTime < startMs) continue;
				input += b.input;
				output += b.output;
				cacheRead += b.cacheRead;
				cacheWrite += b.cacheWrite;
				reasoning += b.reasoning ?? 0;
				requests += b.requests;
				firstAt = Math.min(firstAt, dayStartTime);
				lastAt = Math.max(lastAt, dayStartTime + 86399000);
				if (day > lastDay) lastDay = day;
			}
			if (input + output + cacheRead + cacheWrite <= 0) continue;
			const finished = finishBucket({
				key,
				requests,
				input,
				output,
				cacheRead,
				cacheWrite,
				reasoning,
				firstAt: firstAt === Infinity ? 0 : firstAt,
				lastAt,
			});
			if (attachCwd) {
				const life = bySession.get(key);
				if (life && life.cwd) finished.cwd = life.cwd;
				finished.lastDay = lastDay;
			}
			rows.push(finished);
		}
		rows.sort((a, z) => z.totalTokens - a.totalTokens);
		return rows;
	}

	const views = {
		day: {
			models: windowAgg(byModelDay, todayStart, false),
			sessions: windowAgg(bySessionDay, todayStart, true).slice(0, 5),
		},
		week: {
			models: windowAgg(byModelDay, weekStart, false),
			sessions: windowAgg(bySessionDay, weekStart, true).slice(0, 5),
		},
		month: {
			models: windowAgg(byModelDay, monthStart, false),
			sessions: windowAgg(bySessionDay, monthStart, true).slice(0, 5),
		},
	};

	return {
		generatedAt: Date.now(),
		source: "raw-logs",
		logsFound: logs.length,
		logsFailed: failed,
		modelsHidden,
		totals: totalsOf(models),
		models,
		days,
		sessionsTop,
		views,
	};
}

function formatReportText(report) {
	const t = report.totals;
	const fmt = (n) => n.toLocaleString("en-US");
	const lines = [];
	lines.push(
		`DSH token usage across ${report.sessions.scanned} session logs (${report.sessions.failed} failed), source=${report.source}, computed in ${report.tookMs}ms`,
	);
	if (report.modelsHidden > 0) {
		lines.push(`${report.modelsHidden} zero-usage model(s) excluded from details and request totals`);
	}
	lines.push(
		`TOTAL: ${fmt(t.requests)} requests | prompt ${fmt(t.promptTokens)} tokens (cache hit rate ${t.hitRate}%) | output ${fmt(t.output)} tokens | grand total ${fmt(t.totalTokens)}`,
	);
	lines.push("Models by total tokens:");
	report.models.forEach((m, i) => {
		lines.push(`${i + 1}. ${m.key}: ${fmt(m.requests)} req, prompt ${fmt(m.promptTokens)} (hit ${m.hitRate}%), output ${fmt(m.output)}`);
	});
	if (report.days.length > 0) {
		lines.push("Daily totals (oldest first):");
		for (const d of report.days) lines.push(`${d.key}: ${fmt(d.requests)} req, total ${fmt(d.totalTokens)} tokens (hit ${d.hitRate}%)`);
	}
	if (report.sessionsTop.length > 0) {
		lines.push("Top sessions by tokens in the last 30 days:");
		report.sessionsTop.slice(0, 8).forEach((s, i) => {
			lines.push(`${i + 1}. ${String(s.key).slice(0, 20)}${s.cwd ? ` [${s.cwd}]` : ""}: ${fmt(s.requests)} req, total ${fmt(s.totalTokens)} (hit ${s.hitRate}%, last ${s.lastDay || "?"})`);
		});
	}
	return lines.join("\n");
}

// ---------- 插件主体 ----------

/**
 * 插件入口：注册模型工具与 HTTP 路由。
 * @param ctx - 宿主插件上下文（webServer、tools、effect）。
 * @param config - Loader 校验后的配置。
 */
export function apply(ctx, config) {
	const ttlMs = config?.ttlMs ?? 15_000;
	const scanTimeoutMs = config?.scanTimeoutMs ?? 180_000;
	let cache = null;
	let inflight = null;

	const collect = async (refresh) => {
		if (refresh !== true && cache !== null && Date.now() - cache.at < ttlMs) {
			return { ...cache.report, cached: true };
		}
		// 缓存过期瞬间的并发请求共享同一次扫描，不重复解压全量日志。
		if (inflight !== null) return inflight;
		inflight = (async () => {
			const startedAt = Date.now();
			const report = await scanAllLogs(scanTimeoutMs);
			report.tookMs = Date.now() - startedAt;
			report.sessions = {
				scanned: report.logsFound - report.logsFailed,
				failed: report.logsFailed,
				found: report.logsFound,
			};
			cache = { at: Date.now(), report };
			return report;
		})();
		try {
			return await inflight;
		} finally {
			inflight = null;
		}
	};

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: "/token-usage/api",
				handler: async (req, res) => {
					const send = (code, payload) => {
						res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
						res.end(JSON.stringify(payload));
					};
					if (req.method !== "POST") {
						send(405, { ok: false, error: "POST only" });
						return;
					}
					// 同源校验：浏览器跨页伪造的请求（text/plain 简单请求）
					// 会带异源 Origin，这里直接拒绝。
					const origin = req.headers.origin;
					if (typeof origin === "string" && origin !== "") {
						try {
							if (new URL(origin).host !== req.headers.host) {
								send(403, { ok: false, error: "cross-origin forbidden" });
								return;
							}
						} catch {
							send(403, { ok: false, error: "bad origin" });
							return;
						}
					}
					const chunks = [];
					let size = 0;
					for await (const chunk of req) {
						size += chunk.length;
						if (size > 65536) {
							send(413, { ok: false, error: "payload too large" });
							return;
						}
						chunks.push(chunk);
					}
					let args = {};
					try {
						args = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					} catch {
						args = {};
					}
					try {
						send(200, await collect(args.refresh === true));
					} catch (error) {
						send(500, { ok: false, error: String(error?.message ?? error) });
					}
				},
			}),
		"dsh-plugin-token-usage: /token-usage/api routes",
	);

	const tool = defineTool({
		name: "usage_report",
		description:
			"Aggregate token usage across every DeepSeek Harness session stored on this machine (all workspaces and subagent sessions, local log data only). Returns grand totals with cache hit rate, per-model breakdowns, per-day totals and the heaviest sessions. Reads raw local logs directly, so it completes in seconds. Use whenever the user asks how many tokens were used, which models were used, daily trends, or the cache hit rate.",
		parameters: {
			refresh: {
				type: "boolean",
				description: "Rescan all session logs bypassing the result cache. Default false.",
				default: false,
			},
			top: {
				type: "integer",
				description: "How many top models to include, sorted by total tokens. Default 10, max 50.",
				default: 10,
			},
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{ type: "text", text: formatReportText(value) }],
		},
		execute: async (args) => {
			const top =
				args && typeof args.top === "number" && Number.isFinite(args.top) && args.top > 0
					? Math.min(Math.floor(args.top), 50)
					: 10;
			const report = await collect(args?.refresh === true);
			return { ...report, models: report.models.slice(0, top) };
		},
	});
	ctx.effect(() => ctx.tools.register(tool), "dsh-plugin-token-usage: usage_report tool");
}
