import assert from "node:assert/strict"
import test from "node:test"
import {
    parseListSessionsOutput,
    parsePaneNumericId,
    sanitizeIdentifier,
    validateIdentifier,
    withTemporaryClient,
} from "../src/cli.ts"
import { createMockRuntime } from "./helpers.ts"

void test("identifier and pane ID helpers reject invalid formats", () => {
    assert.throws(() => validateIdentifier("-flag", "pane"))
    assert.throws(() => validateIdentifier(".hidden", "pane"))
    assert.throws(() => validateIdentifier("..", "pane"))
    assert.equal(validateIdentifier("api-dev_1.0", "pane"), "api-dev_1.0")
    assert.equal(sanitizeIdentifier("---api/dev", "fallback"), "api-dev")
    assert.equal(parsePaneNumericId("terminal_12"), 12)
    assert.equal(parsePaneNumericId("7"), 7)
    assert.throws(() => parsePaneNumericId("plugin_1"))
})

void test("parseListSessionsOutput preserves spaces in names and drops EXITED sessions", () => {
    const raw = [
        "pi review 123 [Created 1h 2m ago] (current)",
        "old dead session [Created 2d ago] (EXITED - attach to resurrect)",
        "nc [Created 5h ago]",
        "",
    ].join("\n")
    assert.deepEqual(parseListSessionsOutput(raw), ["pi review 123", "nc"])
})

void test("withTemporaryClient serializes concurrent acquisition via single list-clients probe", async () => {
    let clientQueries = 0
    let releaseQuery!: () => void
    const gate = new Promise<void>((resolve) => {
        releaseQuery = resolve
    })

    const { pi } = createMockRuntime(async (_cmd, args) => {
        if (args.includes("list-clients")) {
            clientQueries += 1
            await gate
            return {
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            }
        }
        return { stdout: "", stderr: "", code: 0, killed: false, truncated: false }
    })

    const p1 = withTemporaryClient(pi, "shared-sess", () => Promise.resolve("a"))
    const p2 = withTemporaryClient(pi, "shared-sess", () => Promise.resolve("b"))
    await new Promise((done) => setTimeout(done, 10))
    assert.equal(clientQueries, 1)
    releaseQuery()
    assert.deepEqual(await Promise.all([p1, p2]), ["a", "b"])
})
