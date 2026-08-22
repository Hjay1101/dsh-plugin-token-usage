// dsh-plugin-token-usage —— 客户端半（浏览器 bundle）。
//
// lazy-CJS 格式交给客户端模块加载器。做三件事：
//   1. 侧边栏底部动作区注册「Token 用量」图标按钮（设置旁）
//   2. 点击后弹出页面居中的模态仪表盘（Esc / 点外部 / 按钮关闭）
//   3. 运行卡片槽位（tool.view.cordis/self）挂同款面板
//
// 数据来自宿主半的 POST /token-usage/api/report；30 秒自动刷新。

window.__ModuleLoader__.load({
	id: "dsh-plugin-token-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		// 官方 Tooltip 基元（与 opencode 额度插件同款）。解析失败时回退原生 title，
		// 不让单个 require 异常拖垮整个客户端半区。
		let Tooltip = null;
		try {
			Tooltip = require("@deepseek-ai/dsh-client-ui-primitives").Tooltip;
		} catch (e) { Tooltip = null; }

		const CSS =
			// ── Token 层：换肤只改这一段映射 ──
			".tkusg-root,.tkusg-modal{"
			+ "--tkusg-fg:var(--dsw-alias-label-primary);"
			+ "--tkusg-fg2:var(--dsw-alias-label-secondary);"
			+ "--tkusg-fg3:var(--dsw-alias-label-tertiary);"
			+ "--tkusg-muted:var(--dsw-alias-label-caption);"
			+ "--tkusg-dim:var(--dsw-alias-label-dimmed);"
			+ "--tkusg-accent:var(--dsw-alias-state-business-primary);"
			+ "--tkusg-ok:var(--dsw-alias-state-success-primary);"
			+ "--tkusg-err:var(--dsw-alias-state-error-primary);"
			+ "--tkusg-line:var(--dsw-alias-border-l1);"
			+ "--tkusg-line2:var(--dsw-alias-border-l2);"
			+ "--tkusg-hover:var(--dsw-alias-interactive-bg-hover);"
			+ "--tkusg-active:var(--dsw-alias-button-ghost-active-fill);"
			+ "--tkusg-surface:var(--dsw-specific-menu);"
			+ "--tkusg-surface-line:var(--dsw-alias-border-inverted);"
			+ "--tkusg-shadow:var(--dsw-shadow-lv3);"
			+ "--tkusg-font:var(--dsw-font-family,inherit);"
			+ "--tkusg-r-lg:14px;--tkusg-r-md:10px;--tkusg-r-sm:6px;--tkusg-r-pill:999px;"
			+ "--tkusg-bar-w:104px}"
			// ── 面板根 ──
			+ ".tkusg-root{min-width:0;padding:4px 0 2px;color:var(--tkusg-fg);font-size:12px;line-height:18px;font-family:var(--tkusg-font)}"
			+ ".tkusg-title{font-weight:600;font-size:15px;letter-spacing:-0.01em}"
			+ ".tkusg-subttl{color:var(--tkusg-muted);font-size:11px;margin-top:1px}"
			+ ".tkusg-chip{flex:none;width:34px;height:34px;border-radius:var(--tkusg-r-md);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--tkusg-accent) 14%,transparent);color:var(--tkusg-accent)}"
			+ ".tkusg-btn{font:inherit;font-size:11px;color:var(--tkusg-fg2);background:none;border:1px solid var(--tkusg-line2);border-radius:var(--tkusg-r-pill);padding:2px 11px;cursor:pointer}"
			+ ".tkusg-btn:hover:not(:disabled){background:var(--tkusg-hover);color:var(--tkusg-fg)}"
			+ ".tkusg-btn:disabled{opacity:.45;cursor:default}"
			+ ".tkusg-xbtn{width:26px;height:26px;border-radius:50%;border:none;background:none;color:var(--tkusg-fg3);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}"
			+ ".tkusg-xbtn:hover{background:var(--tkusg-hover);color:var(--tkusg-fg)}"
			+ ".tkusg-note{margin-left:auto;color:var(--tkusg-muted);font-size:11px;white-space:nowrap}"
			// ── 头部 ──
			+ ".tkusg-head{display:flex;align-items:center;gap:10px;padding-bottom:12px}"
			+ ".tkusg-headmain{min-width:0;flex:1}"
			// ── 指标带（首格 hero）──
			+ ".tkusg-stats{display:flex;align-items:stretch;border-top:1px solid var(--tkusg-line);border-bottom:1px solid var(--tkusg-line);padding:10px 0;margin:2px 0 10px}"
			+ ".tkusg-stat{padding:0 16px;border-left:1px solid var(--tkusg-line);min-width:0}"
			+ ".tkusg-stat:first-child{padding-left:2px;border-left:none}"
			+ ".tkusg-stat span{display:block;color:var(--tkusg-muted);font-size:10.5px;letter-spacing:.02em;margin-bottom:2px;white-space:nowrap}"
			+ ".tkusg-stat b{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}"
			+ ".tkusg-stat.hero b{font-size:22px;font-weight:650;letter-spacing:-0.02em;color:var(--tkusg-fg)}"
			+ ".tkusg-stat.hero span{color:var(--tkusg-accent)}"
			// ── 分区标题 ──
			+ ".tkusg-sect{display:flex;align-items:baseline;gap:8px;margin:12px 0 6px;color:var(--tkusg-fg2);font-size:11px;font-weight:600;letter-spacing:.02em}"
			+ ".tkusg-sect i{font-style:normal;font-weight:400;color:var(--tkusg-muted)}"
			// ── 柱状图 ──
			+ ".tkusg-seg{margin-left:auto;display:flex;gap:2px}"
			+ ".tkusg-segb{font:inherit;font-size:10.5px;line-height:1;padding:3px 10px;border-radius:999px;border:none;background:none;color:var(--tkusg-muted);cursor:pointer;transition:background .12s,color .12s}"
			+ ".tkusg-segb:hover{color:var(--tkusg-fg)}"
			+ ".tkusg-segb.on{background:color-mix(in srgb,var(--tkusg-accent) 15%,transparent);color:var(--tkusg-accent);font-weight:600}"
			+ ".tkusg-heatrow{display:flex;align-items:flex-start;gap:5px}"
			+ ".tkusg-wdlbls{display:flex;flex-direction:column;gap:4px;padding-top:16px}"
			+ ".tkusg-wdlbls span{height:17px;line-height:17px;font-size:9px;color:var(--tkusg-dim);width:12px;text-align:right;display:block}"
			+ ".tkusg-grid{display:flex;gap:4px;overflow-x:auto;padding-bottom:2px}"
			+ ".tkusg-grid.flat{align-items:center;padding-top:1px}"
			+ ".tkusg-col{display:flex;flex-direction:column;gap:4px}"
			+ ".tkusg-mlbl{height:12px;font-size:9px;line-height:12px;color:var(--tkusg-dim);text-align:left;white-space:nowrap;width:24px}"
			+ ".tkusg-cell{width:17px;height:17px;border-radius:4px;background:var(--tkusg-line);flex:none}"
			+ ".tkusg-cell.wide{width:46px;height:30px;border-radius:5px}"
			+ ".tkusg-cell.sm{width:9px;height:9px;border-radius:2px;display:inline-block}"
			+ ".tkusg-cell.l0{background:color-mix(in srgb,var(--tkusg-fg) 7%,transparent)}"
			+ ".tkusg-cell.l1{background:color-mix(in srgb,var(--tkusg-accent) 25%,transparent)}"
			+ ".tkusg-cell.l2{background:color-mix(in srgb,var(--tkusg-accent) 45%,transparent)}"
			+ ".tkusg-cell.l3{background:color-mix(in srgb,var(--tkusg-accent) 70%,transparent)}"
			+ ".tkusg-cell.l4{background:linear-gradient(180deg,var(--tkusg-accent),color-mix(in srgb,var(--tkusg-accent) 72%,transparent))}"
			+ ".tkusg-cell:hover{filter:brightness(1.15)}"
			+ ".tkusg-cell.today{box-shadow:inset 0 0 0 1.5px var(--tkusg-fg2)}"
			+ ".tkusg-legend{display:flex;align-items:center;justify-content:flex-end;gap:3px;font-size:9.5px;color:var(--tkusg-dim);margin-top:4px}"
			// ── 表格 ──
			+ ".tkusg-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}"
			+ ".tkusg-table th{text-align:right;font-weight:500;color:var(--tkusg-muted);font-size:10.5px;letter-spacing:.03em;padding:4px 8px;border-bottom:1px solid var(--tkusg-line2);white-space:nowrap}"
			+ ".tkusg-table td{text-align:right;padding:4px 8px;border-bottom:1px solid var(--tkusg-line);white-space:nowrap;color:var(--tkusg-fg)}"
			+ ".tkusg-table tbody tr:hover td{background:var(--tkusg-hover)}"
			+ ".tkusg-table th:first-child,.tkusg-table td:first-child{text-align:left;max-width:250px;overflow:hidden;text-overflow:ellipsis;padding-left:2px}"
			+ ".tkusg-table td.num{color:var(--tkusg-fg2)}"
			+ ".tkusg-hitcell{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end}"
			+ ".tkusg-meter{width:46px;height:3px;border-radius:2px;background:var(--tkusg-line2);overflow:hidden;flex:none}"
			+ ".tkusg-meter i{display:block;height:100%;border-radius:2px;background:var(--tkusg-ok)}"
			+ ".tkusg-total td{font-weight:600;border-top:1px solid var(--tkusg-line2);border-bottom:none;background:color-mix(in srgb,var(--tkusg-active) 45%,transparent)}"
			+ ".tkusg-total td:first-child{border-radius:var(--tkusg-r-sm) 0 0 var(--tkusg-r-sm)}"
			+ ".tkusg-total td:last-child{border-radius:0 var(--tkusg-r-sm) var(--tkusg-r-sm) 0}"
			// ── 错误/空态/脚注 ──
			+ ".tkusg-err{color:var(--tkusg-err)}"
			+ ".tkusg-dim{color:var(--tkusg-muted);font-size:11px}"
			+ ".tkusg-footrow{display:flex;gap:6px;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--tkusg-line);color:var(--tkusg-dim);font-size:10.5px}"
			+ ".tkusg-footrow i{font-style:normal;color:var(--tkusg-line2)}"
			// ── 侧边栏图标（锚定层）──
			+ ".tkusg-entry{align-items:center;background:none;border:none;border-radius:50%;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;height:28px;width:28px;justify-content:center;padding:0;font-family:inherit}"
			+ ".tkusg-entry:hover,.tkusg-entry[data-active]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
			+ ".tkusg-entry-fixed{position:fixed;z-index:60}"
			// ── 弹窗壳 ──
			+ ".tkusg-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:49;background:rgba(0,0,0,.32);backdrop-filter:blur(2px)}"
			+ ".tkusg-modal{position:fixed;inset:0;margin:auto;height:fit-content;width:680px;max-width:calc(100vw - 48px);max-height:min(82vh,760px);overflow-y:auto;background:var(--tkusg-surface);border:1px solid var(--tkusg-surface-line);border-radius:var(--tkusg-r-lg);box-shadow:var(--tkusg-shadow);padding:18px 20px 14px;z-index:50;font-family:var(--tkusg-font);color:var(--tkusg-fg)}"
			// 热力格气泡与小方块「左缘对齐」：抵消官方 translateX(-50%) 居中，
			// 再用负 margin 补半格宽（17px 格 → 气泡左缘 = 方块左缘）。
			// 显式覆盖 top/bottom 两态的 transform，不依赖官方样式的具体数值；
			// 垂直间距由组件的 top=触发格.top-8 保证，不受影响。边界翻转算法
			// 量的是最终渲染矩形，clamp 仍然生效。
			+ ".tkusg-modal .tkusg-grid:not(.flat) [role=\"tooltip\"]{margin-left:-8.5px}"
			+ ".tkusg-modal .tkusg-grid.flat [role=\"tooltip\"]{margin-left:-23px}"
			+ ".tkusg-modal [role=\"tooltip\"][data-side=\"top\"]{transform:translateY(-100%) !important}"
			+ ".tkusg-modal [role=\"tooltip\"][data-side=\"bottom\"]{transform:none !important}"
			+ ".tkusg-modalhead{display:flex;align-items:center;gap:10px;padding-bottom:12px}";
		// 注意：头部结构在组件里（chip + 标题块 + 按钮），这里只保留底部分隔。

		let styleDisposer = null;
		function ensureCss() {
			if (styleDisposer !== null || typeof document === "undefined") return;
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", "dsh-plugin-token-usage");
			tag.textContent = CSS;
			document.head.appendChild(tag);
			styleDisposer = () => tag.remove();
		}

		function fmtCompact(n) {
			if (typeof n !== "number" || !isFinite(n)) return "-";
			const abs = Math.abs(n);
			if (abs >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (abs >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(n);
		}

		function fmtPct(v) {
			if (v === null || v === undefined) return "-";
			return v + "%";
		}

		function pad2(n) {
			return String(n).padStart(2, "0");
		}

		function isoOf(d) {
			return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
		}

		// 图标悬停文案专用：<1亿 用万（整数），≥1亿 用亿（2 位小数），<1万 直接显示原数。
		function fmtTodayTokens(v) {
			if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
			if (v >= 1e4) return Math.round(v / 1e4) + "万";
			return String(Math.round(v));
		}

		// 周聚合以周日为首日（与网格列对齐一致）。
		function sundayOf(d) {
			const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
			s.setDate(s.getDate() - s.getDay());
			return s;
		}

		function shortDay(iso) {
			const p = iso.split("-");
			return p[1] + "/" + p[2];
		}

		// 把逐日桶聚合成 日/周/月 三种粒度的格子序列。
		function buildCells(daysAll, gran, todayIso) {
			const byKey = new Map();
			for (const d of daysAll) {
				if (!d.key || d.key === "unknown") continue;
				const date = new Date(d.key + "T00:00:00");
				let key = d.key, label = shortDay(d.key), rangeEnd = date;
				if (gran === "week") {
					const s = sundayOf(date);
					key = isoOf(s);
					rangeEnd = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
					label = isoOf(s).slice(5) + "~" + isoOf(rangeEnd).slice(5);
				} else if (gran === "month") {
					key = d.key.slice(0, 7);
					rangeEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
					label = d.key.slice(0, 4) + "/" + Number(d.key.slice(5, 7));
				}
				let cell = byKey.get(key);
				if (cell === undefined) {
					cell = { key: key, label: label, tokens: 0, requests: 0, prompt: 0, cacheRead: 0, start: date, end: rangeEnd };
					byKey.set(key, cell);
				}
				cell.tokens += d.totalTokens;
				cell.requests += d.requests;
				cell.prompt += d.promptTokens;
				cell.cacheRead += d.cacheRead;
				if (date < cell.start) cell.start = date;
				if (rangeEnd > cell.end) cell.end = rangeEnd;
			}
			const cells = Array.from(byKey.values()).sort((a, z) => a.start - z.start);
			for (const c of cells) {
				c.hit = c.prompt > 0 ? Math.round((c.cacheRead * 10000) / c.prompt) / 100 : null;
				c.today = todayIso >= c.key && (gran === "day" ? c.key === todayIso : todayIso <= isoOf(c.end));
			}
			return cells;
		}

		// 连续日期序列（补零耗空格），day 粒度专用。
		function dayContinuum(daysAll, lastN, todayIso) {
			const used = new Map();
			for (const d of daysAll) {
				if (d.key && d.key !== "unknown") used.set(d.key, d);
			}
			const out = [];
			const today = new Date(todayIso + "T00:00:00");
			for (let i = lastN - 1; i >= 0; i--) {
				const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
				const key = isoOf(dt);
				const src = used.get(key);
				out.push({
					key: key,
					tokens: src ? src.totalTokens : 0,
					requests: src ? src.requests : 0,
					prompt: src ? src.promptTokens : 0,
					cacheRead: src ? src.cacheRead : 0,
				});
			}
			return out;
		}

		function dayOf(t) {
			if (!t || t <= 0) return "";
			try {
				return new Date(t).toISOString().slice(0, 10);
			} catch {
				return "";
			}
		}

		const ICON_BARS = React.createElement(
			"svg",
			{ width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", "aria-hidden": true },
			React.createElement("path", { d: "M3.5 13V9.5" }),
			React.createElement("path", { d: "M8 13V3.5" }),
			React.createElement("path", { d: "M12.5 13V6.5" }),
		);

		const ICON_X = React.createElement(
			"svg",
			{ width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", "aria-hidden": true },
			React.createElement("path", { d: "M4 4l8 8" }),
			React.createElement("path", { d: "M12 4l-8 8" }),
		);

		function HitCell(props) {
			const v = props.value;
			if (v === null || v === undefined) return React.createElement("span", null, "-");
			return React.createElement("span", { className: "tkusg-hitcell" },
				React.createElement("span", { className: "tkusg-meter" },
					React.createElement("i", { style: { width: Math.max(2, Math.min(100, v)) + "%" } })),
				v + "%");
		}

		async function fetchReport(refresh) {
			const res = await fetch("/token-usage/api/report", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ refresh: refresh === true }),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok || !data || !data.totals) {
				throw new Error(data && data.error ? String(data.error) : `HTTP ${res.status}`);
			}
			return data;
		}

		function UsagePanel(props) {
			const statePair = React.useState({ data: null, error: null, loading: true });
			const state = statePair[0];
			const setState = statePair[1];
			const granPair = React.useState("day");
			const gran = granPair[0];
			const setGran = granPair[1];
			const load = React.useCallback(function (refresh) {
				setState(function (prev) { return { data: prev.data, error: null, loading: true } });
				fetchReport(refresh === true).then(function (data) {
					setState({ data: data, error: null, loading: false });
				}, function (err) {
					const msg = err && err.message ? String(err.message) : String(err);
					setState(function (prev) { return { data: prev.data, error: msg, loading: false } });
				});
			}, []);
			React.useEffect(function () { load(false) }, [load]);
			React.useEffect(function () {
				const timer = setInterval(function () { load(false) }, 30000);
				return function () { clearInterval(timer) };
			}, [load]);

			const kids = [];
			if (!props || props.hideHead !== true) {
				kids.push(React.createElement("div", { className: "tkusg-head", key: "head" },
					React.createElement("span", { className: "tkusg-chip" }, ICON_BARS),
					React.createElement("div", { className: "tkusg-headmain" },
						React.createElement("div", { className: "tkusg-title" }, "Token 用量总览"),
						React.createElement("div", { className: "tkusg-subttl" }, "直读本地会话日志 · 每 30 秒自动刷新")),
					React.createElement("button", {
						type: "button", className: "tkusg-btn", disabled: !!state.loading,
						onClick: function () { load(true) }
					}, state.loading ? "统计中…" : "刷新")
				));
			}

			const d = state.data;
			if (state.error) {
				kids.push(React.createElement("div", { className: "tkusg-err", key: "err" }, "统计失败：" + state.error));
			} else if (!d) {
				kids.push(React.createElement("div", { className: "tkusg-dim", key: "ld" },
					state.loading ? "正在扫描会话日志…" : "暂无数据"));
			} else {
				const t = d.totals;
				const models = d.models || [];
				const daysAll = d.days || [];
				const todayIso = isoOf(new Date());
				const cells = gran === "day"
					? dayContinuum(daysAll, 30, todayIso).map(function (c) {
						return Object.assign(c, { key: c.key, label: shortDay(c.key) });
					})
					: buildCells(daysAll, gran, todayIso);
				let maxTokens = 1;
				for (let i = 0; i < cells.length; i++) if (cells[i].tokens > maxTokens) maxTokens = cells[i].tokens;
				function levelOf(v) {
					if (v <= 0) return 0;
					return Math.min(4, Math.max(1, Math.ceil((v / maxTokens) * 4)));
				}
				function cellTitle(c) {
					if (gran === "day") {
						return c.key.slice(5) + " · " + fmtCompact(c.tokens) + " token · 请求 " + c.requests + (c.prompt > 0 ? " · 缓存命中 " + fmtPct(Math.round((c.cacheRead * 10000 / c.prompt)) / 100) : "");
					}
					return c.label + " · 合计 " + fmtCompact(c.tokens) + " token · 请求 " + c.requests + (c.hit !== null && c.hit !== undefined ? " · 缓存命中 " + fmtPct(c.hit) : "");
				}
				const WD = ["日", "一", "二", "三", "四", "五", "六"];
				const gridKids = [];
				if (gran === "day") {
					const start = new Date(cells[0].key + "T00:00:00");
					const lead = start.getDay();
					const padded = [];
					for (let i = 0; i < lead; i++) padded.push(null);
					for (const c of cells) padded.push(c);
					while (padded.length % 7 !== 0) padded.push(null);
					const cols = [];
					for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
					let prevMonth = -1;
					for (let ci = 0; ci < cols.length; ci++) {
						const col = cols[ci];
						let firstReal = null;
						for (const c of col) { if (c) { firstReal = new Date(c.key + "T00:00:00"); break; } }
						const mlbl = firstReal && firstReal.getMonth() !== prevMonth ? (firstReal.getMonth() + 1) + "月" : "";
						prevMonth = firstReal ? firstReal.getMonth() : prevMonth;
						const cellEls = [React.createElement("span", { className: "tkusg-mlbl", key: "m" }, mlbl)];
						for (let ri = 0; ri < 7; ri++) {
							const c = col[ri];
							if (!c) { cellEls.push(React.createElement("span", { className: "tkusg-cell", key: "p" + ri, style: { background: "transparent" } })); continue; }
							const lv = levelOf(c.tokens);
							const tip = cellTitle(c);
							const cellEl = React.createElement("div", {
								className: "tkusg-cell l" + lv + (c.key === todayIso ? " today" : ""),
								title: Tooltip ? undefined : tip
							});
							cellEls.push(Tooltip
								? React.createElement(Tooltip, { label: tip, side: "top", delayMs: 0, key: c.key }, cellEl)
								: React.cloneElement(cellEl, { key: c.key }));
						}
						gridKids.push(React.createElement("div", { className: "tkusg-col", key: "col" + ci }, cellEls));
					}
				} else {
					for (const c of cells) {
						const lv = levelOf(c.tokens);
						const tip = cellTitle(c);
						const cellEl = React.createElement("div", {
							className: "tkusg-cell wide l" + lv + (c.today ? " today" : ""),
							title: Tooltip ? undefined : tip
						});
						gridKids.push(Tooltip
							? React.createElement(Tooltip, { label: tip, side: "top", delayMs: 0, key: c.key }, cellEl)
							: React.cloneElement(cellEl, { key: c.key }));
					}
				}
				kids.push(React.createElement("div", { className: "tkusg-stats", key: "stats" },
					React.createElement("div", { className: "tkusg-stat hero" }, React.createElement("span", null, "总用量"), React.createElement("b", { title: String(t.totalTokens) }, fmtCompact(t.totalTokens))),
					React.createElement("div", { className: "tkusg-stat" }, React.createElement("span", null, "模型请求"), React.createElement("b", null, fmtCompact(t.requests))),
					React.createElement("div", { className: "tkusg-stat" }, React.createElement("span", null, "输入"), React.createElement("b", { title: String(t.promptTokens) }, fmtCompact(t.promptTokens))),
					React.createElement("div", { className: "tkusg-stat" }, React.createElement("span", null, "输出"), React.createElement("b", { title: String(t.output) }, fmtCompact(t.output))),
					React.createElement("div", { className: "tkusg-stat" }, React.createElement("span", null, "缓存命中率"), React.createElement("b", null, fmtPct(t.hitRate)))
				));
				const segLabels = [["day", "日"], ["week", "周"], ["month", "月"]];
				kids.push(React.createElement("div", { className: "tkusg-sect", key: "chartTitle" },
					"用量热力",
					React.createElement("span", { className: "tkusg-seg" },
						segLabels.map(function (p) {
							return React.createElement("button", {
								key: p[0], type: "button",
								className: "tkusg-segb" + (gran === p[0] ? " on" : ""),
								onClick: function () { setGran(p[0]) }
							}, p[1]);
						}))));
				kids.push(React.createElement("div", { className: "tkusg-heatrow", key: "chart" },
					gran === "day" ? React.createElement("div", { className: "tkusg-wdlbls" },
						WD.map(function (w, idx) {
							return React.createElement("span", { key: w, style: { visibility: idx === 0 || idx === 3 || idx === 6 ? "visible" : "hidden" } }, w);
						})) : null,
					React.createElement("div", { className: "tkusg-grid" + (gran === "day" ? "" : " flat") }, gridKids)));
				kids.push(React.createElement("div", { className: "tkusg-legend", key: "legend" },
					"少",
					[0, 1, 2, 3, 4].map(function (lv) {
						return React.createElement("span", { key: lv, className: "tkusg-cell sm l" + lv });
					}),
					"多"));
				const scopeLabels = { day: "今日", week: "本周", month: "本月" };
				const view = (d.views && d.views[gran]) || { models: [], sessions: [] };
				const winModels = view.models || [];
				kids.push(React.createElement("div", { className: "tkusg-sect", key: "modelTitle" },
					"模型明细 · " + scopeLabels[gran] + "（" + winModels.length + " 个，按总量排序）"));
				const mHead = React.createElement("tr", { key: "mh" },
					React.createElement("th", null, "模型"),
					React.createElement("th", null, "请求数"),
					React.createElement("th", null, "输入"),
					React.createElement("th", null, "输出"),
					React.createElement("th", null, "命中率"));
				const mBody = [];
				let wReq = 0;
				let wPrompt = 0;
				let wOut = 0;
				let wCache = 0;
				for (let i = 0; i < winModels.length; i++) {
					const m = winModels[i];
					wReq += m.requests;
					wPrompt += m.promptTokens;
					wOut += m.output;
					wCache += m.cacheRead;
					mBody.push(React.createElement("tr", { key: m.key },
						React.createElement("td", { title: m.key }, m.key),
						React.createElement("td", { className: "num" }, String(m.requests)),
						React.createElement("td", { className: "num", title: String(m.promptTokens) }, fmtCompact(m.promptTokens)),
						React.createElement("td", { className: "num", title: String(m.output) }, fmtCompact(m.output)),
						React.createElement("td", null, React.createElement(HitCell, { value: m.hitRate }))));
				}
				if (winModels.length === 0) {
					mBody.push(React.createElement("tr", { key: "__empty__" },
						React.createElement("td", { colSpan: 5, className: "tkusg-dim" }, "该时段暂无模型消耗")));
				}
				const wHit = wPrompt > 0 ? Math.round(wCache * 10000 / wPrompt) / 100 : null;
				mBody.push(React.createElement("tr", { key: "__total__", className: "tkusg-total" },
					React.createElement("td", null, "总计"),
					React.createElement("td", null, String(wReq)),
					React.createElement("td", { title: String(wPrompt) }, fmtCompact(wPrompt)),
					React.createElement("td", { title: String(wOut) }, fmtCompact(wOut)),
					React.createElement("td", null, wHit === null ? "-" : fmtPct(wHit))));
				kids.push(React.createElement("table", { className: "tkusg-table", key: "mtbl" },
					React.createElement("thead", null, mHead), React.createElement("tbody", null, mBody)));
				let firstDay = "";
				let lastDay = "";
				for (let i = 0; i < models.length; i++) {
					const f = dayOf(models[i].firstAt);
					const l = dayOf(models[i].lastAt);
					if (f && (firstDay === "" || f < firstDay)) firstDay = f;
					if (l && l > lastDay) lastDay = l;
				}
				const sep = function () { return React.createElement("i", null, "·") };
				const footKids = [
					React.createElement("span", { key: "scan" },
						"扫描 " + d.sessions.scanned + " 个日志" + (d.sessions.failed > 0 ? "（" + d.sessions.failed + " 失败）" : "")),
				];
				if (firstDay) footKids.push(sep(), React.createElement("span", { key: "range" }, firstDay + " ~ " + lastDay));
				if (d.tookMs) footKids.push(sep(), React.createElement("span", { key: "took" }, (d.tookMs / 1000).toFixed(1) + "s"));
				if (d.cached) footKids.push(sep(), React.createElement("span", { key: "cache" }, "缓存结果"));
				if (d.modelsHidden > 0) footKids.push(sep(), React.createElement("span", { key: "hid" }, "另有 " + d.modelsHidden + " 个零耗模型未计入"));
				footKids.push(sep(), React.createElement("span", { key: "src" }, d.source === "raw-logs" ? "直读原始日志" : "会话服务"));
				if (props && props.hideHead === true) footKids.push(sep(), React.createElement("span", { key: "esc" }, "Esc 或点击外部关闭"));
				kids.push(React.createElement("div", { className: "tkusg-footrow", key: "foot" }, footKids));
			}
			return React.createElement("div", { className: "tkusg-root" }, kids);
		}

		// 弹窗本体：由锚定层挂到 document.body 顶层渲染，不受侧边栏样式影响。
		function UsageModal(props) {
			const onClose = props.onClose;
			React.useEffect(function () {
				function onKey(e) {
					if (e && e.key === "Escape") onClose();
				}
				document.addEventListener("keydown", onKey);
				return function () { document.removeEventListener("keydown", onKey) };
			}, [onClose]);
			return React.createElement(React.Fragment, null,
				React.createElement("div", { className: "tkusg-backdrop", onClick: onClose }),
				React.createElement("div", { className: "tkusg-modal", role: "dialog", "aria-label": "Token 用量" },
					React.createElement("div", { className: "tkusg-modalhead" },
					React.createElement("span", { className: "tkusg-chip" }, ICON_BARS),
					React.createElement("div", { className: "tkusg-headmain" },
						React.createElement("div", { className: "tkusg-title" }, "Token \u7528\u91cf\u603b\u89c8")),
					React.createElement("button", { type: "button", className: "tkusg-xbtn", "aria-label": "\u5173\u95ed", onClick: onClose }, ICON_X)),
					React.createElement(UsagePanel, { hideHead: true })));
		}

		const inject = ["slots"];

		// ---------- 侧边栏锚定 v2：Portal 到 body，坐标实时计算 ----------
		//
		// v1 教训：把图标+弹窗插进侧边栏 DOM 子树后，祖先元素的动画/滤镜类
		// 样式劫持了 position:fixed 的定位基准——图标错位、弹窗缩进侧边栏。
		// v2 彻底解耦：
		//   · 图标与弹窗全部直接挂在 document.body 顶层
		//   · 图标位置 = 设置按钮 getBoundingClientRect() 实时计算
		//   · MutationObserver / resize / scroll(capture) 触发重算
		//   · 侧边栏折叠成窄栏（行宽 < 64px）时自动隐藏图标
		// 卸载时移除图层并还原，无残留。

		function mountSettingsAnchor(ReactDomClient) {
			const anchorHost = document.createElement("div");
			document.body.appendChild(anchorHost);
			// React 托管锚点：el=按钮 DOM（定位/显隐仍由 tick 直接操作），setTip=更新悬停文案。
			let anchorRef = { el: null, setTip: null };

			function IconAnchor() {
				const tipPair = React.useState("Token 用量");
				anchorRef.setTip = tipPair[1];
				const btn = React.createElement("button", {
					ref: function (el) { anchorRef.el = el; },
					type: "button",
					className: "tkusg-entry tkusg-entry-fixed",
					style: { display: "none" },
					onClick: function () {
						if (modalRoot === null) openModal();
						else closeModal();
					},
					"aria-label": "Token 用量",
					title: Tooltip ? undefined : tipPair[0]
				}, ICON_BARS);
				if (!Tooltip) return btn;
				return React.createElement(Tooltip, { label: tipPair[0], side: "top", delayMs: 0 }, btn);
			}
			const anchorRoot = ReactDomClient.createRoot(anchorHost);
			anchorRoot.render(React.createElement(IconAnchor));

			// 悬停提示：今日已用 token 总量。30 秒轮询（Host 有 15s 缓存去重，开销极小），
			// 失败静默保留上一次文案。
			let todayTimer = null;
			function fetchToday() {
				fetch("/token-usage/api/report", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				}).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
					if (!d || !Array.isArray(d.days)) return;
					const today = isoOf(new Date());
					let used = 0;
					for (const day of d.days) {
						if (day.key === today) { used = day.totalTokens || 0; break; }
					}
					if (anchorRef.setTip) anchorRef.setTip("今日" + fmtTodayTokens(used) + "token");
				}).catch(function () {});
			}
			fetchToday();
			todayTimer = setInterval(fetchToday, 30000);

			let modalRoot = null;
			let modalHost = null;

			function closeModal() {
				if (modalRoot !== null) {
					modalRoot.unmount();
					modalRoot = null;
				}
				if (modalHost !== null) {
					modalHost.remove();
					modalHost = null;
				}
				if (anchorRef.el) anchorRef.el.removeAttribute("data-active");
			}

			function openModal() {
				if (modalRoot !== null) return;
				modalHost = document.createElement("div");
				document.body.appendChild(modalHost);
				modalRoot = ReactDomClient.createRoot(modalHost);
				modalRoot.render(React.createElement(UsageModal, { onClose: closeModal }));
				if (anchorRef.el) anchorRef.el.setAttribute("data-active", "true");
			}

			let scheduled = false;
			let lastPos = "";

			function tick() {
				scheduled = false;
				const el = anchorRef.el;
				if (!el) return;
				const row = document.querySelector('div[class*="_settingsArea"]');
				const trigger = row === null ? null : row.querySelector("button");
				if (row === null || trigger === null || !document.contains(trigger)) {
					el.style.display = "none";
					return;
				}
				const rowR = row.getBoundingClientRect();
				const trigR = trigger.getBoundingClientRect();
				// 折叠成窄栏时行宽只有 ~36px（宽栏 ~240px+）：用行宽判断，
				// 不能用按钮左缘位置（宽栏下按钮本来就贴着侧边栏左侧）。
				if (rowR.width === 0 || rowR.width < 64) {
					el.style.display = "none";
					return;
				}
				// 触发按钮是整行宽（width:calc(100% + 4px)），图标钉在行内右缘。
				const left = Math.round(rowR.right - 28 - 2);
				const top = Math.round(trigR.top + (trigR.height - 28) / 2);
				const pos = left + "," + top;
				if (pos !== lastPos || el.style.display === "none") {
					lastPos = pos;
					el.style.display = "";
					el.style.left = left + "px";
					el.style.top = top + "px";
				}
			}

			function schedule() {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(tick);
			}

			const observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
			window.addEventListener("resize", schedule);
			window.addEventListener("scroll", schedule, true);
			schedule();

			return function dispose() {
				if (todayTimer !== null) clearInterval(todayTimer);
				observer.disconnect();
				window.removeEventListener("resize", schedule);
				window.removeEventListener("scroll", schedule, true);
				closeModal();
				anchorRoot.unmount();
				anchorHost.remove();
			};
		}
		function apply(ctx) {
			ensureCss();
			ctx.slots.inject("tool.view.cordis", function () {
				return ctx.slots.register(
					{ name: "tool.view.cordis", key: "self" },
					function (props) { return React.createElement(UsagePanel, props) }
				);
			});
			ctx.effect(function () {
				return mountSettingsAnchor(require("react-dom/client"));
			}, "dsh-plugin-token-usage: settings-row anchor");
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});
