import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface MyCnfClient {
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseMyCnf(content: string): MyCnfClient {
  const client: MyCnfClient = {};
  let section = "";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim().toLowerCase() ?? "";
      continue;
    }
    if (section !== "client") continue;

    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = unquote(line.slice(equals + 1).trim());
    if (["host", "port", "database", "user", "password"].includes(key)) {
      client[key as keyof MyCnfClient] = value;
    }
  }
  return client;
}

export function loadMyCnfClient(file = path.join(homedir(), ".my.cnf")): MyCnfClient {
  try {
    return parseMyCnf(readFileSync(file, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw error;
  }
}
