# Tooling: compatibility, configuration, migration

## One AGENTS.md works across many agents

AGENTS.md is an open format stewarded by the Agentic AI Foundation (Linux
Foundation). It emerged from a collaboration across the ecosystem — OpenAI Codex,
Amp, Jules (Google), Cursor, and Factory — and is read natively by a growing set of
agents and tools, including (per agents.md at time of writing):

Codex (OpenAI) · Amp · Jules (Google) · Cursor · Factory · RooCode · Aider ·
Gemini CLI (Google) · goose · Kilo Code · opencode · Phoenix · Zed · Semgrep ·
Warp · GitHub Copilot coding agent · VS Code · Ona · Devin (Cognition) ·
Windsurf (Cognition) · UiPath Autopilot & Coded Agents · Augment Code ·
Junie (JetBrains)

Most of these pick up `AGENTS.md` automatically. Two popular tools need a one-line
configuration:

### Aider

In `.aider.conf.yml`:

```yaml
read: AGENTS.md
```

### Gemini CLI

In `.gemini/settings.json`:

```json
{
  "context": {
    "fileName": "AGENTS.md"
  }
}
```

## Precedence and conflict resolution

- Agents read the **nearest** AGENTS.md in the directory tree above the file being
  edited. In a monorepo, the package-level file overrides the root file for files
  inside that package.
- **Explicit user chat prompts override everything.** AGENTS.md sets defaults and
  context; it cannot (and should not try to) override the user's direct instruction.
- If instructions within the file conflict, keep the more specific rule closer to
  the code it governs (nested file), not buried in the root file.

## Migrating existing files

### From `AGENT.md` (or other singular/legacy names)

Rename and leave a symlink for backward compatibility with tools that still look
for the old name:

```bash
mv AGENT.md AGENTS.md && ln -s AGENTS.md AGENT.md
```

### From tool-specific rule files

Tools that predate the standard keep their own files — `.cursorrules`,
`.windsurfrules`, `.github/copilot-instructions.md`, `CLAUDE.md`, `.goosehints`.
Recommended consolidation:

1. Move the tool-agnostic content (commands, style, conventions) into `AGENTS.md`.
2. Keep tool-specific files only for behavior genuinely tied to that tool, and
   replace the rest with a pointer or symlink to `AGENTS.md` where the tool
   supports it (e.g. `ln -s AGENTS.md CLAUDE.md` for Claude Code, `ln -s
   ../AGENTS.md .github/copilot-instructions.md` for Copilot — verify the tool
   follows symlinks first).
3. Don't delete a tool-specific file until you've confirmed that tool reads
   `AGENTS.md` in your version — support landed at different times.

## Placement checklist

- [ ] Root `AGENTS.md` committed at the repository root (exact name, plural).
- [ ] Monorepo: one nested `AGENTS.md` per package that needs tailored
      instructions; shared context stays in the root file.
- [ ] Symlinks (if any) committed and relative, so they work on fresh clones.
- [ ] Aider / Gemini CLI users have the config snippets above in their local
      config (these files are usually user-level, not committed — mention them in
      the project docs instead of forcing them into the repo).
