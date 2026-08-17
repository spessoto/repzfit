# Changelog

Todas as mudanças relevantes do projeto serão documentadas aqui.

---

## [2026-08-17] – Redesign visual: topnav + página de Alunos (v1.5.0)

### Visual / UX

#### Navegação: sidebar removida → topnav horizontal
- A barra lateral (`<aside class="sidebar">`) foi **completamente substituída** por um header fixo horizontal (`<header class="topnav">`), alinhado ao novo projeto visual da plataforma EZ Personal.
- O topnav contém: logo + tagline à esquerda, abas de navegação centrais, e bloco de ações à direita (indicador do bot, ícone de perfil, ícone de configurações, nome do usuário, botão Sair).
- A aba ativa recebe um **pill verde** (`rgba(115,213,55,0.9)`) com texto escuro, idêntico ao design de referência.
- Totalmente responsivo: em telas pequenas o topnav compacta e oculta tagline e nome do usuário para preservar espaço.

#### Página de Alunos redesenhada
- **Cabeçalho de página** com título bold ("Alunos"), subtítulo dinâmico (ex: "6 alunos ativos · 2 mensalidades pendentes · 1 em atraso") e dois contadores à direita:
  - **Confirmaram hoje** — alunos com sessão completada no dia.
  - **Fantasma** (👻) — alunos ativos sem check-in há mais de 4 dias.
- **Formulário "Novo aluno"** reestruturado em grid horizontal de 4 colunas: Nome Completo, WhatsApp, Vencimento (dia do mês) e botão "Adicionar aluno". Campo `payment_day` agora é enviado na criação do aluno.
- **Lista de alunos** com:
  - Barra de busca por nome (filtro local, sem nova requisição).
  - Filtros rápidos por pill: Todos / Ativos / Pendentes / Atrasados.
  - Tabela com 5 colunas: **ALUNO** (avatar com iniciais colorido + nome + label de último check-in), **WHATSAPP** (link `wa.me/` clicável), **VENCIMENTO** ("Dia 10"), **STATUS** (badge Pago / Pendente / Atrasado), **AÇÕES RÁPIDAS** (5 ícones: editar, treinos, progresso, expandir, excluir).
  - Labels contextuais de check-in: "Confirmou hoje · 07:12", "Confirmou ontem", "Confirmou há N dias", "👻 sem confirmação há N dias".

### Backend — `GET /students/list` enriquecido
- O endpoint de listagem (`/api/students/list`) agora retorna campos adicionais por aluno **sem migration** (apenas SELECTs em tabelas existentes):
  - `payment_day` — dia do vencimento da mensalidade (descriptografado).
  - `last_session_date` + `last_session_created_at` — data e hora ISO da última sessão completada em `daily_sessions`.
  - `payment_status` — `"pago"` / `"pendente"` / `"atrasado"` calculado no servidor com base no registro de `student_payment_records` do mês corrente e no `payment_day`.
- As queries extras (`daily_sessions` e `student_payment_records`) são feitas em lote único por página de alunos, sem N+1.

### JavaScript
- `criarAluno()` inclui `payment_day` do novo campo de vencimento no POST.
- `carregarAlunos()` reescrito: renderiza avatares com iniciais, labels de check-in, badges de status e ações rápidas; atualiza contadores e subtítulo do cabeçalho.
- Novas funções de suporte: `filtrarAlunosLocal`, `setAlunosFilter`, `_renderizarTabelaAlunos`, `_atualizarAlunosStats`, `_alunoGetInitials`, `_alunoAvatarColor`, `_alunoCheckinLabel`, `_formatWhatsapp`, `_alunosMatchesFilter`.
- `querySelectorAll(".tab")` substituído por `querySelectorAll(".topnav-tab")` em `openPersonalPage` e `switchTab`.
- `setAdminModeUI` atualizado para usar `display: inline-flex` (compatível com `.topnav-tab`).

---

## [2026-08-04] – Bi-set, busca tolerante a acentos e correções de treino (v1.4.0)

### Adicionado

#### Bi-set na montagem e edição de treino
- **Checkbox "Combinar com outro exercício (Bi-set)"** adicionado ao formulário de cada exercício, tanto no form de criação de novo treino quanto na aba de edição de treino existente.
- Ao marcar o checkbox, um segundo bloco de seleção de exercício é exibido dinamicamente com busca completa em cascata: exercício, execução, equipamento, pegada/pisada, método + campos de repetições, peso e descanso após o bi-set.
- Validação: quando bi-set marcado, o 2º exercício e as repetições são obrigatórios antes de salvar.
- **Identificação visual** na lista de exercícios: exercícios do mesmo bi-set são agrupados em um card verde com badge **BI-SET**, separador central *"↓ Bi-set: executar em seguida sem descanso"* e indicador *"2º"* no exercício parceiro.
- O 1º exercício do bi-set é salvo sem descanso; o descanso configurado é atribuído ao 2º (após a conclusão do par).
- **Migration `202608040003_biset_group.sql`**: coluna `biset_group_id uuid` em `workout_exercises`; exercícios com o mesmo UUID pertencem ao mesmo bi-set; `NULL` = exercício independente; índice parcial `WHERE biset_group_id IS NOT NULL`.

