# Evaluating Skill Output Quality

You wrote a skill, tried it on a prompt, and it seemed to work. But does it work reliably — across varied prompts, in edge cases, better than no skill at all? Running structured evaluations (evals) answers these questions and gives you a feedback loop for improving the skill systematically.

This guide focuses on the practical eval loop without sub-agents. Pi's default coding agent runs sequentially, so test prompts are run one at a time rather than in parallel.

## Designing test cases

A test case has three parts:

- **Prompt**: a realistic user message — the kind of thing someone would actually type
- **Expected output**: a human-readable description of what success looks like
- **Input files** (optional): files the skill needs to work with

Store test cases in `evals/evals.json` inside your skill directory:

```json evals/evals.json
{
  "skill_name": "csv-analyzer",
  "evals": [
    {
      "id": 1,
      "prompt": "I have a CSV of monthly sales data in data/sales_2025.csv. Can you find the top 3 months by revenue and make a bar chart?",
      "expected_output": "A bar chart image showing the top 3 months by revenue, with labeled axes and values.",
      "files": ["evals/files/sales_2025.csv"]
    },
    {
      "id": 2,
      "prompt": "there's a csv in my downloads called customers.csv, some rows have missing emails — can you clean it up and tell me how many were missing?",
      "expected_output": "A cleaned CSV with missing emails handled, plus a count of how many were missing.",
      "files": ["evals/files/customers.csv"]
    }
  ]
}
```

### Tips for writing good test prompts

- **Start with 2-3 test cases.** Do not over-invest before you have seen your first round of results. Expand later.
- **Vary the prompts.** Use different phrasings, levels of detail, and formality. Some prompts should be casual ("hey can you clean up this csv"), others precise ("Parse the CSV at data/input.csv, drop rows where column B is null, and write the result to data/output.csv").
- **Cover edge cases.** Include at least one prompt that tests a boundary condition — a malformed input, an unusual request, or a case where the skill's instructions might be ambiguous.
- **Use realistic context.** Real users mention file paths, column names, and personal context. Prompts like "process this data" are too vague to test anything useful.

Do not worry about defining specific pass/fail checks yet — just the prompts and expected outputs. You will add detailed checks (called assertions) after you see what the first run produces.

## Running evals

The core pattern: run each test case twice — once **with the skill** and once **without it** (or with a previous version). This gives you a baseline to compare against.

### Workspace structure

Organize eval results in a workspace directory alongside your skill directory. Each pass through the full eval loop gets its own `iteration-N/` directory. Within that, each test case gets an eval directory with `with_skill/` and `without_skill/` subdirectories:

```
csv-analyzer/
├── SKILL.md
└── evals/
    └── evals.json
csv-analyzer-workspace/
└── iteration-1/
    ├── eval-top-months-chart/
    │   ├── with_skill/
    │   │   ├── outputs/       # Files produced by the run
    │   │   └── timing.json    # Wall clock duration
    │   └── without_skill/
    │       ├── outputs/
    │       └── timing.json
    ├── eval-clean-missing-emails/
    │   ├── with_skill/
    │   │   ├── outputs/
    │   │   └── timing.json
    │   └── without_skill/
    │       ├── outputs/
    │       └── timing.json
    └── benchmark.md            # Aggregated pass rates and notes
```

### Running test prompts

In pi, run each test prompt through the model with the skill loaded and save the outputs. There are two practical approaches:

**Option 1: Interactive session.** Use `/skill:<name>` to load the skill explicitly, run the prompt, save the outputs. Good for manual iteration and human review.

**Option 2: Print mode.** Run `pi -p "/skill:<name> <prompt>"` and capture the output. Good for scripted evals. Pass `--output-format json` for structured output:

```bash
mkdir -p csv-analyzer-workspace/iteration-1/eval-top-months-chart/with_skill/outputs
pi -p "/skill:csv-analyzer I have a CSV of monthly sales data in data/sales_2025.csv..." \
  > csv-analyzer-workspace/iteration-1/eval-top-months-chart/with_skill/outputs/transcript.txt 2>&1
```

For the baseline (no skill), omit the `/skill:` prefix:

```bash
mkdir -p csv-analyzer-workspace/iteration-1/eval-top-months-chart/without_skill/outputs
pi -p "I have a CSV of monthly sales data in data/sales_2025.csv..." \
  > csv-analyzer-workspace/iteration-1/eval-top-months-chart/without_skill/outputs/transcript.txt 2>&1
```

