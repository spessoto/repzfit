/**
 * Script de migração de dados: criptografa todos os valores plaintext existentes no banco.
 *
 * Execute APÓS fazer deploy do código com as chaves configuradas.
 * Execute APENAS UMA VEZ — o script é idempotente (pula campos já criptografados).
 *
 * Uso:
 *   npx tsx scripts/migrate-encrypt-fields.ts
 *
 * Pré-requisitos:
 *   - FIELD_ENCRYPTION_KEY e FIELD_HMAC_SECRET devem estar no .env ou no ambiente
 *   - SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar configurados
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  encrypt,
  encryptNumber,
  hmacHash,
  isEncrypted,
  decrypt,
} from "../src/utils/encryption.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

// ─────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────

function needsEncryption(value: string | null | undefined): boolean {
  if (value == null || value === "") return false;
  return !isEncrypted(value);
}

function needsNumericEncryption(value: any): boolean {
  if (value == null) return false;
  // Se já for string criptografada, não precisa
  if (typeof value === "string" && isEncrypted(value)) return false;
  // Se for número ou string numérica, precisa criptografar
  return true;
}

async function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────
// 1. Tabela: students
// ─────────────────────────────────────────────────────────────

async function migrateStudents() {
  await log("=== students ===");

  const { data: rows, error } = await supabase
    .from("students")
    .select("id,name,email,whatsapp_number,blood_type,weight_kg,height_cm,monthly_fee,payment_day");

  if (error) {
    console.error("Erro ao buscar students:", error.message);
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const patch: Record<string, unknown> = {};

    if (needsEncryption(row.name))            patch.name           = encrypt(row.name);
    if (needsEncryption(row.email))           patch.email          = encrypt(row.email);
    if (needsEncryption(row.blood_type))      patch.blood_type     = encrypt(row.blood_type);
    if (needsNumericEncryption(row.weight_kg)) patch.weight_kg     = encryptNumber(Number(row.weight_kg));
    if (needsNumericEncryption(row.height_cm)) patch.height_cm     = encryptNumber(Number(row.height_cm));
    if (needsNumericEncryption(row.monthly_fee)) patch.monthly_fee = encryptNumber(Number(row.monthly_fee));
    if (needsNumericEncryption(row.payment_day)) patch.payment_day = encryptNumber(Number(row.payment_day));

    // whatsapp_number: criptografar e gerar hash
    if (needsEncryption(row.whatsapp_number)) {
      patch.whatsapp_number = encrypt(row.whatsapp_number);
      patch.whatsapp_hash   = hmacHash(row.whatsapp_number);
    } else if (!row.whatsapp_hash && row.whatsapp_number) {
      // Já criptografado mas sem hash — gerar hash do valor descriptografado
      const plain = decrypt(row.whatsapp_number);
      if (plain) patch.whatsapp_hash = hmacHash(plain);
    }

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("students")
      .update(patch)
      .eq("id", row.id);

    if (updateError) {
      console.error(`  Erro em student ${row.id}:`, updateError.message);
    } else {
      updated++;
    }
  }

  await log(`  students: ${updated} migrados, ${skipped} já criptografados`);
}

// ─────────────────────────────────────────────────────────────
// 2. Tabela: personals (phone, crf_registration)
// ─────────────────────────────────────────────────────────────

async function migratePersonals() {
  await log("=== personals ===");

  const { data: rows, error } = await supabase
    .from("personals")
    .select("id,phone,crf_registration");

  if (error) {
    console.error("Erro ao buscar personals:", error.message);
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const patch: Record<string, unknown> = {};

    if (needsEncryption(row.phone)) {
      patch.phone      = encrypt(row.phone);
      patch.phone_hash = hmacHash(row.phone);
    } else if (!row.phone_hash && row.phone) {
      const plain = decrypt(row.phone);
      if (plain) patch.phone_hash = hmacHash(plain);
    }

    if (needsEncryption(row.crf_registration)) {
      patch.crf_registration = encrypt(row.crf_registration);
    }

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("personals")
      .update(patch)
      .eq("id", row.id);

    if (updateError) {
      console.error(`  Erro em personal ${row.id}:`, updateError.message);
    } else {
      updated++;
    }
  }

  await log(`  personals: ${updated} migrados, ${skipped} já criptografados`);
}

// ─────────────────────────────────────────────────────────────
// 3. Tabela: student_weight_logs
// ─────────────────────────────────────────────────────────────

async function migrateWeightLogs() {
  await log("=== student_weight_logs ===");

  const PAGE = 1000;
  let offset = 0;
  let total = 0;
  let skipped = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("student_weight_logs")
      .select("id,weight_kg")
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Erro ao buscar weight_logs:", error.message);
      break;
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      if (!needsNumericEncryption(row.weight_kg)) {
        skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("student_weight_logs")
        .update({ weight_kg: encryptNumber(Number(row.weight_kg)) })
        .eq("id", row.id);

      if (updateError) {
        console.error(`  Erro em weight_log ${row.id}:`, updateError.message);
      } else {
        total++;
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  await log(`  student_weight_logs: ${total} migrados, ${skipped} já criptografados`);
}

// ─────────────────────────────────────────────────────────────
// 4. Tabela: set_logs
// ─────────────────────────────────────────────────────────────

async function migrateSetLogs() {
  await log("=== set_logs ===");

  const PAGE = 2000;
  let offset = 0;
  let total = 0;
  let skipped = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("set_logs")
      .select("id,reps_done,weight_used,rpe_score")
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Erro ao buscar set_logs:", error.message);
      break;
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const needsReps   = needsNumericEncryption(row.reps_done);
      const needsWeight = needsNumericEncryption(row.weight_used);
      const needsRpe    = row.rpe_score != null && needsNumericEncryption(row.rpe_score);

      if (!needsReps && !needsWeight && !needsRpe) {
        skipped++;
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (needsReps)   patch.reps_done   = encryptNumber(Number(row.reps_done));
      if (needsWeight) patch.weight_used = encryptNumber(Number(row.weight_used));
      if (needsRpe)    patch.rpe_score   = encryptNumber(Number(row.rpe_score));

      const { error: updateError } = await supabase
        .from("set_logs")
        .update(patch)
        .eq("id", row.id);

      if (updateError) {
        console.error(`  Erro em set_log ${row.id}:`, updateError.message);
      } else {
        total++;
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  await log(`  set_logs: ${total} migrados, ${skipped} já criptografados`);
}

// ─────────────────────────────────────────────────────────────
// 5. Tabela: bot_anomaly_logs (input_excerpt, message)
// ─────────────────────────────────────────────────────────────

async function migrateAnomalyLogs() {
  await log("=== bot_anomaly_logs ===");

  const PAGE = 1000;
  let offset = 0;
  let total = 0;
  let skipped = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("bot_anomaly_logs")
      .select("id,message,input_excerpt")
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Erro ao buscar bot_anomaly_logs:", error.message);
      break;
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const needsMsg    = needsEncryption(row.message);
      const needsExcerpt = needsEncryption(row.input_excerpt);

      if (!needsMsg && !needsExcerpt) {
        skipped++;
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (needsMsg)     patch.message       = encrypt(row.message);
      if (needsExcerpt) patch.input_excerpt = encrypt(row.input_excerpt);

      const { error: updateError } = await supabase
        .from("bot_anomaly_logs")
        .update(patch)
        .eq("id", row.id);

      if (updateError) {
        console.error(`  Erro em anomaly_log ${row.id}:`, updateError.message);
      } else {
        total++;
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  await log(`  bot_anomaly_logs: ${total} migrados, ${skipped} já criptografados`);
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.FIELD_ENCRYPTION_KEY || !process.env.FIELD_HMAC_SECRET) {
    console.error(
      "ERRO: FIELD_ENCRYPTION_KEY e FIELD_HMAC_SECRET devem estar definidos no ambiente.",
    );
    process.exit(1);
  }

  console.log("=================================================");
  console.log("  MIGRAÇÃO DE DADOS — CRIPTOGRAFIA LGPD");
  console.log("  Iniciando...");
  console.log("=================================================");

  await migrateStudents();
  await migratePersonals();
  await migrateWeightLogs();
  await migrateSetLogs();
  await migrateAnomalyLogs();

  console.log("=================================================");
  console.log("  Migração concluída.");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