#### Busca tolerante a acentos nos catálogos
- Pesquisar `"bulgaro"` agora encontra `"Agachamento búlgaro"`; `"abducao"` encontra `"Abdução"`, etc.
- **Migration `202608040001_unaccent_search_indexes.sql`**: extensão `unaccent` habilitada; função `normalize_search(text)` criada (`unaccent + lower`); índices btree funcionais em `exercise_catalog`, `exercise_variations`, `equipment_catalog`, `grip_footing_catalog` e `method_catalog`.
- **Migration `202608040002_search_catalog_rpc.sql`**: 5 funções RPC (`search_exercise_catalog`, `search_exercise_variations`, `search_equipment_catalog`, `search_grip_footing_catalog`, `search_method_catalog`) que aplicam `normalize_search` na coluna antes de comparar, garantindo busca insensível a acentos no lado do banco.
- Rotas `GET /exercise-catalog`, `GET /exercise-variations`, `GET /equipment-catalog`, `GET /grip-footing-catalog` e `GET /method-catalog` reescritas para usar as RPCs.

### Corrigido

- **Bug: nome do 1º exercício sumia ao adicionar novo exercício ao treino** — `querySelector("p")` removia o `<p class="exercise-title">` do primeiro exercício ao tentar limpar a mensagem de lista vazia. Corrigido para `querySelector("p:not(.exercise-title)")`.
- **Bug: `target_weight: Invalid input — expected number, received null`** no form de Novo Treino — campo peso era criado com `value="0"` e a lógica `peso ? parseFloat(peso) : null` enviava `null` para `"0"` (falsy). Corrigido para `value=""` e `(peso === "") ? null : parseFloat(peso)`.
- **Bug: warning `unexpected_fallback_in_non_idle_state` em `EXECUTING_SET`** — estado tratava apenas `isSetDoneIntent` sem bloco `else`; qualquer outra mensagem caía no fallback genérico. Corrigido com bloco `else` que responde ao aluno com instrução clara ("manda *feito* quando terminar a série").
- **Regex `isSetDoneIntent` expandida** com variações coloquiais: `bora`, `boa`, `vlw`, `valeu`, `foi`, `top`, `show`, `beleza`, `ótimo`, `vamos`, `já`, emojis 👍 💪 🔥, `yes`, `yep`, `claro`, `pode`.
- **Retry automático para erro 503 do Gemini API**: função `fetchWithRetry` com backoff exponencial (1s → 2s → 4s) adicionada ao `gemini-service.ts`; todas as chamadas ao Gemini usam retry automático antes de propagar o erro.

### Infraestrutura / Ferramentas

- **Git** v2.55.0, **Node.js** v24.19.0 LTS, **npm** v11.17.0, **Vercel CLI** v58.5.1 e **Supabase CLI** v2.111.0 instalados e configurados no ambiente de desenvolvimento local.
- Projeto vinculado à Vercel (`agencia-stagesixs-projects/repzfit`) e ao Supabase (`ofergzualxqqovktyxwu`, `sa-east-1`) via CLI.
- `safe.directory` configurado no Git para resolver conflito de ownership entre usuários do domínio.

---

## [2026-07-28] – Otimizações de backend e frontend (v1.2.9)

### Performance — Backend

- **Cache de autenticação** (`src/utils/auth-cache.ts`): as 2 queries seriais fixas por request (`auth.getUser` + `personals select`) agora são cacheadas por 60s em memória. Com a aba Treinos fazendo 21+ requests simultâneos, isso elimina até 42 queries de overhead de auth por carregamento.
- **`GET /workouts` com exercícios incluídos**: o endpoint agora retorna os exercícios de cada treino no próprio join, eliminando o padrão N+1 do frontend (antes: 1 request + N requests de exercícios; agora: 1 único request). Com 20 treinos: de 21 → 1 request.
- **3 novos endpoints focados** substituindo o `GET /students/:id/details` (7–9 queries, 50–120 KB):
  - `GET /students/:id/profile` — dados do perfil + histórico de pagamentos (2–3 queries, ~5 KB)
  - `GET /students/:id/workouts` — treinos atribuídos ao aluno sem campos desnecessários (1 query, ~10 KB)
  - `GET /students/:id/sessions?page=1&limit=20` — sessões paginadas (1 query, ~5 KB/página)
- **`GET /students/list`** com paginação (page/limit) e select mínimo (`id,name,whatsapp_number,is_active`): a listagem de alunos passou de 12 campos por aluno → 4 campos, com paginação de 50 por página. Payload reduzido ~70%.
- **`GET /students/:id/report`**: limites de set_logs reduzidos de 20.000 → 5.000 e daily_sessions de 500 → 200.
- **`available_workouts` removido de `/students/:id/details`**: eram até 20 KB de dados redundantes (o frontend já buscava via `GET /workouts` ao digitar).

### Performance — Frontend

- **`carregarDetalhesAlunoEditor`** refatorado: dispara `GET /profile` + `GET /workouts` em paralelo (`Promise.all`), e `GET /sessions` separadamente sem bloquear o render inicial. Tempo percebido de abertura de aluno cai de ~800ms para ~300ms.
- **`carregarAlunos`** usa `/api/students/list` com paginação (50 por página) — controles Anterior/Próxima renderizados automaticamente.
- **`carregarTreinosAluno`** eliminado o `Promise.all` de N requests de exercícios — exercícios já vêm no `GET /workouts`.
- **Paginação de sessões do aluno**: histórico de sessões carregado em páginas de 20 via `GET /sessions`, com controles de navegação.

