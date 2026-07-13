#!/usr/bin/env lua
-- validate.lua — quick structural validation of a skill
--
-- Usage: lua validate.lua <path-to-skill>
--
-- Checks (per the Agent Skills spec):
--   - SKILL.md exists (or the given .md file)
--   - YAML frontmatter is present and well-formed
--   - required fields name and description are present
--   - name follows kebab-case rules
--   - description is 1-1024 chars
--   - compatibility (optional) is 1-500 chars
--   - frontmatter contains no unknown top-level fields

local ALLOWED = {
  name = true,
  description = true,
  license = true,
  compatibility = true,
  metadata = true,
  ["allowed-tools"] = true,
  ["disable-model-invocation"] = true,
}

local MAX_NAME = 64
local MAX_DESC = 1024
local MAX_COMPAT = 500

-- --- Output helpers ---------------------------------------------------------

local errors = 0
local warns = 0

local function err(msg) io.stderr:write("ERROR: " .. msg .. "\n"); errors = errors + 1 end
local function warn(msg) io.stderr:write("WARN:  " .. msg .. "\n"); warns = warns + 1 end
local function ok(msg) io.write("OK:    " .. msg .. "\n") end

-- --- Argument parsing -------------------------------------------------------

local HELP = [[
Usage: lua validate.lua <path-to-skill>

Validates a skill's SKILL.md against the Agent Skills spec.

Arguments:
  <path-to-skill>   Either a directory containing SKILL.md,
                    or a path to a single .md file.

Options:
  -h, --help        Show this help and exit.

Exit codes:
  0  Validation passed (warnings are OK)
  1  Validation failed (one or more errors)
  2  Usage error (no argument or invalid flag)

Checks performed (per the Agent Skills spec):
  - SKILL.md exists at the given path
  - YAML frontmatter opens with --- on the first line
  - Closing --- delimiter exists
  - name: 1-64 chars, lowercase a-z / 0-9 / hyphens, no
    leading/trailing hyphen, no consecutive hyphens
  - description: 1-1024 chars, non-empty
  - compatibility (optional): 1-500 chars
  - All other frontmatter fields are warned (not errored)

Limitations:
  - Only the first line of YAML block scalars (>, |) is parsed.
  - Unicode names are rejected (the spec allows them in principle;
    the bundled validator is ASCII-only).

Output:
  - Lines starting with OK:    go to stdout
  - Lines starting with WARN:  go to stderr
  - Lines starting with ERROR: go to stderr
  - The summary line goes to stdout on success, stderr on failure.
]]

if #arg == 1 and (arg[1] == "-h" or arg[1] == "--help") then
  io.write(HELP)
  os.exit(0)
end

if #arg ~= 1 then
  io.stderr:write("Usage: lua validate.lua <path-to-skill>\n")
  io.stderr:write("Try 'lua validate.lua --help' for more information.\n")
  os.exit(2)
end

local skill_path = arg[1]
local skill_md

local stat = io.open(skill_path, "r")
if stat then
  stat:close()
  -- It's a readable path. Is it a directory or a .md file?
  -- Lua doesn't have a portable directory test; check the suffix.
  if skill_path:match("%.md$") then
    skill_md = skill_path
  else
    -- assume directory
    skill_md = skill_path .. "/SKILL.md"
  end
else
  err("skill path is not readable: " .. skill_path)
  io.stderr:write("Validation failed (1 error).\n")
  os.exit(1)
end

-- --- Read SKILL.md ----------------------------------------------------------

local f, err_open = io.open(skill_md, "r")
if not f then
  err("SKILL.md not found at " .. skill_md .. " (" .. tostring(err_open) .. ")")
  io.stderr:write("Validation failed (1 error).\n")
  os.exit(1)
end
ok("SKILL.md exists")

local content = f:read("*a")
f:close()

-- --- Extract frontmatter ----------------------------------------------------
-- Frontmatter is the block between the first two '---' lines.

local first_line = content:match("^([^\n]*)")
-- Frontmatter must start on line 1 with `---` (optionally followed by \r on
-- CRLF files). Leading whitespace is not allowed — YAML reserves it.
if not first_line or first_line:match("^---%s*$") == nil then
  err("SKILL.md does not start with YAML frontmatter (--- on first line)")
  io.stderr:write("Validation failed (1 error).\n")
  os.exit(1)
