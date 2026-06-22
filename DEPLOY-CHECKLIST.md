# 🚀 Deploy Checklist — Unified WhatsApp Bot

**Status:** ✅ 90% Completo — Faltam variáveis de ambiente em Vercel

---

## ✅ Concluído

### 1. Código e Git

- [x] Refactoring completo do bot unificado
- [x] Commit: `d7fe90b` — "refactor: unified whatsapp bot instance..."
- [x] Push para `origin/main`
- [x] GitHub: https://github.com/spessoto/repzfit/commit/d7fe90b

### 2. Database

- [x] Migration criada: `202606170001_global_unique_student_whatsapp.sql`
- [x] Migration aplicada via Supabase CLI
- [x] Índice global criado: `idx_students_whatsapp_unique_global` on `students.whatsapp_number`
- [x] Constraint antigo removido

### 3. Deployment Vercel

- [x] Build passou: TypeScript validation ✅
- [x] Deploy: `https://app.ezpersonal.com.br` (pronto)
- [x] Status: Ready
- [x] Alias configurado

### 4. Recursos Implementados

- [x] Helper `getUnifiedEvolutionInstanceName()`
- [x] 3 endpoints admin WhatsApp:
  - GET `/api/admin/whatsapp/connection/status`
  - GET `/api/admin/whatsapp/connection/qrcode`
  - DELETE `/api/admin/whatsapp/connection/logout`
- [x] Personal endpoints disabled (403 Forbidden)
- [x] Bot engine com validação de linkage
- [x] Webhook filter by instance
- [x] UI refactor — admin controls, personal read-only
- [x] UX — detect 409 conflict

---

## ⏳ Faltando: Configurar Variáveis em Vercel

**Problema:** A aplicação está em "Ready" mas retorna 500 porque `EVOLUTION_UNIFIED_INSTANCE_NAME` não está configurado em Vercel.

**Solução:**

1. **Abra o dashboard:**
   - https://vercel.com/agencia-stagesixs-projects/repzfit/settings/environment-variables

2. **Faça login com GitHub** (clique no navegador que abriu)

3. **Adicione a variável:**
   - Click "Add New Environment Variable"
   - **Name:** `EVOLUTION_UNIFIED_INSTANCE_NAME`
   - **Value:** `repzfit-unified-bot`
   - **Environments:** Production, Preview (deixe Development desmarcado)
   - Click "Save"

4. **Redeploy:**

   ```bash
   vercel deploy --prod
   ```

5. **Teste:**
   ```bash
   curl -X GET https://app.ezpersonal.com.br/api/health
   ```

---

## 📋 Informações Úteis

| Item                 | Valor                                           |
| -------------------- | ----------------------------------------------- |
| **Production URL**   | https://app.ezpersonal.com.br                   |
| **Latest Build**     | eeokrlfgu                                       |
| **Commit**           | d7fe90b                                         |
| **Migration**        | 202606170001_global_unique_student_whatsapp.sql |
| **Unified Instance** | repzfit-unified-bot                             |
| **Project Ref**      | ofergzualxqqovktyxwu                            |

---

## 🔍 Verificação Pós-Deploy

Após configurar a variável, teste:

```bash
# 1. Health check
curl https://app.ezpersonal.com.br/api/health

# 2. Admin login
curl -X POST https://app.ezpersonal.com.br/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"agencia@stagesix.com.br","password":"123456"}'

# 3. WhatsApp status (com token)
curl -X GET https://app.ezpersonal.com.br/api/admin/whatsapp/connection/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📞 Próximas Ações

- [ ] Configurar `EVOLUTION_UNIFIED_INSTANCE_NAME` em Vercel
- [ ] Redeploy
- [ ] Testar endpoints em produção
- [ ] Validar conflito 409 (duplicate WhatsApp)
- [ ] Inicializar instância Evolution (QRCode)
- [ ] Enviar mensagem de teste via bot

---

**Criado em:** 2026-06-18T00:53:00Z
