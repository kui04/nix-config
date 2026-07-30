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
--   - scalar values are read the way real YAML parsers read them:
--     quoted and block (>, |) scalars are unfolded, and plain-scalar
--     hazards (': ' inside unquoted values, ' #' comments, flow or
--     reserved indicators, unbalanced quotes) are flagged

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
  - Scalar values are read the way real YAML parsers read them:
    quoted and block (>, |) scalars are unfolded, and plain-scalar
    hazards (': ' inside unquoted values, ' #' comments, flow or
    reserved indicators, unbalanced quotes) are flagged

Limitations:
  - Unicode names are rejected (the spec allows them in principle;
    the bundled validator is ASCII-only).
  - Double-quoted escape sequences and multi-line quoted folding are
    measured verbatim, so reported lengths can differ by a few chars.

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

-- Split into lines, preserving blank lines (block scalars need them)
-- and stripping CR so CRLF files behave.
local lines = {}
for line in (content .. "\n"):gmatch("(.-)\n") do
  table.insert(lines, (line:gsub("\r$", "")))
end

-- lines[1] should be the opening '---'
-- find the closing '---'
local close_idx
for i = 2, #lines do
  -- The closing delimiter must start at column 0 — an indented '---'
  -- could be content of a block scalar, not the end of frontmatter.
  if lines[i]:match("^---%s*$") then
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
-- Returns the parsed value, or nil if absent. Understands plain, quoted and
-- block (>, |) scalars, and flags constructs that real YAML parsers reject or
-- reinterpret — so a skill that passes here also parses cleanly elsewhere.
-- Still not a full YAML parser: double-quoted escape sequences are measured
-- verbatim, and flow collections are only detected, not parsed.
local function get_field(key)
  local pat = "^" .. key:gsub("%-", "%%-") .. ":%s*(.-)%s*$"
  for i, line in ipairs(fm_lines) do
    local v = line:match(pat)
    if v then
      -- Block scalar: content lives on the following indented lines.
      local bstyle = v:match("^([>|])[%+%-]?$")
      if bstyle then
        local buf = {}
        local j = i + 1
        while j <= #fm_lines do
          local l = fm_lines[j]
          if l:match("^%s*$") then
            table.insert(buf, "")            -- blank line: paragraph break
          elseif l:match("^%s") then
            table.insert(buf, (l:gsub("^%s+", "")))
          else
            break                          -- next top-level key
          end
          j = j + 1
        end
        -- trailing blank lines only affect the final newline count, which
        -- none of the checks below care about
        while #buf > 0 and buf[#buf] == "" do table.remove(buf) end
        if bstyle == ">" then
          -- folded style: newlines become spaces, blank lines stay newlines
          local parts, cur = {}, {}
          for _, l in ipairs(buf) do
            if l == "" then
              if #cur > 0 then table.insert(parts, table.concat(cur, " ")); cur = {} end
              table.insert(parts, "\n")
            else
              table.insert(cur, l)
            end
          end
          if #cur > 0 then table.insert(parts, table.concat(cur, " ")) end
          return table.concat(parts)
        end
        return table.concat(buf, "\n")       -- literal style
      end

      -- Quoted scalar; YAML lets it span lines (newlines fold to spaces).
      -- Allow a trailing comment after a same-line closing quote first.
      v = v:match("^('.-')%s+#") or v:match('^(".-")%s+#') or v
      local q = v:sub(1, 1)
      if q == "'" or q == '"' then
        local buf = { (v:sub(2)) }
        local closed = false
        while true do
          local cur = buf[#buf]
          local ends = cur:sub(-1) == q and (q == "'" or cur:sub(-2, -1) ~= "\\" .. q)
          if ends then
            buf[#buf] = cur:sub(1, -2)
            closed = true
            break
          end
          if i + #buf > #fm_lines then break end
          table.insert(buf, fm_lines[i + #buf])
        end
        if not closed then
          err(key .. ": unbalanced " .. (q == "'" and "single" or "double")
            .. " quotes — YAML parsers reject this. Quote both ends or use a block scalar (>-).")
          return table.concat(buf, " ")
        end
        local s = table.concat(buf, " ")
        if q == "'" then
          if (s:gsub("''", "")):find("'") then
            err(key .. ": single-quoted value contains an unescaped quote — YAML requires doubling it ('')")
          end
          s = s:gsub("''", "'")
        end
        return s
      end

      -- Plain (unquoted) scalar: apply the YAML rules a naive key:value
      -- split gets wrong.
      if v:sub(1, 1) == "#" then
        err(key .. ": value starts with '#' — YAML reads it as a comment, leaving the field empty. Quote the value.")
        return ""
      end
      local hash = v:find(" #", 1, true)
      if hash then
        warn(key .. ": unquoted value contains ' #' — YAML treats the rest as a comment. Quote the value to keep it whole.")
        v = (v:sub(1, hash - 1):match("^%s*(.-)%s*$"))
      end
      if v:find(": ", 1, true) or (v ~= ":" and v:sub(-1) == ":") then
        err(key .. ": unquoted value contains ': ' — YAML parses this as a nested mapping and rejects it. Wrap the whole value in quotes.")
      end
      local first = v:sub(1, 1)
      if first == "[" or first == "{" then
        err(key .. ": value starts with '" .. first .. "' — YAML parses it as a flow collection, not a string. Quote the value.")
      elseif first == "*" or first == "%" or first == "@" or first == "`" then
        err(key .. ": value starts with reserved YAML indicator '" .. first .. "' — parsers reject or misread it. Quote the value.")
      elseif v:match("^%-%s") or v:match("^%?%s") then
        err(key .. ": value starts with '" .. v:sub(1, 2) .. "' — YAML parses it as a block sequence/mapping, not a string. Quote the value.")
      end
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
