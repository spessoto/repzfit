import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { supabaseAdmin } from "../src/config/supabase.js";

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part};`);
}

async function applySqlFileRpc() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/apply-sql-file-rpc.ts <sql-file-path>");
    process.exit(1);
  }

  const sqlFilePath = resolve(process.cwd(), inputPath);
  const sql = readFileSync(sqlFilePath, "utf-8");
  const statements = splitSqlStatements(sql);

  console.log(`Applying SQL file via RPC: ${sqlFilePath}`);
  console.log(`Statements: ${statements.length}`);

  let applied = 0;
  for (const statement of statements) {
    let rpcError: string | null = null;

    const execResult = await supabaseAdmin.rpc("exec", { query: statement });
    if (execResult.error) {
      rpcError = execResult.error.message;
      const execSqlResult = await supabaseAdmin.rpc("exec_sql", {
        sql: statement,
      });

      if (execSqlResult.error) {
        console.error("Failed statement:", statement);
        console.error(
          "Error:",
          `exec => ${rpcError}; exec_sql => ${execSqlResult.error.message}`,
        );
        process.exit(1);
      }
    }

    applied += 1;
  }

  console.log(`Migration applied successfully via RPC (${applied} statements).`);
}

applySqlFileRpc().catch((error) => {
  console.error("Fatal error:", error?.message || error);
  process.exit(1);
});
