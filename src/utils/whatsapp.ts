/**
 * Normaliza um número de WhatsApp para o formato brasileiro sem formatação.
 * Garante o prefixo 55 + DDD + número (12 ou 13 dígitos).
 * Retorna null se o número for inválido.
 */
export function normalizeBrazilWhatsappNumber(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  let digits = String(raw).trim().replace(/\D+/g, "");
  if (!digits) return null;

  while (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13)
  ) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}