---

## [2026-07-28] – Criptografia de dados sensíveis LGPD (v1.2.8)

### Segurança / LGPD

Implementada criptografia por campo (**AES-256-GCM**) para todos os dados pessoais e sensíveis armazenados no banco de dados, em conformidade com a LGPD (Lei 13.709/2018), especialmente o Art. 11 (dados sensíveis de saúde).

#### Campos criptografados

| Tabela | Campo | Categoria LGPD |
|---|---|---|
| `students` | `name`, `email`, `whatsapp_number` | Identificação pessoal |
| `students` | `blood_type`, `weight_kg`, `height_cm` | Saúde (Art. 11) |
| `students` | `monthly_fee`, `payment_day` | Financeiro |
| `personals` | `phone`, `crf_registration` | Identificação / profissional |
| `set_logs` | `reps_done`, `weight_used`, `rpe_score` | Saúde / biometria (Art. 11) |
| `student_weight_logs` | `weight_kg` | Saúde (Art. 11) |
| `bot_anomaly_logs` | `message`, `input_excerpt` | Comunicação privada |

#### Arquitetura

- **Módulo `src/utils/encryption.ts`** (novo): AES-256-GCM com IV aleatório por campo; formato de armazenamento `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`. Descriptografia transparente com fallback para texto legado (sem prefixo `v1:`).
- **HMAC-SHA256 determinístico** para campos de lookup (`students.whatsapp_hash`, `personals.phone_hash`): permite busca exata sem expor o plaintext.
- **Chave fora do banco**: `FIELD_ENCRYPTION_KEY` e `FIELD_HMAC_SECRET` (32 bytes cada) armazenados apenas como variáveis de ambiente na Vercel — o banco nunca tem acesso à chave.
- **Fallback gracioso**: se as chaves não estiverem configuradas, `encrypt()` retorna o plaintext e `decrypt()` retorna o valor como-está — sem quebrar o sistema em ambientes sem as variáveis.

#### Migrations e scripts

- `supabase/migrations/202607280003_lgpd_field_encryption_schema.sql`: altera colunas numéricas afetadas para `text`, adiciona colunas de hash, remove constraints de tipo `>0` incompatíveis com texto.
- `scripts/migrate-encrypt-fields.ts`: script idempotente de migração de dados existentes — executado uma vez para criptografar os registros em plaintext.

#### Dados já migrados

- **9 alunos** — todos os campos sensíveis criptografados
- **4 personals** — `phone` e `crf_registration` criptografados, hashes gerados
- **2 registros** de `student_weight_logs`
- **1 registro** de `set_logs`
- **25 registros** de `bot_anomaly_logs`

---

## [2026-07-28] – Otimização e limpeza do banco de dados (v1.3.0)

### Performance — Banco de dados

#### Índices críticos adicionados (migration `202607280004`)
- **`idx_workout_exercises_workout_id`** — FK `workout_id` em `workout_exercises` estava sem índice. Toda listagem de exercícios de um treino (`GET /workouts`, `GET /workouts/:id/exercises`) fazia full seq-scan na tabela. **Impacto crítico** em produção.
- **`idx_set_logs_workout_exercise_id`** — FK `workout_exercise_id` em `set_logs` sem índice. Gráficos de evolução de carga por exercício (`GET /students/:id/report`) faziam seq-scan em toda a tabela de séries. **Impacto crítico**.
- **`idx_daily_sessions_workout_id`** — FK `workout_id` em `daily_sessions` sem índice.
- **`idx_bot_state_student_id`** — FK `student_id` em `bot_state` sem índice.
- **`idx_exercises_personal_id`** — tabela legada `exercises` sem índice em `personal_id`. Toda query de leitura de exercícios privados fazia seq-scan.
- **`idx_exercise_variations_muscle_group_id`** e **`idx_exercise_combo_cache_muscle_group_id`** — FKs de baixa prioridade sem índice.

#### Índices redundantes removidos
- **`idx_bot_state_lookup`** — indexava `whatsapp_number` que já é a **PRIMARY KEY** da tabela (índice 100% inútil, duplicava espaço e overhead de escrita).
- **`idx_students_whatsapp`** — índice btree simples criado em 2026-05; substituído completamente pelo índice `UNIQUE` global criado em 2026-06 na mesma coluna.

### Limpeza de dados (migration `202607280005`)

#### Limpeza imediata executada
- `processed_webhook_events` com mais de 1 hora removidos (TTL normal é 10 min; acumulados entre deploys)
- `bot_anomaly_logs` resolvidos com mais de 90 dias removidos
- `bot_anomaly_logs` não resolvidos de baixa severidade (info/warn) com mais de 6 meses removidos
- `daily_sessions` abandonadas com mais de 1 ano removidas (cascade remove `set_logs` vinculados)
- Registros de `exercises` completamente órfãos (sem `exercise_catalog` e sem `workout_exercises`) removidos

#### pg_cron — 3 novos jobs de manutenção automática
| Job | Frequência | O que limpa |
|---|---|---|
| `repzfit-cleanup-webhook-events` | Diariamente às 3h | `processed_webhook_events` > 1 hora |
| `repzfit-cleanup-anomaly-logs` | Segunda-feira às 3h30 | `bot_anomaly_logs` resolvidos > 90 dias + não-resolvidos warn/info > 6 meses |
| `repzfit-cleanup-abandoned-sessions` | 1º de cada mês às 4h | `daily_sessions` abandonadas > 1 ano (cascade em `set_logs`) |