end

-- Walk lines after the first '---' to find the closing '---'
local lines = {}
for line in content:gmatch("[^\n]+") do
  table.insert(lines, line)
end

-- lines[1] should be the opening '---'
-- find the closing '---'
local close_idx
for i = 2, #lines do
  if lines[i]:match("^%s*---%s*$") then
    close_idx = i
    break
  end
end

if not close_idx then
  err("YAML frontmatter is empty or unterminated (expected two '---' delimiters)")
  io.stderr:write("Validation failed (1 error).\n")
  os.exit(1)
end

local fm_lines = {}
for i = 2, close_idx - 1 do
  table.insert(fm_lines, lines[i])
end
ok("YAML frontmatter present")

-- --- Find top-level keys and warn on unknowns -------------------------------

local seen = {}
local unknown = {}
for _, line in ipairs(fm_lines) do
  local key = line:match("^([%w%-_]+):")
  if key and not seen[key] then
    seen[key] = true
    if not ALLOWED[key] then
      table.insert(unknown, "  - " .. key)
    end
  end
end

if #unknown > 0 then
  warn("unknown frontmatter fields (will be ignored by clients):")
  for _, k in ipairs(unknown) do io.stderr:write(k .. "\n") end
end

-- --- Extract a scalar value for a given key --------------------------------
-- Returns the trimmed value, or nil if absent. Handles inline scalars only;
-- block scalars (>, |) and complex YAML structures need a real YAML parser.

local function get_field(key)
  for _, line in ipairs(fm_lines) do
    -- string.match returns only the captures, not the full match.
    -- With one capture group, the result is the captured value.
    local v = line:match("^" .. key .. ":%s*(.*)$")
    if v then
      -- strip surrounding quotes. gsub returns (string, count); parens
      -- discard the second return so chaining doesn't trip on it.
      v = (v:gsub('^"', ''):gsub('"$', ''))
      v = (v:gsub("^'", ""):gsub("'$", ""))
      v = v:match("^%s*(.-)%s*$") -- trim
      return v
    end
  end
  return nil
end

-- --- Validate name ----------------------------------------------------------

local name = get_field("name")
if not name or name == "" then
  err("missing required field: name")
else
  ok("name = " .. name)
  if #name > MAX_NAME then
    err("name is " .. #name .. " chars (max " .. MAX_NAME .. ")")
  end
  -- kebab-case: lowercase a-z, 0-9, hyphens; no leading/trailing hyphen, no consecutive.
  -- Lua patterns can't put ? on a capture group, so check three pieces:
  --   1) only allowed chars
  --   2) no leading hyphen
  --   3) no trailing hyphen
  local allowed = name:match("^[a-z0-9%-]+$") ~= nil
  local no_leading = name:sub(1, 1) ~= "-"
  local no_trailing = name:sub(-1) ~= "-"
  if not (allowed and no_leading and no_trailing) or name:match("%-%-") then
    err("name '" .. name .. "' must be kebab-case: lowercase a-z, 0-9, hyphens; no leading/trailing hyphen, no consecutive hyphens")
  end
end

-- --- Validate description ---------------------------------------------------

local desc = get_field("description")
if not desc or desc == "" then
  err("missing required field: description")
elseif #desc > MAX_DESC then
  err("description is " .. #desc .. " chars (max " .. MAX_DESC .. ")")
else
  ok("description is " .. #desc .. " chars (max " .. MAX_DESC .. ")")
end

-- --- Validate compatibility (optional) --------------------------------------

local comp = get_field("compatibility")
if comp and comp ~= "" then
  if #comp > MAX_COMPAT then
    err("compatibility is " .. #comp .. " chars (max " .. MAX_COMPAT .. ")")
  else
    ok("compatibility is " .. #comp .. " chars (max " .. MAX_COMPAT .. ")")
  end
end

-- --- Summary ----------------------------------------------------------------

io.write("\n")
if errors > 0 then
  io.stderr:write(string.format("Validation failed: %d error(s), %d warning(s).\n", errors, warns))
  os.exit(1)
elseif warns > 0 then
  io.write(string.format("Validation passed with %d warning(s).\n", warns))
else
  io.write("Validation passed.\n")
end
