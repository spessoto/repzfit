# 🤖 Status da Configuração do Bot WhatsApp

## ✅ Configuração Realizada

### Webhook Evolution API

- **Instância**: `EVOLUTION_UNIFIED_INSTANCE_NAME` (instância única da plataforma)
- **Número WhatsApp**: `5511964099351`
- **Status**: ✅ Conectado
- **Webhook URL**: `https://project-pxgam.vercel.app/webhooks/evolution`
- **Eventos**: `MESSAGES_UPSERT`
- **Configurado em**: 26/05/2026 às 20:24

### Código do Bot

- ✅ Bot usa instância unificada da plataforma em toda a operação
- ✅ Webhook valida e processa apenas a instância esperada (`EVOLUTION_UNIFIED_INSTANCE_NAME`)
- ✅ Cada personal continua acessando somente seus próprios alunos (tenancy por `students.personal_id` + RLS)

---

## ⚠️ Para o Bot Funcionar

### 1. **Aluno Cadastrado**

O bot **só responde** para números de WhatsApp cadastrados como alunos no sistema.
Se o número não estiver cadastrado/vinculado, o bot orienta procurar o personal trainer.

**Alunos atuais no banco**:

- `5521999999999` - Aluno Teste
- `5511937474389` - Caio de Teste

**Número que deve mandar mensagem**: Qualquer número cadastrado acima

**Número que vai RESPONDER**: `5511964099351` (bot unificado)

### 2. **Treino Cadastrado**

O aluno precisa ter um treino cadastrado para o **dia da semana atual**.

- **Hoje é**: Terça-feira (dia 2)
- **Treino precisa ter**: `day_of_week = 2` (Terça)
- **Treino precisa ter**: Exercícios cadastrados

---

## 🧪 Como Testar

### Opção 1: Usar número já cadastrado

1. Use um celular com número **5521999999999** ou **5511937474389**
2. Mande mensagem para: **5511964099351**
3. Digite: **"Iniciar treino"**
4. O bot deve responder

### Opção 2: Cadastrar novo aluno

1. Acesse: https://project-pxgam.vercel.app/
2. Login: `personal.teste@repzfit.com` / `123456`
3. Vá em **Alunos** → **Criar Aluno**
4. Cadastre com o número do WhatsApp que vai testar
5. Vá em **Treinos** → **Criar Treino**
6. Selecione o aluno criado
7. Defina o dia da semana (Terça = dia 2)
8. Adicione exercícios ao treino
9. Salve o treino
10. Mande "Iniciar treino" pelo WhatsApp

### Opção 3: Conectar/Revalidar o número oficial do bot

1. Faça login como admin da plataforma
2. Abra a aba **Configurações de Embed**
3. Use a seção **Conexão WhatsApp do Bot Unificado**
4. Clique em **Conectar WhatsApp** e escaneie o QR Code
5. Verifique o status como **Conectado**

---

## 📊 Verificar Logs

Quando enviar a mensagem, verifique os logs do servidor:

```bash
# Logs locais (se servidor dev estiver rodando)
# Deve aparecer requisições POST /webhooks/evolution

# Logs de produção
vercel logs project-pxgam.vercel.app --follow
```

Se não aparecer nada nos logs, o webhook não está enviando para a URL correta.

---

## 🔧 Troubleshooting

### Mensagem não chega no servidor

- Verifique se o webhook está ativo na Evolution API
- Rode: `npx tsx scripts/setup-webhook.ts` novamente

### Bot não responde

- Verifique se o aluno está cadastrado
- Verifique se o aluno está vinculado a um personal
- Rode: `npx tsx scripts/check-students.ts`
- Verifique se há treino para hoje
- Rode: `npx tsx scripts/check-workouts.ts`

### Erro 401 no webhook

- Verifique se `EVOLUTION_WEBHOOK_SECRET` está correto no `.env` e na Vercel

---

## 📝 Próximos Passos

1. ✅ Webhook configurado
2. ⏳ Cadastrar aluno com número que vai testar
3. ⏳ Cadastrar treino para o aluno
4. ⏳ Enviar "Iniciar treino" pelo WhatsApp
5. ⏳ Verificar resposta do bot