### Migration executada
- `supabase/migrations/202607280004_db_indexes_optimization.sql`
- `supabase/migrations/202607280005_db_cleanup_and_retention.sql`

---

## [2026-07-28] – Otimização de performance do frontend (v1.2.7)

### Melhorado
- **JS extraído para `/public/app.js` com `defer`**: o HTML principal passou de 342 KB para 48 KB. O JavaScript (263 KB / 6.437 linhas) agora é carregado com `defer` em arquivo separado, permitindo que o browser comece a renderizar o HTML imediatamente sem bloquear no parse/compile do JS. O arquivo é cacheável entre navegações.
- **CSS extraído para `/public/app.css`**: 31 KB de estilos agora em arquivo separado e cacheável, referenciado via `<link>` no `<head>`.
- **Cache-busting**: `?v=202607281134` adicionado nos URLs de `app.js` e `app.css` para invalidar cache dos browsers na atualização.
- **Logos convertidas para WebP e redimensionadas**: `Logo-fundo-claro.png` (1.221 KB) → WebP 26 KB (−98%); `Logo-fundo-escuro.png` (716 KB) → WebP 18 KB (−97%). `icon.png` (66 KB) → WebP 6 KB (−90%). Total de imagens: de 1,94 MB para 44 KB.
- **Atributos `width`/`height` e `loading="lazy"`** adicionados em todas as imagens do HTML, eliminando Layout Shift (CLS) durante o carregamento.
- **N+1 corrigido em `carregarTreinosAluno`**: busca de detalhes dos treinos convertida de loop serial (`for...await`) para `Promise.all` — 10 treinos agora resultam em 1 + 10 requisições paralelas em vez de 11 seriais.
- **Cache de aba em memória**: ao navegar entre abas (Alunos, Financeiro, Exercícios, Treinos), os dados já buscados não são recarregados do servidor. A flag é invalidada automaticamente quando a própria função de carregamento é chamada diretamente (após salvar/excluir).
- **Polling de status WhatsApp**: intervalo aumentado de 10s para 30s, reduzindo em 66% as requisições de background sem impacto perceptível na UX.

### Operação de banco executada
- Nenhuma migration necessária.

---

## [2026-07-28] – Extrato completo e regras de inatividade no bot (v1.2.6)

### Adicionado
- **Regra de inatividade 60 min**: após 60 minutos sem atividade do aluno durante um treino, o bot envia automaticamente "Oi! Você ainda está aí? 👀". O aviso é enviado apenas uma vez por sessão.
- **Regra de inatividade 90 min**: após 90 minutos sem atividade, o bot envia "Pelo visto seu treino já deve ter terminado. Vou encerrar aqui. Bom descanso. 💤" e encerra o treino automaticamente, gerando extrato e notificando o personal. A detecção é feita pelo mesmo polling do rest-timer (pg_cron a cada 3s), via a nova função `processInactiveTrainingSessions()`.

### Corrigido / Melhorado
- **Extrato ao encerrar treino** (`buildSimpleExerciseList`): agora exibe também exercícios **em andamento** (marcados com ⏳ e `*(em andamento)*`) e exercícios **não iniciados** (marcados com ❌ na seção "Não realizados"), além dos concluídos (✅). Antes, apenas exercícios totalmente concluídos apareciam.
- **Extrato detalhado** (`buildWorkoutSummary`, modos `per_rep`/`per_exercise`): exercícios com séries parciais agora exibem _(X/Y séries)_ ao lado do nome. Exercícios não tocados aparecem na seção "Não realizados" (requer `tracking` passado como parâmetro).
- **Relatório salvo no banco** (`finishTrainingEarly`): o `personalReport` agora inclui corretamente o extrato de séries em vez de string vazia, corrigindo o dado persistido em `daily_sessions.summary`.
- **Modo `per_workout` ao encerrar**: o extrato agora passa `current_workout_exercise_id` para marcar o exercício em andamento no momento do encerramento.

### Migration executada
- `supabase/migrations/202607280002_bot_state_last_activity_at.sql` — adiciona coluna `last_activity_at timestamptz` ao `bot_state` com backfill de `updated_at` e índice parcial para o polling de inatividade.

---

## [2026-07-28] – Correção do disparo automático do timer de descanso (v1.2.5)

### Corrigido
- **Bug crítico**: `processExpiredRestTimers()` não incluía `current_state` na cláusula `.select()` do Supabase. O campo retornava `undefined` para todos os registros, fazendo o `if (state.current_state === "RESTING")` nunca ser verdadeiro — o bot encontrava os timers expirados mas nunca enviava a mensagem de fim de descanso, apenas limpava `rest_end_at` silenciosamente.
- **Bug crítico**: o endpoint `/api/internal/rest-timer/poll` não estava registrado nos crons do Vercel (`vercel.json`). Em produção (serverless), o `setInterval` in-process é desabilitado explicitamente; sem o cron no Vercel, nenhum polling periódico ocorria. O polling é inteiramente coberto pelo pg_cron a cada 3s (já configurado no banco). Nota: o plano Hobby da Vercel não suporta crons com frequência maior que diária; o pg_cron é a solução definitiva para resolução em segundos.
- **Bug moderado**: o branch `else` de `fireExpiredRest()` (hint desconhecido) redefinia o estado mas não enviava nenhuma mensagem ao aluno, deixando-o sem feedback para continuar o treino. Agora envia "✅ Descanso concluído! Pode continuar com a próxima série. 💪".

