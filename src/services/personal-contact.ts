import { normalizeBrazilWhatsappNumber } from "../utils/whatsapp.js";

export type PersonalContactLike = {
  phone?: string | null;
  whatsapp_number?: string | null;
} | null | undefined;

export function resolvePersonalWhatsAppNumber(
  personal: PersonalContactLike,
): string | null {
  const candidates = [personal?.whatsapp_number, personal?.phone];

  for (const candidate of candidates) {
    const normalized = normalizeBrazilWhatsappNumber(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}
