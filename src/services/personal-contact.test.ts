import test from "node:test";
import assert from "node:assert/strict";

import { resolvePersonalWhatsAppNumber } from "./personal-contact.js";

test("resolvePersonalWhatsAppNumber accepts phone and whatsapp_number values", () => {
  assert.equal(resolvePersonalWhatsAppNumber({ phone: "(11) 99999-0000" }), "5511999990000");
  assert.equal(resolvePersonalWhatsAppNumber({ whatsapp_number: "+55 11 98888-7777" }), "5511988887777");
  assert.equal(resolvePersonalWhatsAppNumber({ phone: "11988887777" }), "5511988887777");
  assert.equal(resolvePersonalWhatsAppNumber({ phone: "" }), null);
});