### Melhorado
- `pg_cron` reconfigurado na nova migration `202607280001`: job renomeado para `repzfit-rest-timer-poll-v3`, versões anteriores removidas, e header `Authorization` adicionado dinamicamente via `app.cron_secret` (quando configurado) para proteção futura com `CRON_SECRET`.
- Criado índice parcial `idx_bot_state_rest_timer` em `bot_state(current_state, rest_end_at) WHERE rest_end_at IS NOT NULL` para evitar full scan a cada ciclo de polling.

### Migration executada
- `supabase/migrations/202607280001_rest_timer_index_and_pgcron_auth.sql`

---

## [2026-07-28] – Correção de encoding dos emojis nas mensagens do bot (v1.2.4)

### Corrigido
- Corrigidos 114 emojis e caracteres especiais corrompidos em `src/services/bot-engine.ts` que apareciam como sequências mojibake (`ðŸ"¥`, `â±`, `âœ…`, `1ï¸âƒ£` etc.) nas mensagens enviadas pelo bot ao WhatsApp dos alunos. A corrupção era causada por double-encoding Windows-1252→UTF-8 aplicado sobre os bytes originais dos emojis. Todos os emojis afetados foram restaurados: 🔥 💪 ✅ ⏱ 🎯 🏋️ 🤲 🧩 📝 📊 📋 📅 🎉 🎤 😅 🔸 💡 😊 1️⃣ 2️⃣ e o traço — (em dash).
- Removido o BOM UTF-8 desnecessário do início do arquivo `src/services/bot-engine.ts`.
- Corrigidos caracteres portugueses com double-encoding no mesmo arquivo: `Ó` (em RELATÓRIO), `Ú` (em Último) e `×` (sinal de multiplicação nas metas de séries).

### Operação de banco executada
- Nenhuma migration necessária (correção exclusivamente de mensagens de texto no código).

---

## [Unreleased]

### Corrigido / Melhorado
- **Duplicação de código**: `normalizeBrazilWhatsappNumber` e `buildWebhookUrlFromRequest` extraídas para `src/utils/whatsapp.ts` e `src/utils/request.ts` — removidas 4 cópias redundantes.
- **Código morto**: Estado `AWAITING_MONITORING_CHOICE` removido do bot (nunca era atingível após refactor do fluxo de rastreamento).
- **Funções duplicadas**: `isTrainingStartIntent` removida de `gemini-service.ts` (versão interna do `bot-engine.ts` é a usada). `generateFallbackReply` removida de `openai-service.ts` (redundante com a versão do Gemini).
- **Dependências mortas**: `node-fetch`, `@vercel/speed-insights` e `pg` removidos de `package.json` (nunca importados no código-fonte).
- **Vulnerabilidades**: 4 vulnerabilidades corrigidas via `npm audit fix` (`brace-expansion`, `esbuild`, `fast-uri`, `find-my-way`). Vulnerabilidade do `xlsx` sem fix disponível — documentada e mitigada por uso exclusivo em rotas autenticadas.
- **Segurança**: `ADMIN_PANEL_PASSWORD` comparada com `crypto.timingSafeEqual` em vez de `===` plaintext.
- **Segurança**: Avisos de credenciais padrão (`ADMIN_PANEL_PASSWORD`, `ADMIN_TOKEN_SECRET`) agora emitidos em **todos** os ambientes (antes só em produção).
- **Segurança**: Aviso emitido quando `CRON_SECRET` não está configurado em produção.
- **Segurança**: Endpoint `/api/internal/rest-timer/poll` protegido com `CRON_SECRET`.
- **URLs hardcoded**: Origens CORS de produção (`project-pxgam.vercel.app`, `app.ezpersonal.com.br`) removidas do código — controladas por `FRONTEND_URL`. Fallback do webhook usa `FRONTEND_URL` antes da constante.
- **TypeScript**: Criado `tsconfig.scripts.json` — a pasta `scripts/` agora é verificada pelo typecheck. Scripts corrigidos: `pg` readicionado como devDependency, `node-fetch` substituído por `fetch` nativo, tipos explicitados.

---

## [2026-07-16] – Correção da exclusão de exercícios no cadastro (v1.2.3)

### Corrigido
- Corrigida a exclusão de exercícios no endpoint `DELETE /api/exercise-catalog/:id`: exercícios compartilhados da base (`personal_id = NULL`), como "Abdominal máquina", não eram removidos por causa de filtro incorreto por `personal_id`.
- Removido bloqueio indevido que impedia apagar exercícios já usados em treinos. O banco já trata as referências automaticamente via `ON DELETE SET NULL`/`ON DELETE CASCADE` no modelo atual.

### Alterado
- O delete de `exercise_catalog` agora aceita registros `personal_id IS NULL` e do personal autenticado, alinhando o comportamento com o restante das rotas de catálogo.

### Operação de banco executada
- Nenhuma migration nova foi necessária para esta correção de lógica de API.

---

## [2026-07-14] – Grupo muscular no fluxo do bot para exercícios sem vínculo legado (v1.2.2)

