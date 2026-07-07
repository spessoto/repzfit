import XLSX from "xlsx";
import { resolve } from "node:path";

const fileArg = process.argv[2] || "src/Tabela Completa de Exercícios de Academia.xlsx";
const filePath = resolve(process.cwd(), fileArg);

const wb = XLSX.readFile(filePath);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

console.log(`Sheet: ${sheetName}`);
console.log(`Rows: ${rows.length}`);

if (rows.length === 0) {
  console.log("No rows");
  process.exit(0);
}

const headers = Object.keys(rows[0]);
console.log("Headers:");
headers.forEach((h, i) => console.log(`${i + 1}. ${h}`));

console.log("\nFirst 5 rows (compact):");
for (let i = 0; i < Math.min(5, rows.length); i += 1) {
  const row = rows[i];
  const compact = Object.fromEntries(
    headers.map((h) => [h, String(row[h] ?? "")]).filter(([, v]) => v.trim() !== ""),
  );
  console.log(`${i + 1}. ${JSON.stringify(compact)}`);
}
