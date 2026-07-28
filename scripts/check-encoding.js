#!/usr/bin/env node
/**
 * Verifica se arquivos públicos estão em UTF-8 válido.
 * Executar antes do deploy para detectar regressões de encoding.
 *
 * Uso: node scripts/check-encoding.js
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const CHECK_EXTS = [".html", ".js", ".css"];

let errors = 0;

function checkFile(filepath) {
  const raw = readFileSync(filepath);

  // Detectar BOM UTF-8 desnecessário
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    console.error(`[BOM]  ${filepath} — tem BOM UTF-8 desnecessário`);
    errors++;
  }

  // Detectar bytes Latin-1 isolados (não-UTF-8)
  let i = 0;
  let latinBytes = 0;
  while (i < raw.length) {
    const b = raw[i];
    if (b < 0x80) {
      i++;
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < raw.length && (raw[i + 1] & 0xc0) === 0x80) {
      i += 2; // 2-byte UTF-8 sequence — OK
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < raw.length && (raw[i + 1] & 0xc0) === 0x80 && (raw[i + 2] & 0xc0) === 0x80) {
      i += 3; // 3-byte UTF-8 sequence — OK
    } else if (b >= 0xf0 && i + 3 < raw.length && (raw[i + 1] & 0xc0) === 0x80 && (raw[i + 2] & 0xc0) === 0x80 && (raw[i + 3] & 0xc0) === 0x80) {
      i += 4; // 4-byte UTF-8 sequence — OK
    } else {
      latinBytes++;
      i++;
    }
  }

  if (latinBytes > 0) {
    console.error(`[ENC]  ${filepath} — ${latinBytes} byte(s) Latin-1/Windows-1252 detectados (não é UTF-8 válido)`);
    errors++;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (CHECK_EXTS.includes(extname(entry))) {
      checkFile(full);
    }
  }
}

walk(PUBLIC_DIR);

if (errors === 0) {
  console.log(`✓ Encoding OK — todos os arquivos em public/ são UTF-8 válido`);
  process.exit(0);
} else {
  console.error(`\n✗ ${errors} arquivo(s) com problemas de encoding. Corrija antes do deploy.`);
  process.exit(1);
}
