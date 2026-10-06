import { CATEGORIES, type Category, type Entry } from "./kit";
import { buttonAlts } from "./entries/buttonAlts";
import { chat } from "./entries/chat";
import { data } from "./entries/data";
import { feedback } from "./entries/feedback";
import { foundations } from "./entries/foundations";
import { interactions } from "./entries/interactions";
import { primitives } from "./entries/primitives";
import { settings } from "./entries/settings";
import { shapeAlts } from "./entries/shapeAlts";
import { shell } from "./entries/shell";
import { textReveal } from "./entries/textReveal";
import { tools } from "./entries/tools";

export const ENTRIES: Entry[] = [
  ...foundations,
  ...shapeAlts,
  ...primitives,
  ...buttonAlts,
  ...data,
  ...feedback,
  ...chat,
  textReveal,
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
