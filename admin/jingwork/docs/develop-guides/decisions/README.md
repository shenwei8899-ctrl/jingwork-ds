# Engineering Decision Records

English | [中文](README.zh.md)

Decision records preserve the current judgment for a nontrivial change, the real alternatives, accepted costs, and verification. They supplement code and current documentation; they do not replace either.

## Lifecycle

- `proposed/`: proposals that are not implemented; record the problem, candidate approaches, acceptance criteria, and risks.
- `implemented/`: decisions currently in effect; use present tense and retain only the problem, decision, alternatives, consequences, and verification.
- `rejected/`: proposals explicitly rejected for reasons worth preserving; they do not define current implementation requirements.
- `archived/`: frozen history that must not be edited or treated as current authority. Current mechanisms must link to a new owning record.

After implementation, move a proposal to `implemented/` and rewrite it as current facts. Do not keep migration checklists, progress logs, or spec-style requirements. Cross-link records when a decision partly supersedes another. Move an obsolete record to `archived/`, or delete it after a new record fully incorporates its rationale. Before archiving, rewrite it to cover the problem, decision, alternatives, consequences, and verification; remove proposal, progress, or migration sections.

At a formal release, archive implemented records that took effect before the release date under `archived/<version>/` (for example, `archived/0.7.3/`), set their status to archived, and summarize their decisions and consequences by topic in that directory's `CHANGELOG.md`. Keep records dated on or after release day in `implemented/` for the next release cycle. Archived records are frozen; code, mechanism documentation, and later implemented records own current behavior.

Nontrivial work requires a `proposed` record before implementation. A small, complete fix that takes effect in the same change and has no unresolved alternative or risk may go directly to `implemented`, but the PR must explain why no proposal was needed. Do not classify work as trivial based only on diff size or file count. See [Yuxi Spec Loop](../spec-loop.md) for the complete process.

## When a record is needed

A change is nontrivial if any of these conditions apply:

- It changes the semantic owner of an important engineering claim, a commit/publication point, an oracle, a negative case, or an actual gate.
- It changes persistent state, a transaction publication point, permissions, worker lifecycle, model-visible input, or a compatibility commitment.
- It introduces a new abstraction, dependency, configuration, fallback, state machine, or long-term maintenance surface.
- It accepts an engineering trade-off that is not obvious and may be revisited later.

Local copy edits, mechanical renames, and equivalent cleanup that do not change behavior are exempt, but the PR must state why.

## Format

Use `YYYY-MM-DD-topic.md` filenames. Every record includes:

```markdown
# Decision title

Status: implemented
Type: feature
Owner: path/to/owner

## Problem
## Decision
## Alternatives
## Consequences
## Verification
```

`Type` uses only `feature`, `bug-fix`, `simplification`, `architecture`, `process`, or `testing`. `Owner` points to the primary code, contract, or document that owns current behavior. When a decision spans multiple fact owners, state their responsibilities in the record; a decision record must not become the runtime source of truth.

New or substantially revised `proposed` and `implemented` records include a concise `### Implementation` subsection under `## Proposal` or `## Decision`. It describes affected modules and responsibilities, the main path from entry point to result, and relevant interfaces, state, persistence, and failure handling. Process decisions identify where the rule is maintained and how it is enforced. A few paragraphs or a small table are enough. Link detailed behavior to its owner; do not list every function or construction step. Rewrite the proposal as the actual design when it ships. Reviewers must be able to understand implementation from this description; principles alone or “the service handles it” are insufficient. Historical records are not retroactively expanded.

`proposed` records use `## Problem`, `## Proposal`, `## Alternatives`, `## Acceptance Criteria`, and `## Risks`. Acceptance criteria include this evidence matrix:

```markdown
| Acceptance claim | Failure mode | Semantic owner | Direct evidence / command | Negative case | Current result |
|---|---|---|---|---|---|
```

`simplification` proposals and implemented records also include `Old capability absent:` and `Reintroduction condition:` under `## Acceptance Criteria` or `## Verification`, respectively. This prevents adding a replacement without removing the old surface. A `rejected` record explains why the proposal was rejected. Do not preserve chain-of-thought, step-by-step implementation narration, review conversations, personnel evaluations, or sensitive data.