### Corrigido
- Revisão completa do fluxo de conversa do bot (`src/services/bot-engine.ts`) em busca de efeitos colaterais das mudanças recentes em exercícios/treinos.
- O bot deixou de mostrar o grupo muscular ("💪 Músculo: ...") para exercícios cadastrados apenas no catálogo novo (sem vínculo legado): a busca só lia `exercises.muscle_group` e ignorava o `muscle_group_id` opcional adicionado ao `exercise_catalog`. Isso afetava a mensagem de início de exercício, o menu de seleção de exercícios e o aviso de fim de descanso ao avançar para o próximo exercício.
- Corrigido o tipo `WorkoutExercise.exercise_id` para refletir que ele pode ser `null` (exercício sem vínculo legado), evitando inconsistência de tipos com o novo modelo de dados.

## [2026-07-14] – Exercício como único campo obrigatório e IA sem dependência de campos opcionais (v1.2.1)

### Corrigido
- Corrigido o erro `exercise_id or exercise_variation_id must be provided` ao salvar um treino: o exercício (catálogo) sozinho já era suficiente no fluxo novo, mas o backend ainda exigia um vínculo legado ou uma execução selecionada. Agora `exercise_catalog_id` isoladamente satisfaz a validação, tanto na criação do treino quanto na adição de um item a um treino existente.
- Corrigida a geração de descrição por IA para não exigir mais Execução, Equipamento, Pegada/Pisada ou Método preenchidos: o botão "Gerar descrição com IA" agora só depende do exercício selecionado, e a IA usa apenas as informações que o personal realmente preencheu.
- Corrigidos ~407 caracteres especiais que apareciam como `�` em toda a tela de Exercícios e Treinos (rótulos, alertas, placeholders), causados por uma corrupção de codificação pré-existente no arquivo. O conteúdo textual foi restaurado para UTF-8 correto sem alterar nenhuma lógica.
- Corrigida a mensagem enviada pelo bot do WhatsApp ao término do descanso: quando o exercício não tinha vínculo legado, o aluno recebia o nome genérico "Exercício" em vez do nome real cadastrado no catálogo.
- Corrigido o resumo de sessões concluídas (histórico do aluno no painel do personal), que também exibia "Exercício" genérico para itens de treino sem vínculo legado em vez do nome do catálogo/execução.

### Alterado
- `POST /api/exercise-combos/generate-description` passou a aceitar `exercise_variation_id`, `equipment_id`, `grip_footing_id` e `method_id` como opcionais; o cache de descrição por combinação só é usado/gravado quando uma execução é selecionada.

## [2026-07-14] – Exercícios cadastrados completos na seleção de treino (v1.2.0)

### Corrigido
- Corrigida a causa raiz de exercícios cadastrados (ex.: "Abdominal com anilha") não aparecerem na busca ao montar um treino: o seletor da aba de edição de treino carregava um conjunto de funções de busca duplicado e desatualizado, que sobrescrevia silenciosamente a versão já corrigida e limitava a lista às combinações pré-cadastradas da planilha original. As duplicidades foram removidas.
- O campo Exercício (tanto na criação quanto na edição de treino) agora busca diretamente em todo o catálogo cadastrado, em vez de depender apenas de combinações pré-existentes.

### Alterado
- Grupo muscular agora é um vínculo opcional do próprio exercício (`exercise_catalog.muscle_group_id`), usado apenas como filtro: ao selecioná-lo, a lista de exercícios mostra todas as opções cadastradas ligadas àquele grupo.
- O formulário de cadastro de exercício ganhou um seletor opcional de grupo muscular, e a listagem de exercícios permite atribuir/alterar o grupo de cada exercício já cadastrado.
- O filtro de grupo muscular no editor de treino passou a listar todos os grupos cadastrados (via `/api/muscle-groups`), não apenas os presentes nas combinações antigas.

### Migration executada
- `supabase/migrations/202607140002_add_muscle_group_to_exercise_catalog.sql` (adiciona `muscle_group_id` a `exercise_catalog` e faz backfill a partir das combinações pré-existentes).

## [2026-07-14] – Autocomplete completo nos campos de treino (v1.1.9)

### Alterado
- O carregamento dos campos de treino passou a buscar listas completas em vez de cortes parciais de 20 ou 50 itens.
- O autocomplete de exercício, execução, equipamento, pegada/pisada e método agora carrega todas as opções disponíveis no foco, respeitando o grupo muscular quando ele está selecionado.

### Corrigido
- Evitado truncamento de opções no dropdown principal de exercícios causado pelo limite da árvore de combinações.

### Ajuste técnico
- O endpoint `GET /api/exercise-combos/tree` passou a aceitar um volume maior de registros para suportar listas completas no editor de treino.

## [2026-07-14] – Salvamento de treino sem vínculo legado obrigatório (v1.1.8)

### Corrigido
- O salvamento de treino voltou a funcionar quando a variação selecionada não possui `exercise_id` legado.
- A coluna `exercise_id` em `workout_exercises` passou a aceitar `NULL`, alinhando o banco ao fluxo normalizado de exercícios.

### Migration executada
- `supabase/migrations/202607140001_make_workout_exercise_id_nullable.sql`

## [2026-07-14] – Criação de treino com filtros flexíveis e fallback de variações (v1.1.7)

