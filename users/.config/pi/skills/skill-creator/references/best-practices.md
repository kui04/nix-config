# Best Practices for Skill Authors

How to write skills that are well-scoped, calibrated to the task, and not overfit to specific examples.

## Start from real expertise

The most common pitfall is asking the model to generate a skill without providing domain-specific context. The result is vague, generic procedures ("handle errors appropriately", "follow best practices for authentication") rather than the specific API patterns, edge cases, and project conventions that make a skill valuable.

Two ways to seed real expertise:

### Extract from a hands-on task

Complete a real task in conversation with the model — providing context, corrections, and preferences along the way. Then extract the reusable pattern into a skill. Pay attention to:

- **Steps that worked** — the sequence of actions that led to success
- **Corrections you made** — places where you steered the model's approach (e.g., "use library X instead of Y", "check for edge case Z")
- **Input/output formats** — what the data looked like going in and coming out
- **Context you provided** — project-specific facts, conventions, or constraints the model did not already know

### Synthesize from existing project artifacts

When you have a body of existing knowledge, feed it into the model and ask it to synthesize a skill. A data-pipeline skill synthesized from your team's actual incident reports and runbooks will outperform one synthesized from a generic "data engineering best practices" article, because it captures *your* schemas, failure modes, and recovery procedures.

Good source material:

- Internal documentation, runbooks, style guides
- API specifications, schemas, configuration files
- Code review comments and issue trackers
- Version control history, especially patches and fixes
- Real-world failure cases and their resolutions

## Refine with real execution

First drafts almost always need refinement. Run the skill against real tasks, then feed the results — all of them, not just failures — back into the author. Ask: what triggered false positives? What was missed? What could be cut?

Even a single execute-then-revise pass noticeably improves quality. Complex domains often benefit from several.

> **Tip:** Read agent execution traces, not just final outputs. If the model wastes time on unproductive steps, common causes include instructions that are too vague (the model tries several approaches before finding one that works), instructions that do not apply to the current task (the model follows them anyway), or too many options presented without a clear default.

## Spend context wisely

Once a skill activates, its full body loads alongside conversation history, system context, and other active skills. Every token competes for attention.

### Add what the model lacks, omit what it knows

Focus on what the model *would not* know without your skill: project-specific conventions, domain-specific procedures, non-obvious edge cases, and the particular tools or APIs to use. You do not need to explain what a PDF is, how HTTP works, or what a database migration does.

```markdown
<!-- Too verbose — the model already knows what PDFs are -->
## Extract PDF text
PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. pdfplumber is recommended because it handles most cases well.

<!-- Better — jumps straight to what the model would not know on its own -->
## Extract PDF text
Use pdfplumber for text extraction. For scanned documents, fall back to
pdf2image with pytesseract.

```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

```

Ask yourself for each piece of content: "Would the model get this wrong without this instruction?" If the answer is no, cut it. If unsure, test it.

### Design coherent units

A skill should encapsulate a coherent unit of work that composes well with other skills — like a function. Skills scoped too narrowly force multiple skills to load for a single task, risking overhead and conflicting instructions. Skills scoped too broadly become hard to activate precisely.

A skill for "query a database and format the results" is one coherent unit. A skill that also covers database administration is probably trying to do too much.

### Aim for moderate detail

Overly comprehensive skills can hurt more than they help — the model struggles to extract what is relevant and may pursue unproductive paths triggered by instructions that do not apply. Concise, stepwise guidance with a working example tends to outperform exhaustive documentation. When you find yourself covering every edge case, consider whether most are better handled by the model's own judgment.

### Structure large skills with progressive disclosure

The spec recommends keeping `SKILL.md` under 500 lines and 5,000 tokens — just the core instructions the model needs on every run. When a skill legitimately needs more, move detail to `references/` and tell the model *when* to load each file.

"Read `references/api-errors.md` if the API returns a non-200 status code" is more useful than a generic "see references/ for details". This is how progressive disclosure is designed to work.

## Calibrate control

Not every part of a skill needs the same level of prescriptiveness. Match specificity to the fragility of the task.

### Match specificity to fragility

**Give the model freedom** when multiple approaches are valid and the task tolerates variation. For flexible instructions, explaining *why* is more effective than rigid directives — a model that understands the purpose makes better context-dependent decisions.

```markdown
## Code review process
1. Check all database queries for SQL injection (use parameterized queries)
2. Verify authentication checks on every endpoint
3. Look for race conditions in concurrent code paths
4. Confirm error messages don't leak internal details
```

**Be prescriptive** when operations are fragile, consistency matters, or a specific sequence must be followed:

```markdown
## Database migration
Run exactly this sequence:

```bash
python scripts/migrate.py --verify --backup
```

