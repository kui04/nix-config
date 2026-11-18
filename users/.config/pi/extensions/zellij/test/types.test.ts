import assert from "node:assert/strict"
import test from "node:test"
import { parseZellijPanesJson, parseZellijTabsJson } from "../src/types.ts"

void test("JSON parsers return empty array on empty or invalid JSON", () => {
    assert.deepEqual(parseZellijPanesJson(""), [])
    assert.deepEqual(parseZellijPanesJson("not json"), [])
    assert.deepEqual(parseZellijTabsJson(""), [])
    assert.deepEqual(parseZellijTabsJson("{}"), [])
})