When improving an existing skill, snapshot the old version and run the baseline against it:

```bash
cp -r csv-analyzer csv-analyzer-workspace/skill-snapshot
# Point the baseline at the snapshot by referencing its SKILL.md path explicitly
pi -p "..." --skill csv-analyzer-workspace/skill-snapshot \
  > csv-analyzer-workspace/iteration-1/eval-top-months-chart/old_skill/outputs/transcript.txt
```

### Capturing timing

When each run completes, record the wall clock duration. A simple `time` wrapper is enough for early iterations:

```bash
{ time pi -p "..." > outputs/transcript.txt; } 2> outputs/timing.json
```

For more rigor, parse pi's JSON output for `total_tokens` and `duration_ms`. These let you compare how much time and tokens the skill costs relative to the baseline — a skill that dramatically improves output quality but triples token usage is a different trade-off than one that is both better and cheaper.

## Writing assertions

Assertions are verifiable statements about what the output should contain or achieve. Add them after you see your first round of outputs — you often do not know what "good" looks like until the skill has run.

Good assertions:

- `"The output file is valid JSON"` — programmatically verifiable
- `"The bar chart has labeled axes"` — specific and observable
- `"The report includes at least 3 recommendations"` — countable

Weak assertions:

- `"The output is good"` — too vague to grade
- `"The output uses exactly the phrase 'Total Revenue: $X'"` — too brittle; correct output with different wording would fail

