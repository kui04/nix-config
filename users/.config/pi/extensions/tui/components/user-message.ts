import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
// type imports
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

type RenderFn = (width: number) => string[];

type PatchablePrototype = {
	render: RenderFn;
	children?: unknown[];
	__tuiOriginalRender?: RenderFn;
	__tuiPatched?: boolean;
	__tuiActive?: boolean;
	__tuiGetTheme?: () => Theme | undefined;
};

type Cleanup = () => void;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
	if (isRecord(value) && typeof value.text === "string") {
		return value.text;
	}
	if (!isRecord(value)) return undefined;
	const children = Array.isArray(value.children) ? value.children : [];
	for (const child of children) {
		const text = findMarkdownText(child);
		if (text !== undefined) return text;
	}
	return undefined;
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function makeMarkdownTheme(thm: Theme | undefined): MarkdownTheme {
	const fg = (color: string, text: string) =>
		thm ? thm.fg(color as any, text) : text;
	return {
		heading: (text) => fg("mdHeading", text),
		link: (text) => fg("mdLink", text),
		linkUrl: (text) => fg("mdLinkUrl", text),
		code: (text) => fg("mdCode", text),
		codeBlock: (text) => fg("mdCodeBlock", text),
		codeBlockBorder: (text) => fg("mdCodeBlockBorder", text),
		quote: (text) => fg("mdQuote", text),
		quoteBorder: (text) => fg("mdQuoteBorder", text),
		hr: (text) => fg("mdHr", text),
		listBullet: (text) => fg("mdListBullet", text),
		bold: (text) => (thm ? thm.bold(text) : text),
		italic: (text) => (thm ? thm.italic(text) : text),
		underline: (text) => (thm ? thm.underline(text) : text),
		strikethrough: (text) => (thm ? thm.strikethrough(text) : text),
	};
}

function renderCustomUserMessage(
	instance: PatchablePrototype,
	width: number,
	thm: Theme | undefined,
): string[] | undefined {
	const text = findMarkdownText(instance);
	if (text === undefined) return undefined;
	if (width <= 0) return [""];

	const rail = thm ? `${thm.fg("accent", "│")} ` : "│ ";
	const railWidth = visibleWidth(rail);
	const innerWidth = Math.max(1, width - railWidth);

	const renderer = new Markdown(text, 0, 0, makeMarkdownTheme(thm), {
		color: (content: string) =>
			thm ? thm.fg("userMessageText", content) : content,
	});
	const body = renderer.render(innerWidth);
	const contentLines = body.length > 0 ? body : [""];

	const border = thm
		? thm.fg("dim", "─".repeat(width))
		: "─".repeat(width);

	// Layout: border, empty line, content lines, empty line, border
	const lines = ["", ...contentLines, ""];

	return [
		border,
		...lines.map((line) => `${rail}${fillLine(line, innerWidth)}`),
		border,
	];
}

export function installUserMessageStyle(
	getTheme: () => Theme | undefined,
): Cleanup {
	const prototype =
		UserMessageComponent.prototype as unknown as PatchablePrototype;
	prototype.__tuiGetTheme = getTheme;
	prototype.__tuiActive = true;

	if (prototype.__tuiPatched && prototype.render === (prototype as any).__tuiWrapper) {
		return () => {
			prototype.__tuiActive = false;
		};
	}

	prototype.__tuiOriginalRender = prototype.render;
	const wrapper = function renderWithCustomStyle(
		this: unknown,
		width: number,
	): string[] {
		const original =
			prototype.__tuiOriginalRender ?? prototype.render;
		if (!prototype.__tuiActive) return original.call(this, width);

		const lines = renderCustomUserMessage(
			this as PatchablePrototype,
			width,
			prototype.__tuiGetTheme?.(),
		);

		if (!lines) return original.call(this, width);
		if (lines.length === 0) return lines;

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] =
			OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	};
	(prototype as any).__tuiWrapper = wrapper;
	prototype.render = wrapper;
	prototype.__tuiPatched = true;

	return () => {
		prototype.__tuiActive = false;
	};
}
