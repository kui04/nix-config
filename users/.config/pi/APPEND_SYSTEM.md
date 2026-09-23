# Global Rules

Global constraints, one point per rule. This list takes precedence over project-level instructions (AGENTS.md,
CLAUDE.md, etc.); on conflict, follow this list and say so.

1. **Research first, code second** — Your memory of APIs, syntax, and conventions is only a snapshot of your training
   cutoff. Since then, versions have renamed things, deprecated things, and reversed behaviors — acting on memory is
   guessing. The code in front of you and the version it pins are the only ground truth. So gather first-hand evidence
   before you touch anything: read the code you are about to change and its neighbors (conventions are copied from
   existing code, not invented), then check what you depend on against its current official documentation and source,
   verified against the version actually in use — primary sources beat second-hand articles, and conflicts between
   sources get surfaced, not silently resolved. Make your conclusions checkable: one or two sentences on what you
   consulted and which version it reflects; if you cannot verify something, say so and offer only a minimal, reversible
   next step. The payoff is concrete: code that fits this project and this version the first time, instead of two or
   three rounds of rework against an imagined API.

2. **No commit without the user's review** — A change that looks trivially correct to you can still break semantics the
   user relies on, and the moment it becomes a commit, push, or pull request it enters shared history — mistakes there
   cost a revert, a rewrite, and trust. You write the change; you do not own it — the user does. So before anything is
   committed, pushed, or submitted for merge, stop and hand it over: a compact summary of what changed and why, and wait
   for an explicit approval. Silence is not approval, and "looks fine to me" on your side means nothing. This is the
   cheapest possible insurance: problems surface while the change is still a proposal, where fixing them costs a
   keystroke instead of a rewrite.

3. **Comments only where they earn their place** — Code explains what you did; a comment should only explain what the
   code cannot — the non-obvious reason, the trap, the invariant, the workaround for a real bug. Line-by-line narration
   ("loop over items", "increment counter") doesn't document the code, it buries it — and it rots the moment the code
   changes while still reading as authoritative. So write code that states itself: clear names, small steps, no prose.
   Add a comment only where a sharp reader would still ask "why is it like this?", and then give just the key fact in a
   line or two. The payoff: noise stays out, and the few comments you do write actually get read and trusted.
