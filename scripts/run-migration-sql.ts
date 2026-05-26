import { env } from "../src/config/env.js";

async function executeSql(sql: string) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.log("API Response:", error);
  }

  return response;
}

async function applyMigrations() {
  console.log("🔄 Aplicando migrations via SQL direto...\n");

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

  for (const migration of migrations) {
    console.log(`📝 ${migration.name}...`);
    try {
      // Tentar via fetch direto ao PostgREST
      const url = `${env.SUPABASE_URL}/rest/v1/`;
      const response = await fetch(url, {
        method: "HEAD",
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
        },
      });

      console.log(`⚠️  Não é possível executar DDL via REST API`);
      console.log(`   Você precisa executar no Supabase SQL Editor:`);
      console.log(`   ${migration.sql}\n`);
    } catch (error: any) {
      console.log(`❌ ${error.message}\n`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("📋 INSTRUÇÕES: Execute este SQL no Supabase Dashboard");
  console.log(
    "   https://supabase.com/dashboard/project/ofergzualxqqovktyxwu/editor/sql",
  );
  console.log("=".repeat(70));
  console.log(`
-- Migration: Add workout dates and exercise muscle groups

ALTER TABLE public.workouts 
  ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date;

ALTER TABLE public.workouts 
  ADD COLUMN IF NOT EXISTS valid_until date;

ALTER TABLE public.exercises 
  ADD COLUMN IF NOT EXISTS muscle_group text;
`);
  console.log("=".repeat(70));
}

applyMigrations().catch(console.error);
