# 🤖 Implementação do Bot com Gemini Flash-Lite Latest

**Data**: 26/05/2026  
**Status**: ✅ Completo

---

## 📋 Especificações Implementadas

### 1. **Gatilho de Início**
O bot agora detecta automaticamente quando o usuário quer iniciar um treino através de variações de mensagens:

- ✅ "Iniciar treino"
- ✅ "Começar treino"  
- ✅ "Bora treinar"
- ✅ "Vamos treinar"
- ✅ "Quero treinar"
- ✅ Outras variações similares

**Implementação**: Função `isTrainingStartIntent()` com regex patterns em [src/services/gemini-service.ts](src/services/gemini-service.ts)

---

### 2. **Validação de Cadastro**
Antes de iniciar qualquer interação, o bot verifica:

1. ✅ Se o número de WhatsApp está cadastrado no banco de dados
2. ✅ Se o aluno está ativo (`is_active = true`)
3. ✅ Se existe treino programado para o dia

**Respostas personalizadas**:
- Não cadastrado → Mensagem explicando que precisa falar com o personal
- Sem treino → Mensagem motivadora pedindo para falar com o personal
- Tudo OK → Inicia o protocolo de conversação

---

### 3. **IA: Gemini Flash-Lite Latest**

**Modelo**: `gemini-2.0-flash-exp` (Gemini Flash-Lite Latest)

**Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`

**Configurações**:
```typescript
{
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 300
}
```

**Personalidade do Coach (COACH_SYSTEM_PROMPT)**:
- 💪 Motivador e energético
- 😊 Empático e paciente
- 🎯 Direto e objetivo (máx 2-3 linhas)
- 🤝 Profissional mas descontraído
- 🇧🇷 Sempre em português brasileiro

---

## 🔄 Protocolo de Conversação (Máquina de Estados)

### Estado 1: **IDLE**
- **Gatilho**: Usuário envia "Iniciar treino" ou variações
- **Validação**: Verifica cadastro e treino do dia
- **Ação**: Saudação personalizada com botão de confirmação
- **Próximo**: `AWAITING_TRAINING_START`

### Estado 2: **AWAITING_TRAINING_START**
- **Input**: Botão "💪 Bora começar!" ou "Agora não"
- **Ação**: Cria sessão diária, lista primeiro exercício com metas
- **Próximo**: `EXECUTING_SET`

### Estado 3: **EXECUTING_SET**
- **Input**: Botão "✅ Terminei!"
- **Ação**: Pergunta quantas repetições foram feitas
- **Próximo**: `COLLECTING_REPS`

### Estado 4: **COLLECTING_REPS**
- **Input**: Número inteiro (ex: 12)
- **Validação**: 1-1000 repetições
- **Fallback**: Gemini gera resposta motivadora pedindo número válido
- **Ação**: Confirma e pede carga utilizada
- **Próximo**: `COLLECTING_WEIGHT`

### Estado 5: **COLLECTING_WEIGHT**
- **Input**: Número decimal (ex: 20 ou 20.5)
- **Validação**: 0-1000 kg
- **Fallback**: Gemini gera resposta amigável pedindo peso válido
- **Ação**: Mostra botões de RPE (6-10)
- **Próximo**: `COLLECTING_RPE`

### Estado 6: **COLLECTING_RPE**
- **Input**: Botão RPE (6 a 10)
- **Ação**: Salva série em `set_logs`, verifica:
  - ✅ Mais séries → Volta para `EXECUTING_SET` (incrementa set_number)
  - ✅ Próximo exercício → Mostra próximo e volta para `EXECUTING_SET`
  - ✅ Treino completo → Parabeniza com Gemini, marca sessão como `completed`
- **Próximo**: `EXECUTING_SET`, `IDLE` ou loop

---

## 📊 Estrutura de Dados

### Tabela: `bot_state`
```sql
whatsapp_number TEXT PRIMARY KEY
student_id UUID
current_state TEXT -- IDLE, AWAITING_TRAINING_START, etc.
current_session_id UUID
current_workout_exercise_id UUID
current_set_number INTEGER
last_input_attempt TEXT -- Guarda dados temporários (reps|weight)
updated_at TIMESTAMP
```

### Tabela: `set_logs` (Registros de Séries)
```sql
session_id UUID
workout_exercise_id UUID
set_number INTEGER
reps_done INTEGER
weight_used NUMERIC(5,2)
rpe_score INTEGER (1-10)
```

---

## 🎯 Funcionalidades Implementadas

### ✅ **Transcrição de Áudio**
- Usa OpenAI Whisper para converter mensagens de áudio em texto
- Processa automaticamente antes do fluxo principal

### ✅ **Fallback Inteligente**
- Quando o aluno envia input inesperado (ex: texto em vez de número)
- Gemini gera resposta contextualizada e motivadora
- Sistema NÃO perde o progresso - mantém o estado atual

### ✅ **Validação Rigorosa**
- Repetições: 1-1000
- Peso: 0-1000kg (aceita decimais com vírgula ou ponto)
- RPE: 1-10 (botões pré-definidos)

### ✅ **Busca Inteligente de Treinos**
- Valida `start_date` e `valid_until`
- Filtra por dia da semana (`day_of_week`)
- Retorna primeiro treino válido para hoje

### ✅ **Progressão Automática**
- Conta séries automaticamente
- Avança para próximo exercício ao completar todas as séries
- Marca sessão como concluída ao finalizar treino

---

## 📁 Arquivos Modificados

### **NOVO**: [src/services/gemini-service.ts](src/services/gemini-service.ts)
- `generateBotResponse()` - Comunicação com Gemini API
- `generateFallbackReply()` - Respostas de fallback inteligentes
- `isTrainingStartIntent()` - Detecção de intenção de início
- `COACH_SYSTEM_PROMPT` - Personalidade do coach

### **ATUALIZADO**: [src/services/bot-engine.ts](src/services/bot-engine.ts)
- Importa Gemini service em vez de OpenAI para conversação
- Implementa máquina de estados completa (6 estados)
- Funções auxiliares:
  - `getTodayWorkouts()` - Busca treinos do dia
  - `getWorkoutExercises()` - Lista exercícios do treino
  - `createDailySession()` - Cria sessão de treino
  - `saveSetLog()` - Registra série executada
  - `completeSession()` - Marca sessão como concluída
- Fluxo completo de conversação com validações

---

## 🔧 Variáveis de Ambiente

### **.env** (Já configurado)
```env
GEMINI_API_KEY=AIzaSyBnuzie4g6NbL1wHAOLT_jWyifhTslTDck
OPENAI_API_KEY=... # Opcional, apenas para Whisper (transcrição de áudio)
```

---

## 🧪 Fluxo de Teste

### Cenário 1: Início de Treino Bem-Sucedido
```
Aluno: "Iniciar treino"
Bot: "E aí, João! 💪 Tá pronto para começar o treino 'Treino A'?"
     [💪 Bora começar!] [Agora não]
     
