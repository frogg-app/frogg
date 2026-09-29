import type { ListResult, OutputSchema } from "../../output/index.js";

export interface FieldRow {
  field: string;
  value: string;
}

export const fieldSchema: OutputSchema<FieldRow> = {
  idField: "value",
  columns: [
    { header: "FIELD", field: "field", width: 16 },
    { header: "VALUE", field: "value", width: 80 },
  ],
  serialize: (row) => row,
};

/** Key/value rows; JSON output gets the plain object instead. */
export function fields(
  data: Record<string, string | number | boolean | null | undefined>,
): ListResult<FieldRow> {
  const rows = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([field, v]) => ({ field, value: v === null ? "-" : String(v) }));
  return { type: "list", data: rows, schema: fieldSchema };
}
