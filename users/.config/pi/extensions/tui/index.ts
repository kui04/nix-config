import { Footer } from "./components/footer";
import { TuiEditor } from "./components/editor";
// type imports
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
	let tuiRef: TUI | undefined;

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			tuiRef = tui;
			return new TuiEditor(tui, theme, keybindings, ctx, pi);
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			return new Footer(ctx, tui, theme, footerData);
		});
	});

	pi.on("session_shutdown", () => {
		tuiRef = undefined;
	});
}
