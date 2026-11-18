import assert from "node:assert/strict"
import test from "node:test"
import { detectBlockedBashReason } from "../src/bash-guard.ts"

const BLOCKED_CASES = [
    "nohup cargo build &",
    "/usr/bin/nohup sleep 5",
    "env FOO=1 nohup make",
    "if true; then nohup sleep 1; fi",
    "{ nohup sleep 1; }",
    "for i in 1; do setsid true; done",
    "python3 -m http.server &",
    "npm run dev 8080&",
    "make 2>&1&",
    "cmd1 & cmd2",
    "disown %1",
    "setsid node server.js",
    "tmux new -s foo",
    "/usr/bin/screen -S test",
    "while true; do sleep 2; done",
    "zellij kill-all-sessions",
    "zellij delete-all-sessions",
    "zellij kill-session foo",
    "zellij attach my-session",
    "zellij subscribe --pane-id terminal_1",
    'zellij "subscribe" --pane-id terminal_1',
    "zellij action new-pane -- echo hi",
    "zellij action write-chars -p 1 -- ls",
    "zellij -s nc action new-pane -- echo hi",
    "zellij --session=nc action new-tab --name foo",
    "zellij run -- echo hi",
    "zellij -s nc r -- echo hi",
    "zellij edit foo.txt",
    "zellij plugin file:bar.wasm",
]

const ALLOWED_CASES = [
    "cargo check && cargo test",
    "echo hi 2>&1",
    "echo hi >&2",
    "git status",
    "git status # nohup comment &",
    'grep "nohup" file.txt',
    "rg -l then nohup.md",
    'echo "foo &"',
    'git commit -m "while sleep"',
    "echo $((1 & 1))",
    "nohup=true",
    "zellij subscribe --help",
    'zellij "subscribe" --help',
    "zellij action new-pane --help",
    "zellij -s nc action new-pane -h",
    "zellij run --help",
    "zellij attach -h",
    "cat <<'EOF'\nnohup foo &\ntmux new\nEOF",
    "cat <<-EOF\n\tnohup foo &\n\tEOF",
]

void test("detectBlockedBashReason blocks anti-patterns", () => {
    for (const cmd of BLOCKED_CASES) {
        assert.ok(detectBlockedBashReason(cmd), `Expected blocked: ${cmd}`)
    }
})

void test("detectBlockedBashReason allows safe commands, assignments, and heredocs", () => {
    for (const cmd of ALLOWED_CASES) {
        assert.equal(detectBlockedBashReason(cmd), undefined, `Expected allowed: ${cmd}`)
    }
})