Not everything needs an assertion. Some qualities — writing style, visual design, whether the output "feels right" — are hard to decompose into pass/fail checks. These are better caught during [human review](#reviewing-results-with-a-human). Reserve assertions for things that can be checked objectively.

Add assertions to each test case in `evals/evals.json`:

```json evals/evals.json
{
  "skill_name": "csv-analyzer",
  "evals": [
    {
      "id": 1,
      "prompt": "I have a CSV of monthly sales data in data/sales_2025.csv. Can you find the top 3 months by revenue and make a bar chart?",
      "expected_output": "A bar chart image showing the top 3 months by revenue, with labeled axes and values.",
      "files": ["evals/files/sales_2025.csv"],
      "assertions": [
        "The output includes a bar chart image file",
        "The chart shows exactly 3 months",
        "Both axes are labeled",
        "The chart title or caption mentions revenue"
      ]
    }
  ]
}
```

## Grading outputs

Grading means evaluating each assertion against the actual outputs and recording **PASS** or **FAIL** with specific evidence. The evidence should quote or reference the output, not just state an opinion.

The simplest approach is to give the outputs and assertions to the model and ask it to evaluate each one. For assertions that can be checked by code (valid JSON, correct row count, file exists with expected dimensions), use a verification script — scripts are more reliable than model judgment for mechanical checks and reusable across iterations.

Save the result for each run as `grading.json`:

```json grading.json
{
  "assertion_results": [
    {
      "text": "The output includes a bar chart image file",
      "passed": true,
      "evidence": "Found chart.png (45KB) in outputs directory"
    },
    {
      "text": "The chart shows exactly 3 months",
      "passed": true,
      "evidence": "Chart displays bars for March, July, and November"
    },
    {
      "text": "Both axes are labeled",
      "passed": false,
      "evidence": "Y-axis is labeled 'Revenue ($)' but X-axis has no label"
    }
  ],
  "summary": {
    "passed": 3,
    "failed": 1,
    "total": 4,
    "pass_rate": 0.75
  }
}
```

### Grading principles

- **Require concrete evidence for a PASS.** Do not give the benefit of the doubt. If an assertion says "includes a summary" and the output has a section titled "Summary" with one vague sentence, that is a FAIL — the label is there but the substance is not.
- **Review the assertions themselves, not just the results.** While grading, notice when assertions are too easy (always pass regardless of skill quality), too hard (always fail even when the output is good), or unverifiable (cannot be checked from the output alone). Fix these for the next iteration.

## Aggregating results

Once every run in the iteration is graded, write a short `benchmark.md` summarizing pass rates per configuration:

```markdown
# Iteration 1 — csv-analyzer

| Configuration | Pass rate | Mean time | Mean tokens |
|---------------|-----------|-----------|-------------|
| with_skill    | 0.83 (5/6) | 45.0s    | 3800        |
| without_skill | 0.33 (2/6) | 32.0s    | 2100        |
| delta         | +0.50     | +13.0s   | +1700       |

## Per-eval breakdown

- **eval-top-months-chart** (with_skill): 4/4 passed
- **eval-top-months-chart** (without_skill): 2/4 passed (missing axis labels)
- **eval-clean-missing-emails** (with_skill): 4/4 passed
- **eval-clean-missing-emails** (without_skill): 0/4 passed (no cleanup performed)
```

The `delta` tells you what the skill costs (more time, more tokens) and what it buys (higher pass rate). A skill that adds 13 seconds but improves pass rate by 50 percentage points is probably worth it. A skill that doubles token usage for a 2-point improvement might not be.

Standard deviation (`stddev`) is only meaningful with multiple runs per eval. In early iterations with 2-3 test cases and single runs, focus on the raw pass counts and the delta — the statistical measures become useful as you expand the test set and run each eval multiple times.

## Analyzing patterns

Aggregate statistics can hide important patterns. After computing the benchmarks:

- **Remove or replace assertions that always pass in both configurations.** These do not tell you anything useful — the model handles them fine without the skill. They inflate the with-skill pass rate without reflecting actual skill value.
- **Investigate assertions that always fail in both configurations.** Either the assertion is broken (asking for something the model cannot do), the test case is too hard, or the assertion is checking for the wrong thing. Fix these before the next iteration.
- **Study assertions that pass with the skill but fail without.** This is where the skill is clearly adding value. Understand *why* — which instructions or scripts made the difference?
- **Tighten instructions when results are inconsistent across runs.** If the same eval passes sometimes and fails others, the eval may be flaky (sensitive to model randomness), or the skill's instructions may be ambiguous enough that the model interprets them differently each time. Add examples or more specific guidance to reduce ambiguity.
- **Check time and token outliers.** If one eval takes 3x longer than the others, read its transcript to find the bottleneck.

## Reviewing results with a human

Assertion grading and pattern analysis catch a lot, but they only check what you thought to write assertions for. A human reviewer brings a fresh perspective — catching issues you did not anticipate, noticing when the output is technically correct but misses the point, or spotting problems that are hard to express as pass/fail checks. For each test case, review the actual outputs alongside the grades.

Record specific feedback for each test case as you go. A simple `feedback.json` per iteration works:

```json feedback.json
{
  "eval-top-months-chart": "The chart is missing axis labels and the months are in alphabetical order instead of chronological.",
  "eval-clean-missing-emails": ""
}
```

"The chart is missing axis labels" is actionable; "looks bad" is not. Empty feedback means the output looked fine — that test case passed your review. During the iteration step, focus your improvements on the test cases where you had specific complaints.

## Iterating on the skill

After grading and reviewing, you have three sources of signal:

- **Failed assertions** point to specific gaps — a missing step, an unclear instruction, or a case the skill does not handle
- **Human feedback** points to broader quality issues — the approach was wrong, the output was poorly structured, or the skill produced a technically correct but unhelpful result
- **Execution transcripts** reveal *why* things went wrong. If the model ignored an instruction, the instruction may be ambiguous. If the model spent time on unproductive steps, those instructions may need to be simplified or removed.

The most effective way to turn these signals into skill improvements is to give all three — along with the current `SKILL.md` — to the model and ask it to propose changes. The model can synthesize patterns across failed assertions, reviewer complaints, and transcript behavior that would be tedious to connect manually. When prompting, include these guidelines:

- **Generalize from feedback.** The skill will be used across many different prompts, not just the test cases. Fixes should address underlying issues broadly rather than adding narrow patches for specific examples.
- **Keep the skill lean.** Fewer, better instructions often outperform exhaustive rules. If transcripts show wasted work (unnecessary validation, unneeded intermediate outputs), remove those instructions. If pass rates plateau despite adding more rules, the skill may be over-constrained — try removing instructions and see if results hold or improve.
- **Explain the why.** Reasoning-based instructions ("Do X because Y tends to cause Z") work better than rigid directives ("ALWAYS do X, NEVER Y"). Models follow instructions more reliably when they understand the purpose.
- **Bundle repeated work.** If every test run independently wrote a similar helper script (a chart builder, a data parser), that is a signal to bundle the script into the skill's `scripts/` directory.

### The loop

1. Give the eval signals and current `SKILL.md` to the model and ask it to propose improvements
2. Review and apply the changes
3. Rerun all test cases in a new `iteration-<N+1>/` directory
4. Grade and aggregate the new results
5. Review with a human. Repeat.

Stop when you are satisfied with the results, feedback is consistently empty, or you are no longer seeing meaningful improvement between iterations.