### Alterado
- O grupo muscular na criação e edição de treino passou a funcionar como filtro opcional para simplificar a seleção de exercícios.
- Os campos de Equipamento, Execução, Pegada/Pisada e Método passaram a buscar e aceitar qualquer valor registrado nos catálogos, sem depender apenas das combinações relacionais.

### Corrigido
- O cadastro de treino deixou de falhar com a mensagem `Exercise variation is not linked to a legacy exercise. Please re-import exercises.` quando a variação selecionada não possui vínculo legado.

### Operação de banco executada
- Nenhuma migration nova foi necessária para esta correção; o esquema remoto já estava sincronizado com as migrations locais.

## [2026-07-13] – Correção do login no painel (v1.1.6)

### Corrigido
- O login voltou a expor corretamente a função global `login()` no carregamento da página.
- O formulário inicial volta a responder ao botão `Entrar` e ao clique no botão de mostrar senha.
- Removida a declaração duplicada que impedia o script do painel de ser carregado no navegador.

## [2026-07-13] – Correção do dropdown de grupo muscular no treino (v1.1.5)

### Corrigido
- O campo de grupo muscular voltou a aparecer no formulário de criação de treino.
- O dropdown de grupo muscular agora abre ao clicar no campo e lista as opções disponíveis mesmo sem digitação.
- A seleção em cascata do treino segue iniciando por grupo muscular antes de filtrar exercício, execução e demais campos.

## [2026-07-13] – Editor de treino em cascata por base original (v1.1.4)

### Alterado
- Criação e edição de treinos agora começam por grupo muscular e seguem a cascata da planilha original: grupo muscular → exercício → execução → equipamento → pegada/pisada → método.
- Campos do editor de treino foram reorganizados em duas colunas para facilitar o preenchimento.
- Os campos continuam com busca por digitação, mas agora o dropdown exibe todas as opções disponíveis do passo atual ao receber foco.

### Adicionado
- Endpoint `GET /api/exercise-combos/tree` para servir a árvore de combinações derivada da planilha `src/exercicios seed 150.xlsx`.
- Tabela `exercise_combo_options` para materializar cada linha da planilha como combinação exata usada pelo editor de treino.

### Operação de banco executada
- `exercise_combo_options` preenchida com as 150 combinações originais da planilha.

### Migrações relevantes
- `supabase/migrations/202607130003_add_exercise_combo_dimensions.sql`
- `supabase/migrations/202607130004_add_exercise_combo_options.sql`

## [2026-07-13] – Seed completo da base de exercícios (v1.1.3)

### Adicionado
- Script de seed `scripts/seed-exercises-xlsx.ts` para popular a base normalizada diretamente da planilha `src/exercicios seed 150.xlsx`.
- Mapeamento explícito das colunas da planilha para `muscle_groups`, `exercise_catalog`, `equipment_catalog`, `exercise_variations`, `grip_footing_catalog` e `method_catalog`.

### Operação de banco executada
- Base de exercícios populada do zero a partir da planilha de 150 linhas, respeitando os títulos de coluna.

### Migrações relevantes
- Nenhuma migration adicional foi necessária para esta carga de seed.

---

## [2026-07-13] – Reorganização completa da base de exercícios (v1.1.2)

### Adicionado
- Painel **Grupo Muscular** na tela de Exercícios com CRUD completo (cadastrar/excluir), backed pelo `muscle_groups`.
- Painel **Observações** na tela de Exercícios: exibe todos os exercícios com campo de notas editável por linha.
- Campo `notes` em `exercise_catalog` para armazenar observações por exercício.
- Endpoint PATCH `/api/exercise-catalog/:id/notes` para salvar observações.
- Endpoints GET/POST/DELETE `/api/muscle-groups` para CRUD de grupos musculares.

### Alterado
- Painéis da tela de Exercícios reorganizados na ordem: **Grupo Muscular → Exercício → Equipamento → Execução → Pegada/Pisada → Método → Observações**.

### Operação de banco executada
- Base de exercícios limpa totalmente (exercises, exercise_catalog, exercise_variations, equipment_catalog, grip_footing_catalog, method_catalog, muscle_groups, exercise_combo_cache, workout_exercises).

### Migrações relevantes
- supabase/migrations/202607130002_exercise_catalog_notes_and_muscle_group_crud.sql

---
## [2026-07-13] – Ajustes finais de pagamentos e nova base de exercícios (v1.1.1)

### Alterado
- Lista de controle de pagamentos na edição de aluno agora mostra somente meses entre a inclusão do aluno e o mês atual.
- Janela de meses no controle de pagamentos limitada aos últimos 5 meses, com atualização automática do mês corrente.
- Layout da edição de aluno reorganizado em 2 colunas para os blocos de Controle de pagamentos e Atribuição de treino.
- Modelo XLS de importação de exercícios ampliado com colunas opcionais e aba de instruções.

### Scripts operacionais
- scripts/import-exercises.ts atualizado para mapear colunas da planilha de seed (Grupo Muscular, Exercício, Equipamento, Execução, Pegada/Pisada, Método e Observações).
- scripts/sql/reset-exercise-base.sql adicionado para limpeza rápida da base de exercícios normalizada.

### Operação de banco executada
- Seed importado a partir de src/exercicios seed 150.xlsx para preencher a nova base normalizada.
- Registros legados remanescentes removidos após validação de impacto em workout_exercises.

---

## [2026-07-13] – Financeiro, importação XLS e reset de base de exercícios

