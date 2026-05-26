# 🔐 Credenciais de Acesso - Repz.fit

**Última atualização**: 26/05/2026

---

## 🌐 URL da Aplicação

**Produção**: https://project-pxgam.vercel.app/

---

## 👤 Credenciais de Login

### Personal Trainer (Teste)

**Email**: `personal.teste@repzfit.com`  
**Senha**: `123456`

---

## ✅ Melhorias Implementadas no Login

### Problema Resolvido

❌ **Antes**: Clicar em "Entrar" não mostrava nenhum feedback  
✅ **Agora**: Login funcional com feedback completo

### Funcionalidades Adicionadas

1. **Feedback Visual**
   - Botão muda para "Entrando..." durante processamento
   - Botão fica desabilitado para evitar cliques múltiplos
   - Volta ao estado normal após resposta

2. **Validação de Campos**
   - Verifica se email e senha foram preenchidos
   - Mostra mensagem de erro clara se campos vazios

3. **Tratamento de Erros**
   - Exibe mensagens de erro amigáveis
   - Console.log para debug (visível no F12)
   - Captura erros de conexão e autenticação

4. **Suporte a Teclado**
   - Enter no campo de email → foca na senha
   - Enter no campo de senha → executa login

5. **Mensagens de Erro Detalhadas**
   - "Por favor, preencha email e senha" (campos vazios)
   - "Email ou senha incorretos" (credenciais inválidas)
   - "Erro ao conectar com o servidor" (problemas de rede)

---

## 🧪 Como Testar

### 1. Acessar a Aplicação

```
https://project-pxgam.vercel.app/
```

### 2. Fazer Login

- Email: `personal.teste@repzfit.com`
- Senha: `123456`
- Clicar em "Entrar" ou pressionar Enter

### 3. Verificar Funcionalidades

Após login bem-sucedido, você terá acesso a:

- ✅ **Alunos**: Cadastro e gestão de alunos
- ✅ **Exercícios**: 1.544 exercícios com busca e paginação
- ✅ **Treinos**: Criar treinos com múltiplos exercícios
- ✅ **WhatsApp**: Conectar instância Evolution API

---

## 🔧 Debug (Para Desenvolvedores)

### Console do Navegador (F12)

Ao fazer login, você verá logs como:

```javascript
Iniciando login...
Response status: 200
Response data: { access_token: "...", ... }
Login bem-sucedido!
```

Se houver erro:

```javascript
Erro no login: TypeError: Failed to fetch
```

---

## 🛠️ Script de Reset de Senha

Para resetar a senha de qualquer usuário:

```bash
npx tsx scripts/reset-password.ts
```

Este script:

- Lista usuários do Supabase Auth
- Reseta senha do usuário `personal.teste@repzfit.com` para `123456`
- Exibe credenciais de acesso

---

## 📊 Status do Deploy

**Commit**: `c168dc7 - fix: melhorar funcao de login com feedback visual e tratamento de erros`  
**Deploy**: ✅ Concluído  
**URL**: https://project-pxgam.vercel.app/  
**Status**: 🟢 ONLINE

---

## 🆘 Solução de Problemas

### Login não funciona

1. Abra o console do navegador (F12)
2. Tente fazer login
3. Verifique os logs no console
4. Se ver erro de CORS, verifique a configuração do backend
5. Se ver erro 400/401, verifique as credenciais

### "Erro ao conectar com o servidor"

- Verifique sua conexão com a internet
- Confirme se o Supabase está acessível: https://ofergzualxqqovktyxwu.supabase.co

### "Email ou senha incorretos"

- Verifique se está usando as credenciais corretas
- Execute o script de reset de senha se necessário
- Certifique-se de que o usuário existe no Supabase Auth

---

## 📞 Endpoints Relacionados

### Autenticação

```
POST https://ofergzualxqqovktyxwu.supabase.co/auth/v1/token?grant_type=password
Headers:
  - Content-Type: application/json
  - apikey: eyJhbGc...
Body:
  {
    "email": "personal.teste@repzfit.com",
    "password": "123456"
  }
```

### Dados do Personal

```
GET https://ofergzualxqqovktyxwu.supabase.co/rest/v1/personals?select=*
Headers:
  - apikey: eyJhbGc...
  - Authorization: Bearer {access_token}
```

---

**✅ APLICAÇÃO PRONTA PARA USO!**
