# 🚀 Rollout Completo — Etapas 1, 2 e 3

## Status Atual

### ✅ Completado (Sem Dependências Externas)

**1. Refatoração Backend para Bot Unificado**

- Instância única via `EVOLUTION_UNIFIED_INSTANCE_NAME`
- Endpoints admin para controle do WhatsApp unificado:
  - `GET /api/admin/whatsapp/connection/status`
  - `GET /api/admin/whatsapp/connection/qrcode`
  - `DELETE /api/admin/whatsapp/connection/logout`
- Endpoints personal em read-only + forbidden para conexão:
  - `GET /api/personal/connection/status` (leitura apenas)
  - `GET/DELETE` retornam 403 Forbidden
- Bot motor com validação de vínculo aluno-personal
- Webhook filtrando por instância unificada
- Frontend admin com bloco de conexão WhatsApp
- Frontend personal com aba status-only

**Validações executadas:**

- ✅ Typecheck: 0 erros
- ✅ Admin login: OK (200)
- ✅ Admin WhatsApp status: OK (200, state=connecting)
- ✅ Admin WhatsApp QRCode: OK (200, payload com QR/pairing)
- ✅ Edit student duplicate WhatsApp: OK (409 Conflict)
- ✅ Create student duplicate: Depende da migration (veja abaixo)

---

### ⏳ Requer Execução Manual — Migration de Unicidade Global

**O que falta:** A constraint de unicidade global em `students.whatsapp_number` deve ser aplicada manualmente no **Supabase SQL Editor**.

**Por quê:** O ambiente não tem acesso direto ao PostgreSQL (credenciais não funcionam para conexão direta), e a instância não expõe RPC `exec_sql` para DDL.

**Como fazer:**

1. Acesse: https://supabase.com/dashboard (seu projeto)
2. Vá em **SQL Editor**
3. Cole este código inteiro:

```sql
-- ============================================================
-- Migration: WhatsApp de aluno com unicidade global
-- Data: 2026-06-17
-- Objetivo: evitar ambiguidade de roteamento no bot unificado
-- ============================================================

-- Remove a regra antiga de unicidade por personal (se existir)
ALTER TABLE public.students
DROP CONSTRAINT IF EXISTS unique_whatsapp_per_personal;

-- Cria índice de unicidade global: cada WhatsApp só pode existir uma vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_whatsapp_unique_global
  ON public.students (whatsapp_number);

-- ============================================================
-- Verificação (execute para confirmar)
-- ============================================================

SELECT
  indexname,
  schemaname,
  tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'students'
  AND indexname LIKE '%whatsapp%'
ORDER BY indexname;
```

4. Clique em **Run** (ou Ctrl+Enter)
5. Você deve ver uma linha: `idx_students_whatsapp_unique_global | public | students`
6. ✅ Migration aplicada com sucesso!

**Após aplicar a migration:**

- Tentativas de criar/editar aluno com WhatsApp duplicado retornarão **HTTP 409 Conflict**
- Mensagem do frontend: "Este WhatsApp já está vinculado a outro aluno. Confirme o número com o personal responsável."

---

## 📋 Checklist Final de Rollout

- [ ] Executar SQL migration no Supabase SQL Editor
- [ ] Testar criação de aluno com WhatsApp duplicado (deve retornar 409)
- [ ] Testar edição de aluno para WhatsApp duplicado (deve retornar 409)
- [ ] Testar conexão WhatsApp no painel admin (gerar QRCode, confirmar status)
- [ ] Cadastrar aluno de teste e validar vinculação a um personal
- [ ] Enviar mensagem do aluno testando o fluxo completo do bot
- [ ] Validar que aluno não vinculado recebe mensagem correta do bot
- [ ] Deploy para produção com `EVOLUTION_UNIFIED_INSTANCE_NAME` configurado

---

## 🔗 Referências de Código

**Novos endpoints admin:**

- [src/routes/api/admin.ts](../src/routes/api/admin.ts#L320-L365)

**Refactoring bot e validação:**

- [src/services/bot-engine.ts](../src/services/bot-engine.ts#L263-L292)

**Webhook com filtro de instância:**

- [src/routes/webhooks/evolution.ts](../src/routes/webhooks/evolution.ts#L167-L180)

**UI admin WhatsApp:**

- [public/index.html](../public/index.html#L1723-L1754)

**UX de conflito duplicado:**

- [public/index.html](../public/index.html#L2474-L2493)

---

## 🛠️ Troubleshooting

**Se a criação de aluno ainda não retornar 409 após aplicar a migration:**

- Verifique se o índice foi criado: execute a query de verificação no SQL Editor
- Limpe cache da aplicação e reinicie o servidor local/deployment

**Se o QRCode não aparecer no admin:**

- Confirme que `EVOLUTION_UNIFIED_INSTANCE_NAME` está configurado em `.env` (ou variáveis de produção)
- Verifique se a Evolution API está respondendo: acesse `/api/admin/whatsapp/connection/status`

---

**Status:** 🟢 PRONTO PARA ROLLOUT (após execução manual da migration SQL)
