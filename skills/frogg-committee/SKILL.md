---
name: frogg-committee
description: Form a committee of two high-reasoning agents to step back, do root cause analysis, and produce a plan. Use when stuck, looping, tunnel-visioning, or facing a hard planning problem.
user-invocable: true
---

# Committee Skill

Two agents from contrasting providers, fresh context, planning a solution in parallel.

**User's additional context:** $ARGUMENTS

## Prerequisites

Read the **frogg** skill. Use its provider discovery tools to choose committee members.

Contrast is the point of a committee, so pick different provider families when possible.

## Composition

Two members with different reasoning styles, chosen through provider discovery:

- one high-reasoning model suited to planning, research, or root-cause analysis
- one contrasting high-reasoning model from another provider family

If the user names providers or models, use those.

## Hard rules

- **No edits.** Every prompt to a committee member ends with the no-edits suffix:

  ```
  This is analysis only. Do NOT edit, create, or delete any files. Do NOT write code.
  ```

- **Trust the finish notification.** Do not poll, send hurry-ups, or interrupt. Models can reason for 15–30 minutes. You can go idle and Frogg will notify you.

## Workflow

1. Write a problem-level prompt
2. Create both agents in parallel via Frogg with `[Committee] <task>` titles and the same prompt
3. Wait for both responses
4. Resolve disagreements by passing their arguments between each other
5. Keep going until they converge into a response

Share the consensus with the user. Summarize where the agents diverged and how they resolved it.
