# Agent Skills Specification (Reference)

This is the relevant subset of the [Agent Skills spec](https://agentskills.io/specification) for authoring skills in pi. Pi implements this standard and is lenient on a few rules — see the "Pi specifics" callouts.

## Directory structure

A skill is a directory containing, at minimum, a `SKILL.md` file:

```
skill-name/
├── SKILL.md          # Required: frontmatter + body
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation loaded on demand
├── assets/           # Optional: templates, resources
└── ...               # Any additional files or directories
```

Pi additionally supports single-file skills: in `~/.pi/agent/skills/` and `.pi/skills/`, a root-level `.md` file is discovered as an individual skill. Use a directory when you have scripts, references, or assets.

## SKILL.md format

YAML frontmatter (delimited by `---`) followed by markdown body.

### Allowed frontmatter fields

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | yes | 1-64 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphen, no consecutive hyphens |
| `description` | yes | 1-1024 chars, non-empty, no `<` or `>` |
| `license` | no | license name or reference to bundled file |
| `compatibility` | no | 1-500 chars, env requirements |
| `metadata` | no | arbitrary string key-value mapping |
| `allowed-tools` | no | space-separated pre-approved tools (experimental) |

Unknown fields are ignored by clients. Use `metadata:` for non-standard fields.

Pi-specific field (not in the upstream spec):

- `disable-model-invocation: true` — hides the skill from the system prompt; users invoke it explicitly via `/skill:name`

### name

- 1-64 characters
- Lowercase letters, digits, hyphens only
- No leading/trailing hyphen, no consecutive hyphens
- The standard requires the name to match the parent directory; **pi does not** (deliberately, for shared skill dirs)

Valid: `pdf-processing`, `data-analysis`, `code-review`, `roll-d20`
Invalid: `PDF-Processing`, `-pdf`, `pdf--processing`, `Roll_D20`

### description

- 1-1024 characters
- Non-empty, no angle brackets
- This is the primary trigger — describe both what the skill does and when to use it
- Include specific keywords, contexts, and "even if the user does not say X" callouts

Good:
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, merges
  multiple PDFs. Use when working with PDF documents, even if the user uploads
  a .pdf without explicitly saying "PDF" or asks to "read this report" (assume
  PDF when the file extension is .pdf).
```

Poor:
```yaml
description: Helps with PDFs.
```

### license

Recommended to be short. Either the SPDX name or a reference to a bundled file:

```yaml
license: Apache-2.0
```

```yaml
license: Proprietary. See LICENSE.txt.
```

### compatibility

Only include if the skill has specific environment requirements. 1-500 chars:

```yaml
compatibility: Requires Python 3.14+, uv, and network access for npm installs.
```

```yaml
compatibility: Designed for Claude Code, pi, or similar products.
```

### metadata

Arbitrary string-to-string map. Clients ignore unknown metadata; only use it for fields that downstream tools care about:

```yaml
metadata:
  author: example-org
  version: "1.0"
```

### allowed-tools

Space-separated list of pre-approved tools. Experimental; support varies. Pi respects this when set:

```yaml
allowed-tools: Read Write Edit Bash(git:*) Bash(jq:*)
```

## Body content

Freeform markdown. There are no format restrictions. Recommended sections:

- **Setup** — one-time install/config
- **Usage** — how to invoke, with examples
- **Gotchas** — non-obvious facts that defy reasonable assumptions
- **Output format** — template or worked example, not prose description
- **Validation** — how the model should check its own work

The full body loads whenever the skill activates. Aim for under 500 lines and 5,000 tokens. Move detail to `references/`.

## Optional directories

### scripts/

Executable code the model can run. Self-contained, with helpful errors. Common languages: Python, Bash, JavaScript. For pi, scripts must be runnable from `bash` and avoid interactive prompts.

### references/

Additional documentation the model reads when needed. Keep individual files focused. Include a table of contents for files over 300 lines. Reference from `SKILL.md` with one-level paths.

### assets/

Static resources: document templates, configuration templates, icons, lookup tables, schemas. The model reads these on demand when producing output.

## Progressive disclosure

The agent loads skills in three stages:

1. **Metadata** (~100 tokens) — `name` and `description`, always in context
2. **Instructions** (< 5,000 tokens recommended) — full `SKILL.md` body, loads when skill activates
3. **Resources** (as needed) — bundled files load only when the model reads them

This is the key to keeping many skills available without bloat. Structure your skill so each level only loads when the prior level is not enough.

## File references

When referencing bundled files, use **relative paths from the skill root**:

```markdown
See [the reference guide](references/REFERENCE.md) for details.

Run the extraction script:
scripts/extract.py
```

Keep references **one level deep** from `SKILL.md`. Avoid `references/foo/bar.md` chains.

## Validation

The bundled `scripts/validate.lua` covers the spec checks: SKILL.md exists, frontmatter parses, `name` and `description` valid, no unexpected fields. It is a portable single-file Lua script with no dependencies.

## Pi-specific notes

- **Name vs directory**: pi does not enforce that `name` matches the parent directory. The standard does. For pi-only skills, matching is cleaner; for cross-harness skills in `.agents/skills/`, name divergence is sometimes necessary.
- **Single-file skills**: a `.md` file directly in `~/.pi/agent/skills/` or `.pi/skills/` is treated as a skill. Use a directory when you have scripts/references/assets.
- **Skill commands**: `/skill:name` invokes a skill explicitly. The arguments after the command are appended to the skill body as `User: <args>`. Toggle in `~/.pi/agent/settings.json` via `enableSkillCommands`.
- **`disable-model-invocation`**: when set, the skill is hidden from the system prompt; only explicit `/skill:name` invocation loads it. Useful for skills that should not trigger automatically (e.g., the skill is destructive, or the user only wants it on demand).
- **Name collisions**: pi warns and keeps the first skill found. If two skills share a name across locations, the more local one wins (project > global > package > CLI).
- **Cross-harness sharing**: skills in `.agents/skills/` and `~/.agents/skills/` are loaded by Claude Code, Codex, and pi. Sticking to the standard spec is what makes this work.
