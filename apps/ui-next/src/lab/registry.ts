import { CATEGORIES, type Category, type Entry } from "./kit";
import { chat } from "./entries/chat";
import { data } from "./entries/data";
import { feedback } from "./entries/feedback";
import { foundations } from "./entries/foundations";
import { interactions } from "./entries/interactions";
import { primitives } from "./entries/primitives";
import { settings } from "./entries/settings";
import { shell } from "./entries/shell";
import { tools } from "./entries/tools";

export const ENTRIES: Entry[] = [
  ...foundations,
  ...primitives,
  ...data,
  ...feedback,
  ...chat,
  ...shell,
  ...settings,
  ...tools,
  ...interactions,
];

export const BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));

export const GROUPS: Array<{ category: Category; entries: Entry[] }> = CATEGORIES.map(
  (category) => ({
    category,
    entries: ENTRIES.filter((e) => e.category === category),
  }),
);
