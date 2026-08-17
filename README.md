# EZ Personal — `repz-fit-backend`

Backend e painel web da plataforma **EZ Personal**: captura de dados de treino de alunos remotos via WhatsApp, com relatórios e dashboard para o personal trainer.

O aluno não instala aplicativo. Ele conversa com o bot no WhatsApp; o backend interpreta as mensagens, persiste no Supabase e alimenta o painel do personal.

| | |
|---|---|
| **Runtime** | Node.js (ESM) + TypeScript 5.9 |
| **Framework** | Fastify 5 |
| **Banco** | Supabase (Postgres + RLS) |
| **Canal** | WhatsApp via [Evolution API](https://doc.evolution-api.com) |
| **IA** | Amazon Bedrock (SigV4), OpenAI, Gemini |
| **Deploy** | Vercel (serverless) |
| **Versão** | v1.5.1 — ver [`CHANGELOG.md`](./CHANGELOG.md) |

---

## Estrutura

```
src/
├── app.ts                      # bootstrap Fastify (CORS, static, rotas, crons)
├── server.ts                   # entrypoint local (node/tsx)
├── config/
│   ├── env.ts                  # schema Zod de todas as variáveis de ambiente
│   └── supabase.ts             # clientes service_role e anon
├── routes/
│   ├── api/personal.ts         # API do painel do personal
│   ├── api/admin.ts            # API do painel administrativo
│   ├── webhooks/evolution.ts   # MESSAGES_UPSERT + CONNECTION_UPDATE
│   └── internal/rest-timer.ts  # polling do timer de descanso
├── services/
│   ├── bot-engine.ts           # máquina de estados da conversa (~3.700 linhas)
│   ├── evolution-service.ts    # cliente da Evolution API
│   ├── claude-service.ts       # Bedrock via AWS Signature V4
│   ├── gemini-service.ts       # Google Gemini
│   ├── openai-service.ts       # OpenAI
│   ├── email-service.ts        # alertas via Resend
│   └── personal-contact.ts     # normalização de contatos
├── cron/
│   ├── session-cleanup.ts      # encerra sessões órfãs
│   ├── rest-timer.ts           # dispara fim de descanso
│   └── connection-monitor.ts   # detecta queda do WhatsApp (5 min)
└── utils/
    ├── encryption.ts           # criptografia field-level (LGPD)
    ├── auth-cache.ts
    ├── system-logger.ts        # persiste em system_action_logs
    └── whatsapp.ts

api/index.ts                    # handler serverless da Vercel
public/                         # painel web estático (servido por @fastify/static)
scripts/                        # utilitários operacionais (tsx)
supabase/migrations/            # 45 migrations SQL, ordem cronológica
design-system/                  # tokens, componentes e guidelines visuais
```

---

## Máquina de estados do bot

`src/services/bot-engine.ts` conduz a sessão de treino por estados explícitos:

```
IDLE → START → AWAITING_WORKOUT_SELECTION → AWAITING_EXERCISE_ORDER_SELECTION
     → AWAITING_TRAINING_START → EXECUTING_SET → COLLECTING_REPS
     → COLLECTING_WEIGHT → COLLECTING_RPE → RESTING → …
     → COLLECTING_SESSION_RPE → IDLE
```

Estados auxiliares: `UNMONITORED_TRAINING` (treino sem acompanhamento passo a passo) e `ACTIVE_SESSION_CONFLICT` (aluno tenta abrir segunda sessão).

**O parsing é baseado em conteúdo, não em posição.** Consumir mensagens por ordem de chegada corrompe dados quando o aluno envia respostas em lote — comportamento normal no WhatsApp.

### Granularidade de captura

`student_workouts.tracking_mode` define quanto o aluno reporta:

| Modo | Comportamento |
|---|---|
| `per_rep` | série a série (padrão) |
| `per_exercise` | uma confirmação por exercício |
| `per_workout` | uma confirmação no fim do treino |
| `none` | sem captura conversacional |

A prescrição do personal é o registro-base; o aluno reporta o desvio. Quanto maior a granularidade, maior a fidelidade e maior o atrito — a escolha é por aluno.

---

## Setup local

Requisitos: Node.js 20+ e um projeto Supabase.

```bash
git clone https://github.com/spessoto/repzfit.git && cd repzfit
npm install
cp .env.example .env      # preencha os valores reais
npm run dev               # tsx watch — sobe em http://localhost:3333
```

Painel do personal em `/personal`, painel admin em `/admin`.

### Scripts npm

| Comando | Efeito |
|---|---|
| `npm run dev` | servidor com hot reload |
| `npm run build` | compila para `dist/` |
| `npm start` | roda o build |
| `npm run typecheck` | valida tipos de `src/` |
| `npm run check` | typecheck de `src/` + `scripts/` |

Rode `npm run check` antes de qualquer commit — não há CI validando tipos.

---

## Variáveis de ambiente

`src/config/env.ts` valida tudo com Zod no boot. Variável obrigatória ausente ou malformada derruba o processo com a lista de erros — falha explícita, não silenciosa.

**Obrigatórias:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `EVOLUTION_GLOBAL_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_UNIFIED_INSTANCE_NAME`.

**Opcionais relevantes:**

| Variável | Função |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Bedrock via SigV4 |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | provedores alternativos |
| `FIELD_ENCRYPTION_KEY` | criptografia de campos — 64 hex |
| `FIELD_HMAC_SECRET` | HMAC para busca em campos cifrados — 64 hex |
| `RESEND_API_KEY` | alertas por e-mail; sem ela, apenas log |
| `ALERT_EMAIL_TO` | destinatários, separados por vírgula |
| `CRON_SECRET` | autentica os endpoints de cron — mínimo 16 chars |
| `REST_TIMER_POLL_INTERVAL_MS` | intervalo do polling (padrão 1000) |

Gerar as chaves de 64 hex:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **`ADMIN_PANEL_EMAIL`, `ADMIN_PANEL_PASSWORD` e `ADMIN_TOKEN_SECRET` têm valores default no código.** São credenciais de desenvolvimento. Defina as três explicitamente em produção — sem isso o painel admin fica acessível com a senha default.

---

## Banco de dados

45 migrations em `supabase/migrations/`, nomeadas `YYYYMMDDNNNN_descricao.sql` e aplicadas em ordem cronológica.

```bash
npx tsx scripts/apply-migration.ts        # aplica pendentes
npx tsx scripts/check-schema.ts           # inspeciona o schema atual
```

RLS está ativo. Tabelas de log (`system_action_logs`, `bot_anomaly_logs`) são restritas a `service_role`.

O catálogo de exercícios separa catálogo de prescrição, com tabelas de lookup no lugar de enums do Postgres — assim o personal adiciona valores pelo painel sem exigir migration.

```bash
npx tsx scripts/seed-exercises-xlsx.ts    # importa catálogo de planilha
npx tsx scripts/report-unmapped-legacy-exercises.ts
```

> `.gitignore` exclui `*.xlsx`. As planilhas de exercícios ficam fora do versionamento — combine onde elas moram.

---

## Deploy

Vercel. `vercel.json` reescreve todas as rotas para `/api`, que instancia o Fastify uma vez e reaproveita entre invocações (`api/index.ts`).

**Os schedulers internos ficam desligados em serverless** — não há processo longo para hospedá-los. A divisão:

| Tarefa | Onde roda |
|---|---|
| `session-cleanup` | Vercel Cron, diário às 02:00 UTC |
| `rest-timer` | `pg_cron` no Supabase, a cada 3s |
| `connection-monitor` | processo local apenas; em produção depende do webhook `CONNECTION_UPDATE` |

`pg_cron` exige plano Pro no Supabase. A migration `202605270010_pgcron_rest_timer.sql` falha em silêncio se a extensão não estiver disponível — o timer de descanso simplesmente não dispara, sem erro visível. Confirme que a extensão está ativa depois de aplicar as migrations.

---

## Design system

`design-system/` traz os tokens (`tokens/*.css`), componentes de referência (`components/**/*.jsx`) e as guidelines visuais (`guidelines/*.card.html`).

Os tokens CSS são consumíveis direto pelo painel em `public/app.css`. Os componentes JSX são referência de especificação — o painel atual é HTML/CSS/JS estático, sem build de React. Os logos canônicos ficam em `public/img/Logo-fundo-*.png`.

---

## Convenções

- **Commits:** conventional commits com escopo, em português — `feat(ds):`, `fix(treinos):`, `feat(mobile):`.
- **CHANGELOG:** toda mudança relevante entra em `CHANGELOG.md`, agrupada por data e versão. É a fonte de verdade da versão — `package.json` está em `1.0.0` desde o início.
- **Logs:** use `logAction()` de `src/utils/system-logger.ts` em vez de `console.error`. Persiste em `system_action_logs` e espelha no logger do Fastify.

---

## LGPD

- Campos sensíveis são cifrados em repouso via `src/utils/encryption.ts`.
- WhatsApp é canal de transferência internacional de dados — precisa constar no aviso de privacidade.
- O processamento por IA (Bedrock, OpenAI, Gemini) precisa estar documentado no aviso.
- Consentimento destacado e específico é exigido **antes** da primeira captura.
- A captura por exceção — prescrição como base, aluno reporta desvio — atende ao princípio de minimização.

> Revisão jurídica dos termos de consentimento e dos contratos personal–plataforma continua pendente.

---

*Repositório privado. Uso interno EZ Personal.*
