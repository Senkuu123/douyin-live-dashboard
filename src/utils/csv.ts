export interface CsvColumn<T> {
  header: string;
  value(row: T): unknown;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date
    ? value.toISOString()
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((column) => csvValue(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvValue(column.value(row))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
