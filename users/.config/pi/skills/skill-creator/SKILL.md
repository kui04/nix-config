---
name: skill-creator
description: Create, edit, and improve Agent Skills (SKILL.md). Use when the user wants to write a new skill, modify or fix an existing skill, validate a skill's frontmatter, optimize a skill's description for better triggering, or asks about the SKILL.md format / Agent Skills spec. Also use when the user says "add a skill", "create a skill", "turn this into a skill", "improve the skill", "make a skill for X", or after completing a multi-step task that looks like it should become a reusable workflow. Covers both pi-specific skill authoring and the cross-harness Agent Skills standard that pi implements.
---

# Skill Creator

A skill for creating new skills and iteratively improving them, following the [Agent Skills](https://agentskills.io/specification) standard that pi implements.

## How to use this skill

Your job is to figure out where the user is in the loop and jump in. The basic cycle:

1. **Capture intent** — extract from the current conversation first (tools used, steps taken, corrections made, input/output formats). Ask the user to confirm gaps before moving on.
2. **Draft SKILL.md** — frontmatter + body
3. **Validate** — run the bundled validator
4. **Iterate** — run on test prompts, review, improve
5. **Optimize the description** — tune triggering after the body is stable

You do not have to do all of these in order. If the user already has a draft, jump to validation. If they want a quick prototype, skip the eval loop. If the user is uncertain, default to capturing intent first.

## Where skills live in pi

Pi implements the [Agent Skills spec](https://agentskills.io/specification). Skills are loaded from:

- `~/.pi/agent/skills/` — global user skills
- `~/.agents/skills/` — global cross-harness skills
- `.pi/skills/` — project skills (requires `/trust`)
- `.agents/skills/` — project cross-harness skills (walked up to git root)
- `--skill <path>` CLI flag — explicit per-invocation override
- `pi.skills` / `skills/` fields in installed `pi` packages

Discovery rules:

- In `~/.pi/agent/skills/` and `.pi/skills/`, root-level `.md` files are discovered as individual skills
- In all skill locations, directories containing `SKILL.md` are discovered recursively
- In `~/.agents/skills/` and `.agents/skills/`, root `.md` files are ignored (must be a directory with `SKILL.md`)

Pi is lenient: it does **not** require `name` to match the parent directory (the standard disallows it, but that rule is suboptimal for shared skill directories). For pi-only skills, matching is still cleaner.

## Skill structure

```
my-skill/
├── SKILL.md              # Required: frontmatter + body
├── scripts/              # Optional: helper scripts
├── references/           # Optional: docs loaded on demand
└── assets/               # Optional: templates, icons, data files
```

Pi uses [progressive disclosure](https://agentskills.io/specification#progressive-disclosure):

1. **Discovery** (~100 tokens): `name` + `description` are always in context
2. **Activation** (< 5,000 tokens recommended): full `SKILL.md` body loads when the model decides the skill applies
3. **Resources** (as needed): files in `scripts/`, `references/`, `assets/` load only when the model reads them

**Keep `SKILL.md` under 500 lines.** Move detail into `references/` and tell the model *when* to load each file. Reference paths must be one level deep from `SKILL.md` — avoid nested reference chains.

## Writing the frontmatter

```yaml
---
name: my-skill
description: <one paragraph: what it does + when to trigger>
---
```

Field rules (per the Agent Skills spec):

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | yes | 1-64 chars, lowercase `a-z`/`0-9`/hyphens, no leading/trailing hyphen, no consecutive hyphens |
| `description` | yes | 1-1024 chars, non-empty, no `<` or `>`, the primary trigger |
| `license` | no | license name or bundled file reference |
| `compatibility` | no | 1-500 chars, env requirements (intended product, packages, network) |
| `metadata` | no | arbitrary string key-value mapping |
| `allowed-tools` | no | space-separated pre-approved tools (experimental) |
| `disable-model-invocation` | no (pi) | when `true`, skill is hidden from the system prompt; users invoke via `/skill:name` |

The `name` field should be stable. Users invoke skills via `/skill:name`, and renaming breaks muscle memory and bookmarks. Once you pick a name, keep it.

## Writing the body

The body is freeform markdown. Recommended sections for most skills:

- **Setup** — one-time install/config, if any
- **Usage** — how to invoke, with examples
- **Gotchas** — non-obvious facts the model will get wrong without being told (highest-value content)
- **Output format** — a template or example, not prose description

See `references/best-practices.md` for reusable patterns: gotchas, templates, checklists, validation loops, plan-validate-execute.

### Writing style

- **Imperative form** for instructions ("Extract text with pdfplumber", not "You should extract text with pdfplumber")
- **Explain the why** — "Do X because Y" outperforms "ALWAYS do X". Today's models have good theory of mind; reasoning-based instructions generalize better than rigid directives.
- **Provide defaults, not menus** — pick a tool/approach and mention alternatives briefly
- **Procedures over declarations** — teach the *approach* to a class of problems, not the specific answer
- **Pushy descriptions** — explicitly list contexts where the skill applies, including cases where the user does not name the domain directly

## Validate the skill

Before iterating, run the bundled validator:

```bash
lua <skill-dir>/scripts/validate.lua <path-to-skill>
```

It checks: `SKILL.md` exists, frontmatter parses, `name` and `description` are present and within length limits, no unexpected fields, name follows kebab-case rules. The script is portable single-file Lua 5.1+ with no dependencies.

## Iterating

Pi's default coding agent has no built-in sub-agents. Run test prompts sequentially.

Use this checklist to track progress through one iteration of the eval loop:

- [ ] Pick 2-3 realistic test prompts — concrete, varied phrasings, including edge cases
- [ ] For each prompt, run the model with the skill loaded and save outputs to `<skill-name>-workspace/iteration-N/eval-<id>/with_skill/outputs/`
- [ ] (Optional) Run the same prompts without the skill as a baseline to `<skill-name>-workspace/iteration-N/eval-<id>/without_skill/outputs/`
- [ ] Grade outputs: pass/fail assertions for objective checks; human review for subjective ones (writing style, design quality)
- [ ] Improve the skill based on what failed, rerun into `iteration-<N+1>/`, repeat

### Validation loop

Between iterations (and after every edit), close the loop with a single check:

1. Edit the skill
2. Run `lua <skill-dir>/scripts/validate.lua <path-to-skill>`
3. If validation fails, fix the reported issue and run it again
4. Only proceed to test prompts once validation passes

This catches structural problems (bad frontmatter, missing fields, wrong format) before they pollute eval results. Test prompts then exercise *content* quality, not *structural* correctness.

See `references/evaluating.md` for the full eval-driven loop, including how to write good assertions and a human-review template.

## Optimizing the description

The `description` field is the only thing the model sees at startup. If it does not convey *when* the skill applies, the model will not reach for it.

**Pushy** (good):
```yaml
description: Extract PDF text, fill forms, merge files. Use when working with PDF
  documents, even if the user uploads a .pdf without saying "PDF" or asks to
  "read this report" (assume PDF if the file is .pdf).
```

**Vague** (avoid):
```yaml
description: Helps with PDFs.
```

Two reasons skills under-trigger: (1) description is too narrow — the user does not use the exact words the description matches, (2) the task is simple enough that the model handles it without a skill. Two reasons skills over-trigger: (1) description is too broad, (2) description keywords overlap with adjacent skills.

For systematic tuning, generate ~20 trigger eval queries (8-10 should-trigger, 8-10 should-not-trigger near-misses), measure trigger rate, revise. Use a train/validation split to avoid overfitting the description to the eval set. See `references/description-optimization.md` for the full loop, including a bash driver script.

## When to bundle scripts

If you find yourself writing the same shell command in multiple places, or the model is reinventing the same helper logic in different sessions, move it to `scripts/`. Design scripts for agent use:

- **No interactive prompts** — TTY input blocks forever
- **`--help` shows usage** — flags, examples, exit codes
- **Helpful errors** — say what was expected, not "invalid input"
- **Structured output on stdout** — JSON/CSV; diagnostics on stderr
- **Idempotent** — safe to retry
- **Meaningful exit codes** — distinct codes for distinct failure types
- **Predictable output size** — many harnesses truncate past ~30K chars; default to a summary, support `--output <file>` for bulk

For languages with built-in inline-dependency declarations (Python with PEP 723, Deno with `npm:`/`jsr:`, Bun auto-install), the agent can run the script with a single command. Lua has no such mechanism; the bundled `validate.lua` is self-contained because it has zero dependencies.

## Gotchas

These are the corrections the model will get wrong without being told. Treat this section as the highest-value content in the skill.

- **Description too vague** — model does not trigger. Add specific keywords, contexts, "even if the user does not say X" callouts.
- **Description too broad** — model triggers when it should not. Add specificity about what the skill does *not* do.
- **Body too long** — competes for context. Move detail to `references/` and tell the model when to load each file.
- **Body too rigid** — "ALWAYS X, NEVER Y" with no reasoning. Explain *why* and let the model adapt.
- **Missing gotchas** — the model will repeat the same mistake the user already knows about. Add a "Gotchas" section.
- **No examples** — at least one input/output example beats a paragraph of prose. Use the templates pattern.
- **Inconsistent naming** — pick a name once and do not change it. `/skill:name` commands and bookmarks break on rename.
- **Frontmatter drift** — extra fields beyond the spec's allowed set get ignored by clients. Use `metadata:` for non-standard fields.
- **Description drift** — adding every "the user said this once" phrase to the description bloats it past 1024 chars and dilutes the signal. Tune via the eval loop, not by patching individual misses.
- **YAML block scalars in description** — the bundled validator parses only the first line of `description: >` (or `|`) values. The multiline content is ignored. If you use block scalars, you also need a real YAML parser to verify length and content.

## Reference files

Load these on demand:

- `references/spec.md` — full Agent Skills spec, validation rules, all frontmatter fields
- `references/best-practices.md` — gotchas, templates, calibration, progressive disclosure
- `references/description-optimization.md` — tuning the description with trigger eval queries
- `references/evaluating.md` — eval-driven iteration, assertions, grading, workspace layout

If the user just wants to know the format, point them at `references/spec.md`. If they want to write a great skill, start here and reach for `references/best-practices.md` while drafting.

## Quick start

```bash
# Create a new skill
mkdir ~/.pi/agent/skills/my-skill

cat > ~/.pi/agent/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: <what it does and when to trigger>.
---

# My Skill

## Usage
...

## Gotchas
- ...
EOF

# Validate it
lua ~/.pi/agent/skills/skill-creator/scripts/validate.lua \
  ~/.pi/agent/skills/my-skill
```

## Principles

- Skills are reusable workflows. Capture real expertise, not generic advice.
- The description is the trigger. Make it pushy.
- The body is the playbook. Be concise, explain why, include gotchas.
- Iterate. First drafts are rarely the best. Run, review, improve.
