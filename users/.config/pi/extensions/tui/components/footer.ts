import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { resolve, relative, sep, isAbsolute } from "path";
// type imports
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Theme, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export class Footer implements Component {
	private ctx: ExtensionContext;
	private theme: Theme;
	private footerData: ReadonlyFooterDataProvider;
	private unsubscribeBranch: () => void;

	constructor(
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	) {
		this.ctx = ctx;
		this.theme = theme;
		this.footerData = footerData;
		this.unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
	}

	render(width: number): string[] {
		const thm = this.theme;
		const dimLine = thm.fg("dim", "─".repeat(width));

		// Compute token stats from session branch
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let latestCacheHitRate: number | undefined;
		for (const entry of this.ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const msg = entry.message as AssistantMessage;
				totalCacheRead += msg.usage.cacheRead;
				totalCacheWrite += msg.usage.cacheWrite;
				totalCost += msg.usage.cost.total;

				const latestPromptTokens = msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (msg.usage.cacheRead / latestPromptTokens) * 100 : undefined;
			}
		}

		// Context usage
		const contextUsage = this.ctx.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? this.ctx.model?.contextWindow;
		const contextUsed = contextUsage?.tokens;
		const contextUsedStr = contextUsed != null ? fmtTokens(contextUsed) : "?";
		const contextTotalStr = contextWindow != null ? fmtTokens(contextWindow) : "?";

		// Build content segments
		const separator = thm.fg("dim", " │ ");

		// Extension statuses from other extensions (lowercase)
		const statuses = this.footerData.getExtensionStatuses();
		const extStatusText = statuses.size > 0
			? [...statuses.values()].map((s) => s.toLowerCase()).join(thm.fg("dim", " | "))
			: "";

		// Info segments
		const ctxTokens = `${contextUsedStr}/${contextTotalStr}`;
		const cacheHit = `${(latestCacheHitRate ?? 0).toFixed(1)}% CH`;
		const cost = `$${totalCost.toFixed(3)}`;

		// Core parts (always visible): ctxTokens │ cacheHit │ cost
		const coreParts = [ctxTokens, cacheHit, thm.fg("warning", cost)];
		const coreRight = coreParts.join(separator);
		const coreRightWidth = visibleWidth(coreRight);

		// Right side with extensions (preferred, dropped first on overflow)
		const hasExt = extStatusText.length > 0;
		const fullRight = hasExt ? `${extStatusText}${separator}${coreRight}` : coreRight;
		const fullRightWidth = hasExt ? visibleWidth(fullRight) : coreRightWidth;

		// HOME → ~ replacement (safe resolve/relative approach)
		const home = process.env.HOME || process.env.USERPROFILE;
		const cwd = homeRelativePath(this.ctx.cwd, home);
		const cwdStyled = ` ${cwd}`;
		const cwdWidth = visibleWidth(cwdStyled);

		// Layout within contentWidth = width - 1 (1 cell right padding)
		const contentWidth = width - 1;

		let contentLine: string;

		if (cwdWidth + fullRightWidth <= contentWidth) {
			const gap = contentWidth - cwdWidth - fullRightWidth;
			contentLine = `${cwdStyled}${" ".repeat(gap)}${fullRight}`;
		} else if (hasExt && cwdWidth + coreRightWidth <= contentWidth) {
			const gap = contentWidth - cwdWidth - coreRightWidth;
			contentLine = `${cwdStyled}${" ".repeat(gap)}${coreRight}`;
		} else {
			contentLine = truncateToWidth(`${cwdStyled}${separator}${coreRight}`, contentWidth, "…");
		}

		return [`${contentLine} `, dimLine];
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribeBranch();
	}
}

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	return `${(n / 1_000_000_000).toFixed(1)}b`;
}

function homeRelativePath(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const rel = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));

	if (!isInsideHome) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}


