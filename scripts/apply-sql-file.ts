import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import pg from "pg";

import { env } from "../src/config/env.js";

const { Client } = pg;

function getProjectRefFromSupabaseUrl(url: string): string {
  const host = new URL(url).hostname;
  const ref = host.split(".")[0];
  if (!ref) {
    throw new Error("Could not resolve project ref from SUPABASE_URL");
  }
  return ref;
}

function buildConnectionString(): string {
  const projectRef = getProjectRefFromSupabaseUrl(env.SUPABASE_URL);
  return `postgresql://postgres.${projectRef}:${env.SUPABASE_SERVICE_KEY}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
}

async function applySqlFile() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/apply-sql-file.ts <sql-file-path>");
    process.exit(1);
  }

  const sqlFilePath = resolve(process.cwd(), inputPath);
  const sql = readFileSync(sqlFilePath, "utf-8");

  const client = new Client({
    connectionString: buildConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`Applying SQL file: ${sqlFilePath}`);
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Migration applied successfully.");
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to apply SQL file:", error?.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applySqlFile().catch((error) => {
  console.error("Fatal error:", error?.message || error);
  process.exit(1);
});
