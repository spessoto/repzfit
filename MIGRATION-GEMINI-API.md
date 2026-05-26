# ⚠️ IMPORTANTE: Executar Migration no Supabase

Para habilitar o campo de configuração da chave API do Gemini, você precisa executar a seguinte migration no **Supabase SQL Editor**.

## Passos:

1. Acesse: https://supabase.com/dashboard/project/ofergzualxqqovktyxwu/sql/new

2. Cole o seguinte SQL no editor:

```sql
-- Adicionar campo para armazenar a chave API do Gemini de forma segura
ALTER TABLE public.personals ADD COLUMN IF NOT EXISTS gemini_api_key text;

-- Criar comentário explicativo
COMMENT ON COLUMN public.personals.gemini_api_key IS 'Chave API do Google Gemini para integração de IA';
```

3. Clique em **Run** para executar

4. Aguarde a confirmação de sucesso

## Verificação:

Para verificar se o campo foi criado corretamente, execute:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'personals'
AND column_name = 'gemini_api_key';
```

Você deve ver uma linha retornada com:

- column_name: gemini_api_key
- data_type: text

---

**Arquivo de migration**: `supabase/migrations/202605260004_add_gemini_api_key.sql`
