import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SESSION_PREFIX = "pi-bg-";
const STATUS_KEY = "tmux-bg";
const BG_GUIDE = `
## Background tasks via tmux

When you need to run long-running commands (builds, dev servers, watch tasks, etc.),
spawn them in a detached tmux session so they don't block your turn.

Session naming: use the prefix \`${SESSION_PREFIX}\` followed by a short task name, e.g.:
  \`pi-bg-dev\`, \`pi-bg-build\`, \`pi-bg-test\`

### Spawning a background task
\`\`\`bash
tmux new-session -d -s pi-bg-<name> -c <cwd> "<command>; EXIT=\$?; echo; echo '[BG_DONE:\$EXIT]'"
\`\`\`
The \`[BG_DONE:N]\` marker lets you detect when the command finishes (N is the exit code).

### Reading output
\`\`\`bash
tmux capture-pane -t pi-bg-<name> -p -S -50   # last 50 lines
tmux capture-pane -t pi-bg-<name> -p -S -      # full scrollback
\`\`\`
Read partial output even while the task is still running.

### Sending input
\`\`\`bash
tmux send-keys -t pi-bg-<name> "<text>" Enter   # type text and press Enter
tmux send-keys -t pi-bg-<name> C-c               # send Ctrl+C (SIGINT)
\`\`\`

### Checking status
\`\`\`bash
tmux list-sessions -F "#{session_name}" | grep ^pi-bg-   # list all bg tasks
tmux has-session -t pi-bg-<name>                          # check if still alive
\`\`\`

### Killing a session
\`\`\`bash
tmux kill-session -t pi-bg-<name>
\`\`\`

### Monitoring pattern
1. Spawn the task with \`tmux new-session -d\`
2. Read output periodically with \`capture-pane\` to check progress
3. When \`[BG_DONE:N]\` appears in the output, the task has finished
4. Use \`tmux kill-session\` to clean up when done
`;

export default function (pi: ExtensionAPI) {
	let tmuxAvailable = true;

	function updateStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI || !tmuxAvailable) return;
		pi.exec("tmux", ["list-sessions", "-F", "#{session_name}"]).then((result) => {
			if (result.code !== 0) return;
			const count = result.stdout
				.trim()
				.split("\n")
				.filter((s) => s.startsWith(SESSION_PREFIX)).length;
			if (count > 0) {
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `bg: ${count}`));
			} else {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		}).catch(() => {});
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			const result = await pi.exec("tmux", ["-V"]);
			tmuxAvailable = result.code === 0;
		} catch {
			tmuxAvailable = false;
		}
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!tmuxAvailable) return;
		const systemPrompt = event.systemPrompt + BG_GUIDE;
		return { systemPrompt };
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		if (!tmuxAvailable) return;
		pi.exec("tmux", ["list-sessions", "-F", "#{session_name}"]).then((result) => {
			if (result.code !== 0) return;
			const sessions = result.stdout.trim().split("\n").filter(Boolean);
			for (const s of sessions) {
				if (s.startsWith(SESSION_PREFIX)) {
					pi.exec("tmux", ["kill-session", "-t", s]).catch(() => {});
				}
			}
		}).catch(() => {});
	});
}
