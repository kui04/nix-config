// TUI resize/repaint watchdog for terminals that drop SIGWINCH or lose paint
// while hidden (VSCode integrated terminal: closing and re-showing the panel
// corrupts the canvas while pi's tracked size is unchanged, so pi's diff
// render repaints nothing — only a full redraw repairs it).
//
// Fix: capture the app's TUI handle through an empty widget (the widget
// factory receives the TUI and rendering zero lines keeps the layout
// unchanged), then every second:
//   1. re-arm SIGWINCH (pi's own refreshTerminalDimensions trick) so Bun's
//      cached winsize stays in sync with the kernel;
//   2. force a full redraw via requestRender(true) (resetRenderState), which
//      repaints the whole screen even when width/height did not change.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const POLL_MS = 1000;

export default function (pi: ExtensionAPI) {
  let tui: { requestRender(force?: boolean): void } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || process.platform === "win32") return; // SIGWINCH is POSIX-only

    // Register the widget once per session; the factory gives us the app TUI.
    ctx.ui.setWidget("tui-resize-fix", (t, _theme) => {
      tui = t;
      return { render: () => [], invalidate: () => { } };
    });

    if (timer) return;
    timer = setInterval(() => {
      try {
        process.kill(process.pid, "SIGWINCH");
      } catch {
        // Signal delivery blocked (e.g. seccomp); skip the size re-sync.
      }
      tui?.requestRender(true); // full redraw: repairs screens lost while hidden
    }, POLL_MS);
  });

  pi.on("session_shutdown", () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    tui = undefined;
  });
}