Do not modify the command or add additional flags.
```

Most skills have a mix. Calibrate each part independently.

### Provide defaults, not menus

When multiple tools or approaches could work, pick a default and mention alternatives briefly.

```markdown
<!-- Too many options -->
You can use pypdf, pdfplumber, PyMuPDF, or pdf2image...

<!-- Clear default with escape hatch -->
Use pdfplumber for text extraction:

```python
import pdfplumber
```

For scanned PDFs requiring OCR, use pdf2image with pytesseract instead.
```

### Favor procedures over declarations

A skill should teach the model *how to approach* a class of problems, not *what to produce* for a specific instance.

```markdown
<!-- Specific answer — only useful for this exact task -->
Join the `orders` table to `customers` on `customer_id`, filter where
`region = 'EMEA'`, and sum the `amount` column.

<!-- Reusable method — works for any analytical query -->
1. Read the schema from `references/schema.yaml` to find relevant tables
2. Join tables using the `_id` foreign key convention
3. Apply any filters from the user's request as WHERE clauses
4. Aggregate numeric columns as needed and format as a markdown table
```

This does not mean skills cannot include specific details — output format templates, hard constraints ("never output PII"), and tool-specific instructions are all valuable. The point is that the *approach* should generalize even when individual details are specific.

## Patterns for effective instructions

These are reusable techniques. Not every skill needs all of them — pick the ones that fit.

### Gotchas sections

The highest-value content in many skills is a list of gotchas — environment-specific facts that defy reasonable assumptions. These are not general advice ("handle errors appropriately") but concrete corrections to mistakes the model will make without being told.

```markdown
## Gotchas
- The `users` table uses soft deletes. Queries must include
  `WHERE deleted_at IS NULL` or results will include deactivated accounts.
- The user ID is `user_id` in the database, `uid` in the auth service,
  and `accountId` in the billing API. All three refer to the same value.
- The `/health` endpoint returns 200 as long as the web server is running,
  even if the database connection is down. Use `/ready` to check full
  service health.
```

Keep gotchas in `SKILL.md` where the model reads them before encountering the situation. A separate reference file works if you tell the model *when* to load it, but for non-obvious issues, the model may not recognize the trigger.

> **Tip:** When the model makes a mistake you have to correct, add the correction to the gotchas section. This is one of the most direct ways to improve a skill iteratively.

### Templates for output format

When you need the model to produce output in a specific format, provide a template. Models pattern-match well against concrete structures. Short templates can live inline in `SKILL.md`; for longer templates, store them in `assets/` and reference from `SKILL.md` so they only load when needed.

```markdown
## Report structure
Use this template, adapting sections as needed for the specific analysis:

```markdown
# [Analysis Title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
2. Specific actionable recommendation
```

```

### Checklists for multi-step workflows

An explicit checklist helps the model track progress and avoid skipping steps, especially when steps have dependencies or validation gates.

```markdown
## Form processing workflow
Progress:
- [ ] Step 1: Analyze the form (run `scripts/analyze_form.py`)
- [ ] Step 2: Create field mapping (edit `fields.json`)
- [ ] Step 3: Validate mapping (run `scripts/validate_fields.py`)
- [ ] Step 4: Fill the form (run `scripts/fill_form.py`)
- [ ] Step 5: Verify output (run `scripts/verify_output.py`)
```

### Validation loops

Instruct the model to validate its own work before moving on. The pattern is: do the work, run a validator (a script, a reference checklist, or a self-check), fix any issues, repeat until validation passes.

```markdown
## Editing workflow
1. Make your edits
2. Run validation: `python scripts/validate.py output/`
3. If validation fails:
   - Review the error message
   - Fix the issues
   - Run validation again
4. Only proceed when validation passes
```

A reference document can also serve as the "validator" — instruct the model to check its work against the reference before finalizing.

### Plan-validate-execute

For batch or destructive operations, have the model create an intermediate plan in a structured format, validate it against a source of truth, and only then execute.

```markdown
## PDF form filling
1. Extract form fields: `python scripts/analyze_form.py input.pdf` → `form_fields.json`
   (lists every field name, type, and whether it's required)
2. Create `field_values.json` mapping each field name to its intended value
3. Validate: `python scripts/validate_fields.py form_fields.json field_values.json`
   (checks that every field name exists in the form, types are compatible, and
   required fields are not missing)
4. If validation fails, revise `field_values.json` and re-validate
5. Fill the form: `python scripts/fill_form.py input.pdf field_values.json output.pdf`
```

The key ingredient is step 3: a validation script that checks the plan (`field_values.json`) against the source of truth (`form_fields.json`). Errors like "Field 'signature_date' not found — available fields: customer_name, order_total, signature_date_signed" give the model enough information to self-correct.

### Bundling reusable scripts

When iterating on a skill, compare execution traces across test cases. If the model independently reinvents the same logic each run — building charts, parsing a specific format, validating output — that is a signal to write a tested script once and bundle it in `scripts/`. This saves every future invocation from reinventing the wheel.
