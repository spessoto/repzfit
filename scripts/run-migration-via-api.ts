import { createClient } from "@supabase/supabase-js";
import { env } from "../src/config/env.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

async function executeMigration() {
  console.log("🔄 Executando migrations via Supabase API...\n");

  const migrations = [
    {
      name: "Adicionar start_date em workouts",
      sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date",
    },
    {
      name: "Adicionar valid_until em workouts",
      sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS valid_until date",
    },
    {
      name: "Adicionar muscle_group em exercises",
      sql: "ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS muscle_group text",
    },
  ];

  // Try using the REST API to execute SQL
  for (const migration of migrations) {
    console.log(`📝 ${migration.name}...`);
    
    try {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          query: migration.sql
        })
      });

      if (response.ok || response.status === 404) {
        // Try direct SQL endpoint
        const sqlResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          },
        });
        
        console.log(`⚠️  API não suporta DDL. Use o Dashboard SQL Editor.`);
        console.log(`   SQL: ${migration.sql}\n`);
      }
    } catch (error) {
      console.log(`⚠️  ${error.message}\n`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("📋 Execute este SQL no Supabase Dashboard:");
  console.log("   https://supabase.com/dashboard/project/ofergzualxqqovktyxwu/sql/new");
  console.log("=".repeat(70));
  
  const sqlFile = readFileSync(
    join(__dirname, "..", "supabase", "migrations", "EXECUTE_THIS.sql"),
    "utf-8"
  );
  console.log(sqlFile);
}

executeMigration().catch(console.error);
