import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
// type imports
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

export class TuiEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private pi: ExtensionAPI;
	private uiTheme: Theme;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
		pi: ExtensionAPI,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.ctx = ctx;
		this.pi = pi;
		this.uiTheme = ctx.ui.theme;
		this.borderColor = (text: string) => this.uiTheme.fg("dim", text);
	}

	handleInput(data: string): void {
		super.handleInput(data);
		this.invalidate();
	}

	private fillLine(content: string, width: number): string {
		const truncated = truncateToWidth(content, width, "");
		const pad = " ".repeat(width - visibleWidth(truncated));
		return `${truncated}${pad}`;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		if (width <= 2) {
			const lines = super.render(width);
			this.cachedLines = lines;
			this.cachedWidth = width;
			return lines;
		}

		const innerWidth = width - 2;
		const rendered = super.render(innerWidth);

		if (rendered.length < 2) {
			this.cachedLines = rendered;
			this.cachedWidth = width;
			return rendered;
		}

		const thm = this.uiTheme;
		const dimDash = thm.fg("dim", "─");
		const rail = `${thm.fg("accent", "│")} `;

		// Extract overflow indicators from base editor's borders
		const topLine = rendered[0];
		const bottomLine = rendered[rendered.length - 1];
		const aboveMatch = topLine.match(/↑\s*(\d+)/);
		const belowMatch = bottomLine.match(/↓\s*(\d+)/);

		const topBorder = aboveMatch
			? buildOverflowBorder(width, `↑ ${aboveMatch[1]} more `, thm)
			: dimDash.repeat(width);

		const bottomBorder = belowMatch
			? buildOverflowBorder(width, `↓ ${belowMatch[1]} more `, thm)
			: dimDash.repeat(width);

		// Extract editor content lines (between top/bottom borders)
		const editorLines = rendered.slice(1, rendered.length - 1);

		// Build info line
		const model = this.ctx.model;
		const modelId = model?.id ?? "";
		const provider = model?.provider ?? "";
		const thinkingLevel = this.pi.getThinkingLevel();
		const thinkingText = thm.fg(thinkingColorKey(thinkingLevel), thinkingLevel);
		const modelPart = thm.fg("accent", modelId);
		const meta = `${modelPart}  ${provider}  ${thinkingText}`;

		// Empty padding above content, empty padding below content, then info line
		const lines = ["", ...editorLines, "", meta];

		const result = [
			topBorder,
			...lines.map((line) => `${rail}${this.fillLine(line, innerWidth)}`),
			bottomBorder,
		];

		this.cachedLines = result;
		this.cachedWidth = width;
		return result;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		super.invalidate();
	}
}

function buildOverflowBorder(width: number, indicator: string, thm: Theme): string {
	const text = `─── ${indicator}`;
	const remaining = width - visibleWidth(text);
	return thm.fg("dim", text + "─".repeat(Math.max(0, remaining)));
}

function thinkingColorKey(
	level: string,
): "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh" {
	switch (level) {
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		default:
			return "thinkingOff";
	}
}
