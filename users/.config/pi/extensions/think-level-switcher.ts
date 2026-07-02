import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
// type imports
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";

const LEVEL_DESCRIPTIONS: Record<ModelThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Maximum reasoning (~32k tokens)",
};

const ALL_LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function getAvailableLevels(ctx: ExtensionContext): ModelThinkingLevel[] {
	const model = ctx.model;
	if (!model) return ALL_LEVELS;
	return getSupportedThinkingLevels(model);
}

export default function (pi: ExtensionAPI) {
	async function showSelector(ctx: ExtensionContext) {
		const availableLevels = getAvailableLevels(ctx);
		const current = pi.getThinkingLevel();

		if (availableLevels.length === 0) {
			ctx.ui.notify("Current model does not support any thinking levels", "warning");
			return;
		}

		const items: SelectItem[] = availableLevels.map((level) => ({
			value: level,
			label: level === current ? `${level} (current)` : level,
			description: LEVEL_DESCRIPTIONS[level],
		}));

		const result = await ctx.ui.custom<string | null>((tui: any, theme: any, _kb: any, done: any) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Select Thinking Level"))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text: string) => theme.fg("accent", text),
				selectedText: (text: string) => theme.fg("accent", text),
				description: (text: string) => theme.fg("muted", text),
				scrollInfo: (text: string) => theme.fg("dim", text),
				noMatch: (text: string) => theme.fg("warning", text),
			});

			const idx = availableLevels.indexOf(current as ModelThinkingLevel);
			if (idx !== -1) selectList.setSelectedIndex(idx);

			selectList.onSelect = (item: SelectItem) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
			container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (result) {
			pi.setThinkingLevel(result as any);
			ctx.ui.notify(`Thinking level set to "${result}"`, "info");
		}
	}

	pi.registerCommand("thinking", {
		description: "Switch thinking level",
		handler: async (args, ctx) => {
			const availableLevels = getAvailableLevels(ctx);

			if (args?.trim()) {
				const level = args.trim().toLowerCase() as ModelThinkingLevel;
				if (!ALL_LEVELS.includes(level)) {
					ctx.ui.notify(`Invalid level "${level}". Valid: ${ALL_LEVELS.join(", ")}`, "error");
					return;
				}
				if (!availableLevels.includes(level)) {
					ctx.ui.notify(
						`Level "${level}" not supported by current model. Available: ${availableLevels.join(", ")}`,
						"error",
					);
					return;
				}
				pi.setThinkingLevel(level as any);
				ctx.ui.notify(`Thinking level set to "${level}"`, "info");
				return;
			}
			await showSelector(ctx);
		},
		getArgumentCompletions: (prefix: string) => {
			return ALL_LEVELS
				.filter((l) => l.startsWith(prefix))
				.map((l) => ({ value: l, label: l, description: LEVEL_DESCRIPTIONS[l] }));
		},
	});
}