### Adicionado

#### Financeiro
- Nova aba Financeiro no painel do personal com indicadores do mês: valor recebido, total de alunos, pendentes/atrasados e próximos do vencimento.
- Listas de alunos em atraso e alunos próximos do vencimento.
- Novos campos no aluno: monthly_fee (valor da mensalidade) e payment_day (dia de pagamento).
- Histórico mensal de recebimentos por aluno (mês/ano) com controle de status Recebido.
- Endpoint GET /api/finance/dashboard para consolidado financeiro do personal.
- Endpoints GET /api/students/:id/payments e PATCH /api/students/:id/payments/:referenceMonth para leitura e atualização de recebimentos.

#### Exercícios
- Botão Importar XLS no catálogo de exercícios para cadastro em massa.
- Botão Baixar Modelo XLS para download de planilha padrão de importação.
- Endpoint GET /api/exercise-catalog/import-template para geração do modelo XLSX.
- Endpoint POST /api/exercise-catalog/import-xls para importação em massa com opção de reset prévio.
- Botão Zerar Minha Base no módulo de exercícios.
- Endpoint POST /api/exercise-catalog/reset-base para limpeza segura da base própria do personal.

### Alterado
- GIF passou a ficar vinculado apenas ao exercício base; removido do cadastro de execuções/variações.
- Payload de criação/edição de treino ajustado para não enviar IDs opcionais como null quando não selecionados.
- Validação de criação de treino ajustada para aceitar IDs opcionais nulos no backend, evitando erro de tipo em campos opcionais.

### Corrigido
- Correção do erro ao criar treino com campos opcionais vazios (ex.: equipment_id), que retornava invalid_type/expected string/received null.

### Migrações relevantes
- supabase/migrations/202607130001_add_financial_control.sql

---

## [2026-07-07] – Modelo normalizado de exercícios, nova base, GIF e descrição customizada

### Adicionado

#### Banco de dados
- Novas tabelas: muscle_groups, exercise_catalog, exercise_variations, equipment_catalog, exercise_variation_equipments.
- Colunas gif_url e gif_storage_path em exercises e exercise_variations.
- Coluna exercise_variation_id em workout_exercises para vincular ao modelo normalizado.
- Coluna custom_description em workout_exercises: o personal pode sobrescrever a descrição por item de treino sem alterar o padrão global.
- RLS configurado para todas as novas tabelas.

#### API
- POST /api/exercises/:id/gif/upload-url – URL assinada para upload de GIF no Supabase Storage.
- POST /api/exercises/:id/gif/finalize – persiste path e URL pública do GIF após upload.
- GET /api/workouts/:id/exercises retorna description resolvida (custom → padrão), description_default, custom_description, equipment e gif_url.
- Criação e edição de item de treino aceitam exercise_variation_id e custom_description.

#### Bot
- Descrição exibida durante treino prioriza custom_description do item; padrão permanece inalterado no sistema.

#### Frontend
- Campo de URL do GIF no formulário de exercício e coluna GIF na tabela.
- Editor de item de treino exibe descrição padrão e campo editável de descrição personalizada por item.

#### Scripts operacionais
- scripts/import-exercises.ts – importador normalizado com swap seguro da base antiga e remapeamento de histórico.
- scripts/report-unmapped-legacy-exercises.ts – auditoria de exercícios legados sem vínculo ao modelo normalizado.
- scripts/promote-unmapped-legacy-to-normalized.ts – promove legados referenciados para o modelo normalizado preservando histórico.
- scripts/cleanup-unlinked-shared-exercises.ts – remove exercícios compartilhados sem referência ativa.
- scripts/apply-sql-file.ts / scripts/apply-sql-file-rpc.ts – execução de SQL arbitrário via Postgres ou RPC Supabase.

### Alterado
- Schemas de validação de exercício e item de treino atualizados para os novos campos.
- Importador de exercícios reescrito para o modelo de três entidades com mapeamento robusto e backfill idempotente.
- .gitignore passou a excluir arquivos .xlsx do controle de versão.

### Migrações relevantes
- supabase/migrations/202607070001_normalize_exercises_and_custom_descriptions.sql

---

## [2026-06-25] – Logs admin, melhorias de bot e consolidação de dados

### Adicionado
- Integração do snippet de Vercel Speed Insights nas páginas principais do app.
- Página de logs administrativos e registro de anomalias do bot.
- Testes de regressão para o tratamento de contatos do personal e para as mensagens de transição de descanso.

### Corrigido
- Remoção da duplicidade do pedido de confirmação feito nas mensagens de descanso e transição entre séries/exercícios.
- Melhoria na entrega das notificações para personais ao iniciar e finalizar treinos.
- Normalização mais robusta do número do personal para WhatsApp, aceitando formatos variados.
- Ajuste do fluxo do bot para evitar mensagens repetitivas em momentos consecutivos.
- Consolidação do modelo de dados no Supabase para reduzir colunas duplicadas e centralizar datas de atribuição.

### Alterado
- O bot passou a usar mensagens mais curtas e objetivas nas transições de descanso.
- As rotas de personal passaram a consumir a fonte canônica de datas de treino em student_workouts.
- O fluxo de relatórios para personais ficou mais consistente e passível de rastreamento em logs.

### Migrações relevantes
- supabase/migrations/202606250001_consolidate_contact_and_assignment_dates.sql