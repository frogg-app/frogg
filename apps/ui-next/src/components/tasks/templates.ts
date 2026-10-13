import type { TodoPriority } from "../../daemon/todos";

/**
 * Starting points for a new to-do. The description is what an agent reads when it claims the
 * item, so each template is a prompt skeleton: what to do, where, and how to tell it's done.
 */
export interface TodoTemplate {
  id: string;
  label: string;
  category: string | null;
  priority: TodoPriority;
  title: string;
  description: string;
}

export const TEMPLATES: TodoTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    category: null,
    priority: "medium",
    title: "",
    description: "",
  },
  {
    id: "bug",
    label: "Bug fix",
    category: "bug",
    priority: "high",
    title: "Fix: ",
    description: [
      "## What happens",
      "",
      "## What should happen",
      "",
      "## Steps to reproduce",
      "1. ",
      "",
      "## Done when",
      "- The steps above no longer reproduce it",
      "- A test covers the case",
    ].join("\n"),
  },
  {
    id: "feature",
    label: "Feature",
    category: "feature",
    priority: "medium",
    title: "",
    description: [
      "## Goal",
      "",
      "## Scope",
      "- ",
      "",
      "## Out of scope",
      "- ",
      "",
      "## Done when",
      "- ",
      "- Typecheck and tests pass",
    ].join("\n"),
  },
  {
    id: "refactor",
    label: "Refactor",
    category: "refactor",
    priority: "low",
    title: "Refactor: ",
    description: [
      "## What to change",
      "",
      "## Why",
      "",
      "## Constraints",
      "- No behaviour change",
      "",
      "## Done when",
      "- Existing tests pass unchanged",
    ].join("\n"),
  },
  {
    id: "investigate",
    label: "Investigate",
    category: "research",
    priority: "medium",
    title: "Investigate: ",
    description: [
      "## Question",
      "",
      "## Where to look",
      "- ",
      "",
      "## Report back",
      "- Findings with file and line references",
      "- A recommended next step",
    ].join("\n"),
  },
  {
    id: "docs",
    label: "Docs",
    category: "docs",
    priority: "low",
    title: "Document ",
    description: [
      "## Page or file",
      "",
      "## What it should cover",
      "- ",
      "",
      "## Done when",
      "- The page matches the code",
    ].join("\n"),
  },
];