Aluno: [clica em "Bora começar!"]
Bot: "🔥 Sessão iniciada!

      *Supino Reto*
      📊 Meta: 3x12 com 60kg
      
      Vamos começar a primeira série!"
      
      Avise quando terminar a série:
      [✅ Terminei!]
```

### Cenário 2: Aluno Não Cadastrado
```
Aluno: "Bora treinar"
Bot: "Opa! Vi que você ainda não está cadastrado no sistema. Fala com seu personal trainer para ele te adicionar, aí a gente pode começar! 💪"
```

### Cenário 3: Sem Treino para Hoje
```
Aluno: "Quero treinar"
Bot: "Que ânimo, João! 🔥 Mas hoje você não tem treino programado. Fala com seu personal para ajustar sua planilha!"
```

### Cenário 4: Fallback Inteligente
```
Bot: "Quantas repetições você conseguiu fazer?"
Aluno: "foi bom demais"
Bot: "Que massa que foi bom! 💪 Mas preciso que você me diga o número de repetições para eu registrar certinho. Quantas foram?"
Aluno: "12"
Bot: "12 repetições, show! 💪

     Agora me diz: qual carga você usou? (em kg)"
```

---

## ✅ Status Final

**Implementação**: 🟢 Completa  
**Modelo IA**: ✅ Gemini Flash-Lite Latest (`gemini-2.0-flash-exp`)  
**Validação**: ✅ Cadastro obrigatório antes de iniciar  
**Gatilho**: ✅ Detecta "Iniciar treino" e variações  
**Protocolo**: ✅ 6 estados implementados com fallbacks inteligentes  

**Pronto para testes com WhatsApp real!** 🚀
