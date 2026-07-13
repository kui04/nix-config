# Optimizing Skill Descriptions

The `description` field is the primary mechanism agents use to decide whether to load a skill. An under-specified description means the skill will not trigger when it should; an over-broad description means it triggers when it should not.

This guide covers how to systematically test and improve descriptions for triggering accuracy.

## How triggering works

Pi uses [progressive disclosure](references/spec.md#progressive-disclosure). At startup, it loads only the `name` and `description` of each available skill. When a user's task matches a description, the agent reads the full `SKILL.md` into context and follows its instructions.

This means the description carries the entire burden of triggering. If the description does not convey when the skill is useful, the agent will not know to reach for it.

One nuance: agents typically only consult skills for tasks that require knowledge or capabilities beyond what they can handle alone. A simple, one-step request like "read this PDF" may not trigger a PDF skill even if the description matches perfectly, because the agent can handle it with basic tools. Tasks that involve specialized knowledge — an unfamiliar API, a domain-specific workflow, or an uncommon format — are where a well-written description makes the difference.

## Writing effective descriptions

Before testing, it helps to know what a good description looks like. A few principles:

- **Imperative phrasing.** Frame the description as an instruction to the agent: "Use this skill when..." rather than "This skill does..." The agent is deciding whether to act, so tell it when to act.
- **Focus on user intent, not implementation.** Describe what the user is trying to achieve, not the skill's internal mechanics. The agent matches against what the user asked for.
- **Err on the side of being pushy.** Explicitly list contexts where the skill applies, including cases where the user does not name the domain directly: "even if they do not explicitly mention 'CSV' or 'analysis'."
- **Keep it concise.** A few sentences to a short paragraph is usually right. The spec enforces a hard limit of 1024 characters.

## Designing trigger eval queries

To test triggering, you need a set of eval queries — realistic user prompts labeled with whether they should or should not trigger the skill.

```json eval_queries.json
[
  {
    "query": "I've got a spreadsheet in ~/data/q4_results.xlsx with revenue in col C and expenses in col D — can you add a profit margin column and highlight anything under 10%?",
    "should_trigger": true
  },
  {
    "query": "whats the quickest way to convert this json file to yaml",
    "should_trigger": false
  }
]
```

Aim for about 20 queries: 8-10 that should trigger and 8-10 that should not.

### Should-trigger queries

Test whether the description captures the skill's scope. Vary them along several axes:

- **Phrasing**: some formal, some casual, some with typos or abbreviations
- **Explicitness**: some name the skill's domain directly ("analyze this CSV"), others describe the need without naming it ("my boss wants a chart from this data file")
- **Detail**: mix terse prompts with context-heavy ones — a short "analyze my sales CSV and make a chart" alongside a longer message with file paths, column names, and backstory
- **Complexity**: vary the number of steps and decision points. Include single-step tasks alongside multi-step workflows to test whether the agent can discern the skill is relevant when the task it addresses is buried in a larger chain

The most useful should-trigger queries are ones where the skill would help but the connection is not obvious from the query alone. If the query already asks for exactly what the skill does, any reasonable description will trigger.

### Should-not-trigger queries

The most valuable negative test cases are **near-misses** — queries that share keywords or concepts with the skill but actually need something different. These test whether the description is precise, not just broad.

For a CSV analysis skill, weak negative examples would be:

- `"Write a fibonacci function"` — obviously irrelevant, tests nothing
- `"What's the weather today?"` — no keyword overlap, too easy

Strong negative examples:

- `"I need to update the formulas in my Excel budget spreadsheet"` — shares "spreadsheet" and "data" concepts, but needs Excel editing, not CSV analysis
- `"can you write a python script that reads a csv and uploads each row to our postgres database"` — involves CSV, but the task is database ETL, not analysis

The key thing to avoid: do not make should-not-trigger queries obviously irrelevant. "Write a fibonacci function" as a negative test for a PDF skill is too easy — it does not test anything. The negative cases should be genuinely tricky.

### Tips for realism

Real user prompts contain context that generic test queries lack. Include:

- File paths (`~/Downloads/report_final_v2.xlsx`)
- Personal context (`"my manager asked me to..."`)
- Specific details (column names, company names, data values)
- Casual language, abbreviations, occasional typos

## Testing whether a description triggers

The basic approach: run each query through pi with the skill installed and observe whether the agent invokes it. Make sure the skill is registered and discoverable — how this works varies by client.

In pi, the easiest way is to run the agent in a non-interactive session with `--print` (or `-p`) and observe whether the skill's body is loaded. If pi prints something like "Loaded skill: my-skill" or includes a `<skill>` block in the transcript, the skill triggered.

```bash
# Check if the skill triggers
pi -p "I've got a spreadsheet in ~/data/q4_results.xlsx with revenue in col C..."

# Or invoke explicitly to compare
pi -p "/skill:my-skill I've got a spreadsheet in ~/data/q4_results.xlsx..."
```

Most agent clients provide some form of observability — execution logs, tool call histories, or verbose output — that lets you see which skills were consulted during a run. Check your client's documentation for details. The skill triggered if the agent loaded your skill's `SKILL.md`; it did not trigger if the agent proceeded without consulting it.

A query "passes" if:

- `should_trigger` is `true` and the skill was invoked, or
- `should_trigger` is `false` and the skill was not invoked

### Running multiple times

Model behavior is non-deterministic — the same query might trigger the skill on one run but not the next. Run each query multiple times (3 is a reasonable starting point) and compute a **trigger rate**: the fraction of runs where the skill was invoked.

A should-trigger query passes if its trigger rate is above a threshold (0.5 is a reasonable default). A should-not-trigger query passes if its trigger rate is below that threshold.

With 20 queries at 3 runs each, that is 60 invocations. You will want to script this. See [Trigger eval driver](#trigger-eval-driver) below for a bash template.

## Avoiding overfitting with train/validation splits

If you optimize the description against all your queries, you risk overfitting — crafting a description that works for these specific phrasings but fails on new ones.

The solution is to split your query set:

- **Train set (~60%)**: the queries you use to identify failures and guide improvements
- **Validation set (~40%)**: queries you set aside and only use to check whether improvements generalize

Make sure both sets contain a proportional mix of should-trigger and should-not-trigger queries — do not accidentally put all the positives in one set. Shuffle randomly and keep the split fixed across iterations so you are comparing apples to apples.

## The optimization loop

1. **Evaluate** the current description on both *train and validation* sets. The train results guide your changes; the validation results tell you whether those changes are generalizing.
2. **Identify failures in the train set**: which should-trigger queries did not trigger? Which should-not-trigger queries did?
   - Only use train set failures to guide your changes — whether you are revising the description yourself or prompting an LLM, keep validation set results out of the process.
3. **Revise the description.** Focus on generalizing:
   - If should-trigger queries are failing, the description may be too narrow. Broaden the scope or add context about when the skill is useful.
   - If should-not-trigger queries are false-triggering, the description may be too broad. Add specificity about what the skill does *not* do, or clarify the boundary between this skill and adjacent capabilities.
   - Avoid adding specific keywords from failed queries — that is overfitting. Instead, find the general category or concept those queries represent and address that.
   - If you are stuck after several iterations, try a structurally different approach to the description rather than incremental tweaks. A different framing or sentence structure may break through where refinement cannot.
   - Check that the description stays under the 1024-character limit — descriptions tend to grow during optimization.
4. **Repeat** steps 1-3 until all *train set* queries pass or you stop seeing meaningful improvement.
5. **Select the best iteration** by its validation pass rate — the fraction of queries in the *validation set* that passed. The best description may not be the last one you produced; an earlier iteration might have a higher validation pass rate than later ones that overfit to the train set.

Five iterations is usually enough. If performance is not improving, the issue may be with the queries (too easy, too hard, or poorly labeled) rather than the description.

## Applying the result

Once you have selected the best description:

1. Update the `description` field in your `SKILL.md` frontmatter
2. Verify the description is under the 1024-character limit
3. Verify the description triggers as expected. Try a few prompts manually as a quick sanity check. For a more rigorous test, write 5-10 fresh queries (a mix of should-trigger and should-not-trigger) and run them through the eval — since these queries were never part of the optimization process, they give an honest check on whether the description generalizes.

```yaml
# Before
description: Process CSV files.

# After
description: >
  Analyze CSV and tabular data files — compute summary statistics,
  add derived columns, generate charts, and clean messy data. Use this
  skill when the user has a CSV, TSV, or Excel file and wants to
  explore, transform, or visualize the data, even if they don't
  explicitly mention "CSV" or "analysis."
```

The improved description is more specific about what the skill does (summary stats, derived columns, charts, cleaning) and broader about when it applies (CSV, TSV, Excel; even without explicit keywords).

## Trigger eval driver

A minimal bash driver. Replace the `pi -p` invocation and detection logic with whatever your client provides. The detection in the example assumes pi prints `Loaded skill: <name>` somewhere in the transcript; adapt to your client's log format.

```bash
#!/bin/bash
# trigger_eval.sh — measure skill trigger rate on a query set
#
# Usage: ./trigger_eval.sh <queries.json> <skill-name> [runs]

set -euo pipefail
QUERIES_FILE="${1:?Usage: $0 <queries.json> <skill-name> [runs]}"
SKILL_NAME="${2:?Usage: $0 <queries.json> <skill-name> [runs]}"
RUNS="${3:-3}"

# Returns 0 (triggered) or 1 (not triggered).
# Adapt the grep pattern to your client's log format.
check_triggered() {
  local query="$1"
  pi -p "$query" 2>&1 | grep -q "Loaded skill: ${SKILL_NAME}"
}

count=$(jq length "$QUERIES_FILE")
for i in $(seq 0 $((count - 1))); do
  query=$(jq -r ".[$i].query" "$QUERIES_FILE")
  should_trigger=$(jq -r ".[$i].should_trigger" "$QUERIES_FILE")
  triggers=0

  for run in $(seq 1 "$RUNS"); do
    if check_triggered "$query"; then
      triggers=$((triggers + 1))
    fi
  done

  jq -n \
    --arg query "$query" \
    --argjson should_trigger "$should_trigger" \
    --argjson triggers "$triggers" \
    --argjson runs "$RUNS" \
    '{query: $query, should_trigger: $should_trigger, triggers: $triggers, runs: $runs, trigger_rate: ($triggers / $runs)}'
done | jq -s '.'
```

Run on train and validation splits separately. Pick the iteration with the highest **validation** pass rate, not the highest train rate.
