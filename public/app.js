      let authToken = localStorage.getItem("repz_token");
      let adminToken = localStorage.getItem("repz_admin_token");
      let isAdminSession = false;
      let personalData = null;
      let currentEditingStudentId = null;
      let currentStudentAssignedWorkoutIds = [];
      let currentStudentAvailableWorkouts = [];
      let selectedWorkoutForStudent = null;
      let workoutSearchTimeout = null;
      let studentSessionsAll = [];
      // Paginação da listagem de alunos
      let alunosPage = 1;
      const ALUNOS_PAGE_SIZE = 50;
      // Filtro e busca local na lista de alunos
      let alunosFilterAtivo = "todos";
      let alunosTodosCache = []; // cache da última página carregada
      // Paginação do histórico de sessões do aluno
      let studentSessionsPage = 1;
      const STUDENT_SESSIONS_API_PAGE_SIZE = 20;
      let studentSessionsCurrentPage = 1;
      const STUDENT_SESSIONS_PAGE_SIZE = 5;
      let studentInsightsActiveTab = "history";
      let studentReportData = null;
      let studentReportCalendarYear = new Date().getFullYear();
      let studentReportCalendarMonth = new Date().getMonth();
      let loginPasswordVisible = false;
      let exerciciosBuscaAtual = "";
      let exerciciosFiltroTimeout = null;
      let exerciciosSimilaresCache = [];
      let adminLogsCurrentPage = 1;
      let adminLogsTotalPages  = 1;
      let sysLogsCurrentPage   = 1;
      let sysLogsTotalPages    = 1;

      // --- Cache de aba: controla quais abas já foram carregadas nesta sessão ---
      // Ao trocar de aba, não recarrega se os dados já foram buscados.
      // Invalidado quando operações de escrita (salvar, excluir) ocorrem.
      const _tabLoaded = {};
      function markTabLoaded(tab) { _tabLoaded[tab] = true; }
      function isTabLoaded(tab) { return !!_tabLoaded[tab]; }
      function invalidateTab(tab) { delete _tabLoaded[tab]; }
      function invalidateTabs(...tabs) { tabs.forEach(invalidateTab); }

      function normalizeComparableText(text) {
        return String(text || "")
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
      }

      function tokenizeComparableText(text) {
        return normalizeComparableText(text)
          .replace(/[,%()'"\\]/g, " ")
          .replace(/\s+/g, " ")
          .split(" ")
          .map((term) => term.trim())
          .filter(Boolean);
      }

      function resolveExerciseTagsLocal(tags) {
        if (Array.isArray(tags)) {
          return tags
            .map((tag) => String(tag || "").trim())
            .filter((tag) => tag.length > 0);
        }

        if (typeof tags === "string") {
          return tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }

        return [];
      }

      function scoreExerciseSuggestion(exercise, normalizedQuery, tokens) {
        const name = normalizeComparableText(exercise?.name);
        const description = normalizeComparableText(exercise?.description);
        const muscleGroup = normalizeComparableText(exercise?.muscle_group);
        const equipment = normalizeComparableText(exercise?.equipment);
        const tags = resolveExerciseTagsLocal(exercise?.tags)
          .map((tag) => normalizeComparableText(tag))
          .join(" ");

        const combined = [name, description, muscleGroup, equipment, tags]
          .filter(Boolean)
          .join(" ");

        let score = 0;

        if (normalizedQuery) {
          if (name === normalizedQuery) score += 1000;
          else if (name.startsWith(normalizedQuery)) score += 700;
          else if (name.includes(normalizedQuery)) score += 500;

          if (muscleGroup.includes(normalizedQuery)) score += 220;
          if (equipment.includes(normalizedQuery)) score += 180;
          if (tags.includes(normalizedQuery)) score += 160;
          if (description.includes(normalizedQuery)) score += 80;

          if (combined.includes(normalizedQuery)) score += 120;
        }

        for (const token of tokens) {
          if (!token) continue;
          if (name.includes(token)) score += 120;
          if (muscleGroup.includes(token)) score += 95;
          if (equipment.includes(token)) score += 80;
          if (tags.includes(token)) score += 70;
          if (description.includes(token)) score += 35;
        }

        return score;
      }
      let adminPersonalsCache = [];
      let adminPersonalEditAtualId = null;

      // Função de escape HTML para prevenir XSS
      function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }

      // Paginação de exercícios
      let exerciciosPaginaAtual = 1;
      let exerciciosTotalPaginas = 1;
      const PERSONAL_PAGES = [
        "alunos",
        "financeiro",
        "exercicios",
        "treinos",
        "configuracoes",
      ];

      function getApiBaseUrl() {
        return window.location.hostname === "localhost"
          ? "http://localhost:3333"
          : window.location.origin;
      }

      function setAdminModeUI(enabled) {
        const personalTabs = [
          "alunosTabButton",
          "financeiroTabButton",
          "exerciciosTabButton",
          "treinosTabButton",
          "configuracoesTabButton",
        ];
        const personalPanels = [
          "alunosTab",
          "financeiroTab",
          "exerciciosTab",
          "treinosTab",
          "configuracoesTab",
        ];

        personalTabs.forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = enabled ? "none" : "inline-flex";
        });

        personalPanels.forEach((id) => {
          const el = document.getElementById(id);
          if (el && enabled) el.classList.remove("active");
        });

        const adminButton = document.getElementById("adminTabButton");
        if (adminButton) {
          adminButton.classList.toggle("hidden", !enabled);
          adminButton.style.display = enabled ? "inline-flex" : "none";
        }

        const adminSettingsButton = document.getElementById(
          "adminSettingsTabButton",
        );
        if (adminSettingsButton) {
          adminSettingsButton.classList.toggle("hidden", !enabled);
          adminSettingsButton.style.display = enabled ? "inline-flex" : "none";
        }

        const adminLogsButton = document.getElementById("adminLogsTabButton");
        if (adminLogsButton) {
          adminLogsButton.classList.toggle("hidden", !enabled);
          adminLogsButton.style.display = enabled ? "inline-flex" : "none";
        }

        const whatsappStatus = document.getElementById("headerWhatsAppStatus");
        if (whatsappStatus) {
          whatsappStatus.style.display = enabled ? "none" : "flex";
        }

        const editPersonalBtn = document.getElementById("editPersonalBtn");
        if (editPersonalBtn) {
          editPersonalBtn.style.display = enabled ? "none" : "inline-flex";
        }
      }

      // Initialize
      if (adminToken) {
        loadAdminApp();
      } else if (authToken) {
        loadApp();
      } else {
        document.getElementById("loginScreen").classList.remove("hidden");
        // Pré-preenche e-mail se vier de cadastro no formulario embed
        const _initParams = new URLSearchParams(window.location.search);
        const _preEmail = _initParams.get("email");
        if (_preEmail) {
          const _emailInput = document.getElementById("loginEmail");
          _emailInput.value = _preEmail;
          document.getElementById("loginPassword").focus();
          // Limpa o param da URL sem recarregar
          history.replaceState(null, "", window.location.pathname);
        }
      }

      // Função login precisa estar no escopo global para ser chamada pelo onclick
      async function login() {
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;
        const loginBtn = document.querySelector(
          '.btn-primary[onclick="login()"]',
        );
        const errorDiv = document.getElementById("loginError");

        // Validar campos
        if (!email || !password) {
          showError("loginError", "Por favor, preencha email e senha");
          return;
        }

        // Feedback visual
        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = "Entrando...";
        }
        errorDiv.classList.add("hidden");

        try {
          console.log("Iniciando login...");

          if (email.toLowerCase() === "agencia@stagesix.com.br") {
            const adminResp = await fetch(
              `${getApiBaseUrl()}/api/admin/login`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ email, password }),
              },
            );

            const adminData = await adminResp.json();

            if (!adminResp.ok) {
              throw new Error(
                adminData.message || "Credenciais de admin inválidas",
              );
            }

            adminToken = adminData.token;
            isAdminSession = true;
            authToken = null;
            localStorage.removeItem("repz_token");
            localStorage.setItem("repz_admin_token", adminToken);
            loadAdminApp();
            return;
          }

          const response = await fetch(
            "https://ofergzualxqqovktyxwu.supabase.co/auth/v1/token?grant_type=password",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey:
                  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZXJnenVhbHhxcW92a3R5eHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODg1OTksImV4cCI6MjA5NTM2NDU5OX0.6MSmrE1CgGSM0c07vZ7UA3zYwYy9EzlSpPTovaIuy4o",
              },
              body: JSON.stringify({ email, password }),
            },
          );

          console.log("Response status:", response.status);
          const data = await response.json();
          console.log("Response data:", data);

          if (data.access_token) {
            authToken = data.access_token;
            adminToken = null;
            isAdminSession = false;
            localStorage.removeItem("repz_admin_token");
            localStorage.setItem("repz_token", authToken);
            console.log("Login bem-sucedido!");
            window.location.href = "https://app.ezpersonal.com.br/personal/alunos/";
          } else {
            if (loginBtn) {
              loginBtn.disabled = false;
              loginBtn.textContent = "Entrar";
            }
            showError(
              "loginError",
              data.error_description || data.msg || "Email ou senha incorretos",
            );
          }
        } catch (error) {
          console.error("Erro no login:", error);
          if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = "Entrar";
          }
          showError(
            "loginError",
            "Erro ao conectar com o servidor. Tente novamente.",
          );
        }
      }

      function toggleLoginPasswordVisibility() {
        const input = document.getElementById("loginPassword");
        const btn = document.getElementById("toggleLoginPasswordBtn");
        if (!input || !btn) return;

        loginPasswordVisible = !loginPasswordVisible;
        input.type = loginPasswordVisible ? "text" : "password";
        btn.textContent = loginPasswordVisible ? "Ocultar" : "Ver";
      }

      function togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input || !btn) return;
        const isVisible = input.type === "text";
        input.type = isVisible ? "password" : "text";
        btn.textContent = isVisible ? "Ver" : "Ocultar";
      }

      // ── Recuperação de senha ─────────────────────────────────────────────────

      function showLogin() {
        document.getElementById("loginPanel")?.classList.remove("hidden");
        document.getElementById("forgotPasswordPanel")?.classList.add("hidden");
        document.getElementById("resetPasswordPanel")?.classList.add("hidden");
      }

      function showForgotPassword() {
        document.getElementById("loginPanel")?.classList.add("hidden");
        document.getElementById("forgotPasswordPanel")?.classList.remove("hidden");
        document.getElementById("resetPasswordPanel")?.classList.add("hidden");
        // Pré-preenche email se já estava digitado no login
        const loginEmail = document.getElementById("loginEmail")?.value;
        if (loginEmail) {
          const recEl = document.getElementById("recoveryEmail");
          if (recEl) recEl.value = loginEmail;
        }
      }

      async function requestPasswordRecovery() {
        const email = document.getElementById("recoveryEmail")?.value?.trim();
        const msgDiv = document.getElementById("recoveryMessage");

        if (!email) {
          if (msgDiv) {
            msgDiv.className = "alert alert-error";
            msgDiv.textContent = "Por favor, informe o seu e-mail.";
          }
          return;
        }

        const btn = document.querySelector('#forgotPasswordPanel .btn-primary');
        if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
        if (msgDiv) msgDiv.className = "hidden";

        try {
          const res = await fetch(`${getApiBaseUrl()}/api/public/personals/password-recovery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              redirect_to: window.location.origin + window.location.pathname,
            }),
          });

          const data = await res.json().catch(() => ({}));

          if (msgDiv) {
            // Sempre exibe mensagem genérica (não revela se o email existe)
            msgDiv.className = "alert alert-success";
            msgDiv.textContent = data.message || "Se o e-mail existir, você receberá um link para redefinir a senha. Verifique sua caixa de entrada.";
          }
        } catch (e) {
          if (msgDiv) {
            msgDiv.className = "alert alert-error";
            msgDiv.textContent = "Erro ao enviar. Tente novamente mais tarde.";
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Enviar link de recuperação"; }
        }
      }

      async function submitNewPassword() {
        const newPassword = document.getElementById("newPassword")?.value;
        const confirmPassword = document.getElementById("confirmNewPassword")?.value;
        const msgDiv = document.getElementById("resetPasswordMessage");

        if (!newPassword || newPassword.length < 8) {
          if (msgDiv) { msgDiv.className = "alert alert-error"; msgDiv.textContent = "A senha deve ter no mínimo 8 caracteres."; }
          return;
        }
        if (newPassword !== confirmPassword) {
          if (msgDiv) { msgDiv.className = "alert alert-error"; msgDiv.textContent = "As senhas não coincidem."; }
          return;
        }

        const btn = document.querySelector('#resetPasswordPanel .btn-primary');
        if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
        if (msgDiv) msgDiv.className = "hidden";

        try {
          // Usa o access_token temporário do Supabase (tipo "recovery") para atualizar a senha
          const recoveryToken = window._recoveryAccessToken;
          if (!recoveryToken) throw new Error("Token de recuperação não encontrado. Solicite um novo link.");

          const SUPABASE_URL = "https://ofergzualxqqovktyxwu.supabase.co";
          const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZXJnenVhbHhxcW92a3R5eHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODg1OTksImV4cCI6MjA5NTM2NDU5OX0.6MSmrE1CgGSM0c07vZ7UA3zYwYy9EzlSpPTovaIuy4o";

          const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "apikey": SUPABASE_ANON_KEY || "",
              "Authorization": `Bearer ${recoveryToken}`,
            },
            body: JSON.stringify({ password: newPassword }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error_description || err.message || `Erro ${res.status}`);
          }

          if (msgDiv) {
            msgDiv.className = "alert alert-success";
            msgDiv.textContent = "Senha alterada com sucesso! Redirecionando para o login...";
          }

          // Limpa o token e redireciona para login após 2s
          window._recoveryAccessToken = null;
          history.replaceState(null, "", window.location.pathname);
          setTimeout(() => showLogin(), 2000);
        } catch (e) {
          if (msgDiv) {
            msgDiv.className = "alert alert-error";
            msgDiv.textContent = e.message || "Erro ao salvar nova senha. Tente novamente.";
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Salvar nova senha"; }
        }
      }

      // Detecta retorno do link de recuperação do Supabase (hash #access_token=...&type=recovery)
      (function detectPasswordRecovery() {
        const hash = window.location.hash;
        if (!hash) return;
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const type = params.get("type");
        const accessToken = params.get("access_token");
        if (type === "recovery" && accessToken) {
          window._recoveryAccessToken = accessToken;
          // Esconde a tela de login e exibe a tela de redefinição de senha
          document.getElementById("loginScreen")?.classList.remove("hidden");
          document.getElementById("loginPanel")?.classList.add("hidden");
          document.getElementById("forgotPasswordPanel")?.classList.add("hidden");
          document.getElementById("resetPasswordPanel")?.classList.remove("hidden");
          // Remove o hash da URL para não expor o token
          history.replaceState(null, "", window.location.pathname);
        }
      })();

      // Event listeners para login com Enter
      document.addEventListener("DOMContentLoaded", function () {
        const emailInput = document.getElementById("loginEmail");
        const passwordInput = document.getElementById("loginPassword");

        if (emailInput && passwordInput) {
          emailInput.addEventListener("keypress", function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              passwordInput.focus();
            }
          });

          passwordInput.addEventListener("keypress", function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              login();
            }
          });
        }
      });

      function logout() {
        stopStatusMonitoring();
        localStorage.removeItem("repz_token");
        localStorage.removeItem("repz_admin_token");
        authToken = null;
        adminToken = null;
        isAdminSession = false;
        location.reload();
      }

      function handleUnauthorized() {
        console.warn("Token expirado ou inválido, fazendo logout...");
        showToast("Sua sessão expirou. Faça login novamente.", "warn", 5000);
        setTimeout(logout, 1500);
      }

      async function loadApp() {
        isAdminSession = false;
        setAdminModeUI(false);
        document.getElementById("loginScreen").classList.add("hidden");
        document.getElementById("appScreen").classList.remove("hidden");

        await carregarPerfilPersonal();
        startStatusMonitoring();

        const page = getPersonalPageFromUrl();
        await openPersonalPage(page, { shouldLoadData: true });
      }

      async function carregarPerfilPersonal() {
        const apiUrl = getApiBaseUrl();

        const response = await fetch(`${apiUrl}/api/personal/profile`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          const fallback = await fetch(
            "https://ofergzualxqqovktyxwu.supabase.co/rest/v1/personals?select=*",
            {
              headers: {
                apikey:
                  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZXJnenVhbHhxcW92a3R5eHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODg1OTksImV4cCI6MjA5NTM2NDU5OX0.6MSmrE1CgGSM0c07vZ7UA3zYwYy9EzlSpPTovaIuy4o",
                Authorization: `Bearer ${authToken}`,
              },
            },
          );
          const fallbackPersonals = await fallback.json();
          personalData = fallbackPersonals?.[0] ?? null;
        } else {
          personalData = await response.json();
        }

        const name = personalData?.name || "Personal";
        document.getElementById("userName").textContent = name;
        // Preencher avatar com iniciais
        _setProfileAvatar(name);
      }

      function openPersonalProfileModal() {
        if (!personalData) return;

        document.getElementById("perfilNome").value = personalData.name || "";
        document.getElementById("perfilEmail").value = personalData.email || "";
        document.getElementById("perfilTelefone").value =
          personalData.phone || "";
        document.getElementById("perfilCrf").value =
          personalData.crf_registration || "";
        document.getElementById("personalProfileAlert").innerHTML = "";
        document.getElementById("personalProfileModal").classList.add("open");
      }

      function closePersonalProfileModal(event) {
        if (event && event.target?.id !== "personalProfileModal") return;
        document
          .getElementById("personalProfileModal")
          .classList.remove("open");
      }

      // ── Dropdown de perfil ──────────────────────────────────────────────────

      function _setProfileAvatar(name) {
        const el = document.getElementById("topnavAvatar");
        if (!el || !name) return;
        const parts = name.trim().split(/\s+/);
        const initials = parts.length === 1
          ? parts[0].substring(0, 2).toUpperCase()
          : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        el.textContent = initials;
      }

      function toggleProfileDropdown() {
        const btn      = document.getElementById("editPersonalBtn");
        const dropdown = document.getElementById("topnavProfileDropdown");
        if (!btn || !dropdown) return;
        const isOpen = dropdown.classList.contains("open");
        if (isOpen) {
          closeProfileDropdown();
        } else {
          dropdown.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
          // Fechar ao clicar fora
          setTimeout(() => {
            document.addEventListener("click", _closeDropdownOnOutsideClick, { once: true });
          }, 0);
        }
      }

      function closeProfileDropdown() {
        const btn      = document.getElementById("editPersonalBtn");
        const dropdown = document.getElementById("topnavProfileDropdown");
        if (dropdown) dropdown.classList.remove("open");
        if (btn) btn.setAttribute("aria-expanded", "false");
      }

      function _closeDropdownOnOutsideClick(e) {
        const wrap = document.getElementById("topnavProfileWrap");
        if (wrap && !wrap.contains(e.target)) {
          closeProfileDropdown();
        }
      }

      // Fechar dropdown com Escape
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
          closeProfileDropdown();
        }
      });

      async function salvarPerfilPersonal() {
        const payload = {
          name: document.getElementById("perfilNome").value.trim(),
          email: document.getElementById("perfilEmail").value.trim() || null,
          phone: document.getElementById("perfilTelefone").value.trim() || null,
          crf_registration:
            document.getElementById("perfilCrf").value.trim() || null,
        };

        if (!payload.name) {
          showAlert(
            "personalProfileAlert",
            "Informe o nome do personal.",
            "error",
          );
          return;
        }

        const apiUrl = getApiBaseUrl();
        const response = await fetch(`${apiUrl}/api/personal/profile`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }

        const responseData = await response.json().catch(() => ({}));
        if (!response.ok) {
          showAlert(
            "personalProfileAlert",
            responseData.message || "Erro ao salvar perfil.",
            "error",
          );
          return;
        }

        personalData = responseData;
        const updatedName = personalData.name || "Personal";
        document.getElementById("userName").textContent = updatedName;
        _setProfileAvatar(updatedName);
        showAlert(
          "personalProfileAlert",
          "Perfil atualizado com sucesso!",
          "success",
        );
      }

      async function loadAdminApp() {
        isAdminSession = true;
        stopStatusMonitoring();
        setAdminModeUI(true);
        document.getElementById("loginScreen").classList.add("hidden");
        document.getElementById("appScreen").classList.remove("hidden");
        document.getElementById("userName").textContent = "Admin Stagesix";
        _setProfileAvatar("Admin Stagesix");
        generateAdminEmbedCode();
        switchTab("admin");
        await carregarAdminPersonals();
      }

      function getPersonalPageFromUrl() {
        const normalizedPath = window.location.pathname
          .replace(/^\/+|\/+$/g, "")
          .toLowerCase();
        const parts = normalizedPath ? normalizedPath.split("/") : [];

        if (
          parts[0] === "personal" &&
          parts[1] &&
          PERSONAL_PAGES.includes(parts[1])
        ) {
          return parts[1];
        }

        // Compatibilidade com links antigos no formato ?page=
        const params = new URLSearchParams(window.location.search);
        const queryPage = (params.get("page") || "").toLowerCase();
        if (PERSONAL_PAGES.includes(queryPage)) {
          return queryPage;
        }

        return "alunos";
      }

      function getAlunoEditorIdFromUrl() {
        const normalizedPath = window.location.pathname
          .replace(/^\/+|\/+$/g, "")
          .toLowerCase();
        const parts = normalizedPath ? normalizedPath.split("/") : [];

        if (parts[0] === "personal" && parts[1] === "alunos" && parts[2]) {
          return decodeURIComponent(parts[2]);
        }

        return null;
      }

      function buildPersonalPageUrl(page) {
        const safePage = PERSONAL_PAGES.includes(page) ? page : "alunos";
        const params = new URLSearchParams(window.location.search);
        params.delete("page");
        const query = params.toString();
        return `/personal/${safePage}${query ? `?${query}` : ""}`;
      }

      function buildAlunoEditorUrl(studentId, view) {
        const params = new URLSearchParams(window.location.search);
        params.delete("page");
        if (view) {
          params.set("view", view);
        } else {
          params.delete("view");
        }
        const query = params.toString();
        return `/personal/alunos/${encodeURIComponent(studentId)}${query ? `?${query}` : ""}`;
      }

      /** Lê o parâmetro ?view= da URL (dados | treinos | progresso) */
      function getAlunoEditorViewFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const v = params.get("view");
        return (v === "treinos" || v === "progresso" || v === "avaliacoes") ? v : "dados";
      }

      function navigatePersonalPage(page) {
        if (isAdminSession) return;
        window.location.href = buildPersonalPageUrl(page);
      }

      async function openPersonalPage(page, options = {}) {
        const { shouldLoadData = false } = options;
        const safePage = PERSONAL_PAGES.includes(page) ? page : "alunos";
        const alunoEditorId = safePage === "alunos" ? getAlunoEditorIdFromUrl() : null;
        const panelId = alunoEditorId ? "alunoEditorTab" : `${safePage}Tab`;

        document
          .querySelectorAll(".topnav-tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".tab-content")
          .forEach((t) => t.classList.remove("active"));

        const button = document.getElementById(`${safePage}TabButton`);
        const panel = document.getElementById(panelId);
        if (button) button.classList.add("active");
        if (panel) panel.classList.add("active");

        if (!shouldLoadData) return;

        if (safePage === "alunos") {
          if (alunoEditorId) {
            currentEditingStudentId = alunoEditorId;
            document.getElementById("studentEditorAlert").innerHTML = "";
            // Ativa a view correta antes de carregar dados
            const view = getAlunoEditorViewFromUrl();
            _ativarViewEditor(view);
            await carregarDetalhesAlunoEditor(alunoEditorId);
          } else {
            currentEditingStudentId = null;
            await carregarAlunos();
          }
          return;
        }

        if (safePage === "financeiro") {
          await carregarFinanceiroDashboard();
          return;
        }

        if (safePage === "exercicios") {
          await carregarExercicios();
          return;
        }

        if (safePage === "treinos") {
          await carregarAlunosSelect();
          await carregarTreinosAluno();
          return;
        }

        if (safePage === "configuracoes") {
          await carregarConfiguracoes();
        }
      }

      /**
       * Ativa uma view do editor de aluno (dados | treinos | progresso).
       * Atualiza os botões de nav e mostra/oculta as seções.
       */
      function _ativarViewEditor(view) {
        const views = ["dados", "treinos", "progresso", "avaliacoes"];
        const safeView = views.includes(view) ? view : "dados";

        const labels = {
          dados:      "Dados do Aluno",
          treinos:    "Treinos",
          progresso:  "Progresso",
          avaliacoes: "Avaliações Físicas",
        };
        const subtitleEl = document.getElementById("studentEditorViewLabel");
        if (subtitleEl) subtitleEl.textContent = labels[safeView] || "";

        // Mostrar/ocultar sections
        views.forEach(v => {
          const el = document.getElementById(`studentView${v.charAt(0).toUpperCase() + v.slice(1)}`);
          if (el) el.classList.toggle("hidden", v !== safeView);
        });

        // Atualizar botões de nav
        document.querySelectorAll(".student-editor-nav-btn").forEach(btn => {
          btn.classList.toggle("active", btn.dataset.view === safeView);
        });

        // Carregar avaliações ao abrir a view
        if (safeView === "avaliacoes" && currentEditingStudentId) {
          carregarAvaliacoes(currentEditingStudentId);
        }
      }

      /**
       * Handler dos botões de nav do editor — muda a view SEM recarregar a página.
       */
      function openAlunoEditorView(view, btnEl) {
        _ativarViewEditor(view);
        // Atualiza URL com ?view= para preservar estado em reloads
        if (currentEditingStudentId) {
          const newUrl = buildAlunoEditorUrl(currentEditingStudentId, view);
          history.replaceState(null, "", newUrl);
        }
        // Se mudou para progresso e ainda não carregou sessões, carrega agora
        if (view === "progresso" && currentEditingStudentId && studentInsightsActiveTab === "history") {
          const sessionsEl = document.getElementById("studentEditorSessions");
          if (sessionsEl && !sessionsEl.hasChildNodes()) {
            carregarSessoesAluno(currentEditingStudentId, 1);
          }
        }
      }

      function switchTab(tab) {
        document
          .querySelectorAll(".topnav-tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".tab-content")
          .forEach((t) => t.classList.remove("active"));

        // Adiciona active na tab clicada
        const clickedTab = Array.from(document.querySelectorAll(".topnav-tab")).find(
          (t) =>
            t.textContent.toLowerCase().includes(tab.toLowerCase()) ||
            t.getAttribute("onclick")?.includes(tab),
        );
        if (clickedTab) clickedTab.classList.add("active");

        document.getElementById(tab + "Tab").classList.add("active");

        if (tab === "alunos") { if (!isTabLoaded("alunos")) { carregarAlunos(); markTabLoaded("alunos"); } }
        if (tab === "financeiro") { if (!isTabLoaded("financeiro")) { carregarFinanceiroDashboard(); markTabLoaded("financeiro"); } }
        if (tab === "exercicios") { if (!isTabLoaded("exercicios")) { carregarExercicios(); markTabLoaded("exercicios"); } }
        if (tab === "treinos") { if (!isTabLoaded("treinos")) { carregarTreinosAluno(); markTabLoaded("treinos"); } }
        if (tab === "admin") carregarAdminPersonals();
        if (tab === "adminSettings") {
          generateAdminEmbedCode();
          carregarRelatorioOrigensAdmin();
          verificarStatusWhatsAppAdmin();
        }
        if (tab === "adminLogs") {
          // Carrega a sub-aba padrão: erros de plataforma
          carregarSysLogs(1);
        }
      }

      function renderAdminLogSeverityBadge(severity) {
        const value = String(severity || "warn").toLowerCase();
        if (value === "error") {
          return '<span style="padding:4px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;">ERROR</span>';
        }
        if (value === "info") {
          return '<span style="padding:4px 8px;border-radius:999px;background:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;">INFO</span>';
        }
        return '<span style="padding:4px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;">WARN</span>';
      }

      function buildAdminLogsQueryParams(page) {
        const params = new URLSearchParams();
        params.set("page", String(page || 1));

        const limit = document.getElementById("adminLogsLimit")?.value || "50";
        params.set("limit", String(limit));

        const severity = document
          .getElementById("adminLogsSeverity")
          ?.value?.trim();
        const category = document
          .getElementById("adminLogsCategory")
          ?.value?.trim();
        const code = document.getElementById("adminLogsCode")?.value?.trim();
        const whatsapp = document
          .getElementById("adminLogsWhatsapp")
          ?.value?.trim();
        const onlyOpen = Boolean(
          document.getElementById("adminLogsOnlyOpen")?.checked,
        );

        if (severity) params.set("severity", severity);
        if (category) params.set("category", category);
        if (code) params.set("code", code);
        if (whatsapp) params.set("whatsapp_number", whatsapp);
        if (onlyOpen) params.set("unresolved_only", "1");

        return params;
      }

      async function carregarLogsSistemaAdmin(page = 1) {
        if (!isAdminSession || !adminToken) return;

        const tbody = document.getElementById("adminLogsBody");
        const totalEl = document.getElementById("adminLogsTotal");
        const pageInfo = document.getElementById("adminLogsPageInfo");
        const prevBtn = document.getElementById("adminLogsPrevBtn");
        const nextBtn = document.getElementById("adminLogsNextBtn");

        if (!tbody || !totalEl || !pageInfo || !prevBtn || !nextBtn) return;

        tbody.innerHTML =
          '<tr><td colspan="7" style="text-align:center">Carregando...</td></tr>';

        try {
          const params = buildAdminLogsQueryParams(page);

          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/bot/anomaly-logs?${params.toString()}`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao carregar logs");
          }

          const logs = Array.isArray(payload.data) ? payload.data : [];
          const pagination = payload.pagination || {};

          adminLogsCurrentPage = Number(pagination.page || page || 1);
          adminLogsTotalPages = Number(pagination.totalPages || 1);
          const total = Number(pagination.total || logs.length || 0);

          totalEl.textContent = String(total);
          pageInfo.textContent = `Página ${adminLogsCurrentPage} de ${adminLogsTotalPages}`;
          prevBtn.disabled = adminLogsCurrentPage <= 1;
          nextBtn.disabled = adminLogsCurrentPage >= adminLogsTotalPages;

          if (!logs.length) {
            tbody.innerHTML =
              '<tr><td colspan="7" style="text-align:center;color:#6b7280;">Nenhum log encontrado para os filtros aplicados.</td></tr>';
            return;
          }

          tbody.innerHTML = logs
            .map((row) => {
              const createdAt = row.created_at
                ? new Date(row.created_at).toLocaleString("pt-BR")
                : "-";
              const message = escapeHtml(row.message || "-");
              const code = escapeHtml(row.code || "-");
              const category = escapeHtml(row.category || "-");
              const state = escapeHtml(row.current_state || "-");
              const whatsapp = escapeHtml(row.whatsapp_number || "-");

              return `
                <tr>
                  <td>${escapeHtml(createdAt)}</td>
                  <td>${renderAdminLogSeverityBadge(row.severity)}</td>
                  <td>${category}</td>
                  <td><code style="font-size:12px">${code}</code></td>
                  <td style="max-width: 340px; white-space: normal;">${message}</td>
                  <td>${state}</td>
                  <td>${whatsapp}</td>
                </tr>
              `;
            })
            .join("");
        } catch (error) {
          totalEl.textContent = "-";
          pageInfo.textContent = "Página -";
          prevBtn.disabled = true;
          nextBtn.disabled = true;
          tbody.innerHTML =
            '<tr><td colspan="7" style="text-align:center;color:#ef4444;">Erro ao carregar logs</td></tr>';
          showAlert(
            "adminLogsAlert",
            error.message || "Erro ao carregar logs do sistema",
            "error",
          );
        }
      }

      function adminLogsPrevPage() {
        if (adminLogsCurrentPage <= 1) return;
        carregarLogsSistemaAdmin(adminLogsCurrentPage - 1);
      }

      function adminLogsNextPage() {
        if (adminLogsCurrentPage >= adminLogsTotalPages) return;
        carregarLogsSistemaAdmin(adminLogsCurrentPage + 1);
      }

      function limparFiltrosLogsSistemaAdmin() {
        const severity = document.getElementById("adminLogsSeverity");
        const category = document.getElementById("adminLogsCategory");
        const code = document.getElementById("adminLogsCode");
        const whatsapp = document.getElementById("adminLogsWhatsapp");
        const onlyOpen = document.getElementById("adminLogsOnlyOpen");
        const limit = document.getElementById("adminLogsLimit");

        if (severity) severity.value = "";
        if (category) category.value = "";
        if (code) code.value = "";
        if (whatsapp) whatsapp.value = "";
        if (onlyOpen) onlyOpen.checked = false;
        if (limit) limit.value = "50";

        carregarLogsSistemaAdmin(1);
      }

      // ── Sub-aba: Erros de Plataforma (system_action_logs) ────────────────────

      function openAdminLogsSubTab(tab) {
        document.querySelectorAll("#adminLogsTab .student-insights-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll("#adminLogsTab .student-insights-panel").forEach(p => p.classList.remove("active"));
        const btn   = document.getElementById(`sysLogs${tab.charAt(0).toUpperCase() + tab.slice(1)}TabBtn`);
        const panel = document.getElementById(`sysLogs${tab.charAt(0).toUpperCase() + tab.slice(1)}Panel`);
        if (btn)   btn.classList.add("active");
        if (panel) panel.classList.add("active");

        // Carrega dados da sub-aba selecionada
        if (tab === "action") carregarSysLogs(1);
        if (tab === "bot")    carregarLogsSistemaAdmin(1);
      }

      async function carregarSysLogs(page = 1) {
        if (!isAdminSession || !adminToken) return;

        const tbody    = document.getElementById("sysLogsBody");
        const totalEl  = document.getElementById("sysLogsTotal");
        const pageInfo = document.getElementById("sysLogsPageInfo");
        const prevBtn  = document.getElementById("sysLogsPrevBtn");
        const nextBtn  = document.getElementById("sysLogsNextBtn");

        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Carregando...</td></tr>';

        try {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", document.getElementById("sysLogsLimit")?.value || "50");

          const severity = document.getElementById("sysLogsSeverity")?.value?.trim();
          const area     = document.getElementById("sysLogsArea")?.value?.trim();
          if (severity) params.set("severity", severity);
          if (area)     params.set("area", area);

          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/system-logs?${params.toString()}`,
            { headers: { Authorization: `Bearer ${adminToken}` } },
          );

          if (response.status === 401) { handleUnauthorized(); return; }

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message || "Erro ao carregar logs");

          const logs       = Array.isArray(payload.data) ? payload.data : [];
          const pagination = payload.pagination || {};

          sysLogsCurrentPage = Number(pagination.page || page || 1);
          sysLogsTotalPages  = Number(pagination.totalPages || 1);
          const total = Number(pagination.total || logs.length || 0);

          if (totalEl)  totalEl.textContent  = String(total);
          if (pageInfo) pageInfo.textContent = `Página ${sysLogsCurrentPage} de ${sysLogsTotalPages}`;
          if (prevBtn)  prevBtn.disabled = sysLogsCurrentPage <= 1;
          if (nextBtn)  nextBtn.disabled = sysLogsCurrentPage >= sysLogsTotalPages;

          if (!logs.length) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">Nenhum log encontrado.</td></tr>';
            return;
          }

          if (tbody) tbody.innerHTML = logs.map((row) => {
            const createdAt = row.created_at ? new Date(row.created_at).toLocaleString("pt-BR") : "-";
            const severityBadge = renderAdminLogSeverityBadge(row.severity);
            const resource = row.resource_id ? `${escapeHtml(row.resource_type || "")} ${escapeHtml(row.resource_id.slice(0, 8))}…` : "-";
            return `<tr>
              <td style="white-space:nowrap">${escapeHtml(createdAt)}</td>
              <td>${severityBadge}</td>
              <td>${escapeHtml(row.area || "-")}</td>
              <td><code style="font-size:12px">${escapeHtml(row.action || "-")}</code></td>
              <td style="max-width:320px;white-space:normal;">${escapeHtml(row.message || "-")}</td>
              <td style="font-size:12px;color:#6b7280;">${resource}</td>
              <td><code style="font-size:12px">${escapeHtml(row.error_code || "-")}</code></td>
            </tr>`;
          }).join("");

        } catch (error) {
          if (totalEl)  totalEl.textContent  = "-";
          if (pageInfo) pageInfo.textContent = "Página -";
          if (prevBtn)  prevBtn.disabled = true;
          if (nextBtn)  nextBtn.disabled = true;
          if (tbody)    tbody.innerHTML  = '<tr><td colspan="7" style="text-align:center;color:#ef4444;">Erro ao carregar logs</td></tr>';
          showAlert("adminSysLogsAlert", error.message || "Erro ao carregar logs de plataforma", "error");
        }
      }

      function sysLogsPrevPage() {
        if (sysLogsCurrentPage <= 1) return;
        carregarSysLogs(sysLogsCurrentPage - 1);
      }

      function sysLogsNextPage() {
        if (sysLogsCurrentPage >= sysLogsTotalPages) return;
        carregarSysLogs(sysLogsCurrentPage + 1);
      }

      function limparFiltrosSysLogs() {
        const severity = document.getElementById("sysLogsSeverity");
        const area     = document.getElementById("sysLogsArea");
        const limit    = document.getElementById("sysLogsLimit");
        if (severity) severity.value = "";
        if (area)     area.value     = "";
        if (limit)    limit.value    = "50";
        carregarSysLogs(1);
      }

      function normalizeQrImageData(value) {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("data:image/")) return trimmed;
        if (/^[A-Za-z0-9+/=\n\r]+$/.test(trimmed) && trimmed.length > 100) {
          return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
        }
        return null;
      }

      async function criarAluno() {
        const nome = document.getElementById("alunoNome").value;
        const whatsapp = document.getElementById("alunoWhatsapp").value;
        const vencimentoRaw = document.getElementById("alunoVencimento") ? document.getElementById("alunoVencimento").value : "";
        const paymentDay = vencimentoRaw ? parseInt(vencimentoRaw, 10) : null;

        const apiUrl =
          window.location.hostname === "localhost"
            ? "http://localhost:3333"
            : window.location.origin;

        const body = {
          name: nome,
          whatsapp_number: whatsapp,
          is_active: true,
        };
        if (paymentDay && paymentDay >= 1 && paymentDay <= 31) {
          body.payment_day = paymentDay;
        }

        const response = await fetch(`${apiUrl}/api/students`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          showAlert("alunosAlert", "Aluno criado com sucesso!", "success");
          document.getElementById("alunoNome").value = "";
          document.getElementById("alunoWhatsapp").value = "";
          if (document.getElementById("alunoVencimento")) document.getElementById("alunoVencimento").value = "";
          carregarAlunos();
          carregarAlunosSelect();
          return;
        }

        const errorData = await response.json().catch(() => ({}));
        if (response.status === 409) {
          showAlert(
            "alunosAlert",
            "Este WhatsApp já está vinculado a outro aluno. Confirme o número com o personal responsável.",
            "error",
          );
          return;
        }

        showAlert(
          "alunosAlert",
          errorData.message || "Erro ao criar aluno",
          "error",
        );
      }

      async function carregarAlunos(page) {
        markTabLoaded("alunos");
        alunosPage = page || 1;
        try {
          const apiUrl = getApiBaseUrl();
          const response = await fetch(
            `${apiUrl}/api/students/list?page=${alunosPage}&limit=${ALUNOS_PAGE_SIZE}`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const result = await response.json();
          const alunos = result.data ?? [];
          const pagination = result.pagination ?? {};

          // Cache para filtro/busca local
          alunosTodosCache = alunos;

          // Atualizar stats do cabeçalho
          _atualizarAlunosStats(alunos);

          // Renderizar tabela
          _renderizarTabelaAlunos(alunos, alunosFilterAtivo);

          // Renderizar controles de paginação
          const paginationEl = document.getElementById("alunosPagination");
          if (paginationEl) {
            const total = pagination.total ?? 0;
            const totalPages = pagination.total_pages ?? 1;
            if (totalPages <= 1) {
              paginationEl.innerHTML = "";
            } else {
              paginationEl.innerHTML = `
                <div style="display:flex;gap:8px;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;">
                  <button class="btn btn-secondary" onclick="carregarAlunos(${alunosPage - 1})" ${alunosPage <= 1 ? "disabled" : ""}>← Anterior</button>
                  <span style="color:#6b7280;font-size:13px;">Página ${alunosPage} de ${totalPages} (${total} alunos)</span>
                  <button class="btn btn-secondary" onclick="carregarAlunos(${alunosPage + 1})" ${alunosPage >= totalPages ? "disabled" : ""}>Próxima →</button>
                </div>`;
            }
          }
        } catch (error) {
          console.error("Erro ao carregar alunos:", error);
          const tbody = document.getElementById("alunosBody");
          if (tbody) tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:32px;">Erro ao carregar alunos</td></tr>';
        }
      }

      function _alunoGetInitials(name) {
        if (!name) return "?";
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }

      const AVATAR_COLORS = [
        "#024d3a","#0d6e55","#1a7a60","#0f4c31","#2d8c63",
        "#064e3b","#065f46","#047857","#166534","#14532d",
      ];

      function _alunoAvatarColor(name) {
        if (!name) return AVATAR_COLORS[0];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
      }

      function _alunoCheckinLabel(lastSessionDate, lastSessionCreatedAt) {
        if (!lastSessionDate) return null;
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        let timeLabel = "";
        if (lastSessionCreatedAt) {
          try {
            const d = new Date(lastSessionCreatedAt);
            const h = String(d.getHours()).padStart(2, "0");
            const m = String(d.getMinutes()).padStart(2, "0");
            timeLabel = ` · ${h}:${m}`;
          } catch (_) {}
        }

        if (lastSessionDate === todayStr) return { text: `Confirmou hoje${timeLabel}`, ghost: false };
        if (lastSessionDate === yesterdayStr) return { text: "Confirmou ontem", ghost: false };

        // Calcular dias atrás
        const sessionDate = new Date(lastSessionDate + "T12:00:00");
        const diffDays = Math.round((today - sessionDate) / (1000 * 60 * 60 * 24));
        if (diffDays > 4) return { text: `👻 sem confirmação há ${diffDays} dias`, ghost: true };
        return { text: `Confirmou há ${diffDays} dias`, ghost: false };
      }

      function _formatWhatsapp(number) {
        if (!number) return "—";
        // Formata 5511999999999 → (11) 99999-9999
        const digits = number.replace(/\D/g, "");
        if (digits.length === 13 && digits.startsWith("55")) {
          const ddd = digits.slice(2, 4);
          const num = digits.slice(4);
          if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
          if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
        }
        return number;
      }

      function _alunosMatchesFilter(aluno, filter) {
        if (filter === "todos") return true;
        if (filter === "ativos") return aluno.is_active !== false;
        if (filter === "pendentes") return aluno.payment_status === "pendente";
        if (filter === "atrasados") return aluno.payment_status === "atrasado";
        return true;
      }

      function _renderizarTabelaAlunos(alunos, filter) {
        const tbody = document.getElementById("alunosBody");
        if (!tbody) return;

        const searchInput = document.getElementById("alunosBusca");
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

        const filtered = alunos.filter(a => {
          if (searchTerm && !escapeHtml(a.name || "").toLowerCase().includes(searchTerm)) return false;
          return _alunosMatchesFilter(a, filter);
        });

        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:32px;">Nenhum aluno encontrado</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(a => {
          const initials = _alunoGetInitials(a.name);
          const avatarColor = _alunoAvatarColor(a.name);
          const checkin = _alunoCheckinLabel(a.last_session_date, a.last_session_created_at);
          const whatsappFormatted = _formatWhatsapp(a.whatsapp_number);
          const dueDay = a.payment_day ? `Dia ${a.payment_day}` : "—";
          const safeId = escapeHtml(a.id);
          const safeName = escapeHtml(a.name || "");
          const safePhone = escapeHtml(a.whatsapp_number || "");

          let statusBadge = "";
          if (a.payment_status === "pago") {
            statusBadge = `<span class="badge-pago">Pago</span>`;
          } else if (a.payment_status === "atrasado") {
            statusBadge = `<span class="badge-atrasado">Atrasado</span>`;
          } else {
            statusBadge = `<span class="badge-pendente">Pendente</span>`;
          }

          const checkinHtml = checkin
            ? `<span class="student-checkin-label">${checkin.text}</span>`
            : `<span class="student-checkin-label" style="color:#d1d5db;">Nunca treinou</span>`;

          return `
            <tr class="${checkin && checkin.ghost ? 'student-ghost' : ''}">
              <td>
                <div class="student-avatar-wrap">
                  <div class="student-avatar" style="background:${avatarColor};">${initials}</div>
                  <div class="student-name-wrap">
                    <span class="student-name">${safeName}</span>
                    ${checkinHtml}
                  </div>
                </div>
              </td>
              <td>
                <a href="https://wa.me/${safePhone}" target="_blank" rel="noopener" class="student-whatsapp-link">${escapeHtml(whatsappFormatted)}</a>
              </td>
              <td><span class="student-due-day">${dueDay}</span></td>
              <td>${statusBadge}</td>
              <td>
                <div class="student-actions">
                  <button class="student-action-btn" title="Editar dados" onclick="openAlunoEditor('${safeId}', 'dados')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="student-action-btn" title="Treinos" onclick="openAlunoEditor('${safeId}', 'treinos')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                  </button>
                  <button class="student-action-btn" title="Progresso e relatório" onclick="openAlunoEditor('${safeId}', 'progresso')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  </button>
                  <button class="student-action-btn" title="Avaliações físicas" onclick="openAlunoEditor('${safeId}', 'avaliacoes')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  </button>
                  <button class="student-action-btn danger" title="Excluir aluno" onclick="excluirAluno('${safeId}', '${safeName.replace(/'/g, "\\'")}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join("");
      }

      function _atualizarAlunosStats(alunos) {
        const today = new Date().toISOString().slice(0, 10);
        const confirmaramHoje = alunos.filter(a => a.last_session_date === today).length;

        // "Fantasma": sem confirmação há mais de 4 dias (e está ativo)
        const fantasmas = alunos.filter(a => {
          if (a.is_active === false) return false;
          if (!a.last_session_date) return false;
          const diff = Math.round((new Date() - new Date(a.last_session_date + "T12:00:00")) / (1000 * 60 * 60 * 24));
          return diff > 4;
        }).length;

        const activeCount = alunos.filter(a => a.is_active !== false).length;
        const pendingCount = alunos.filter(a => a.payment_status === "pendente").length;
        const overdueCount = alunos.filter(a => a.payment_status === "atrasado").length;

        const subtitleEl = document.getElementById("alunosSubtitle");
        if (subtitleEl) {
          const parts = [];
          parts.push(`${activeCount} aluno${activeCount !== 1 ? "s" : ""} ativo${activeCount !== 1 ? "s" : ""}`);
          if (pendingCount > 0) parts.push(`${pendingCount} mensalidade${pendingCount !== 1 ? "s" : ""} pendente${pendingCount !== 1 ? "s" : ""}`);
          if (overdueCount > 0) parts.push(`${overdueCount} em atraso`);
          subtitleEl.textContent = parts.join(" · ");
        }

        const statHoje = document.getElementById("statConfirmaramHoje");
        if (statHoje) statHoje.textContent = confirmaramHoje;

        const statFantasma = document.getElementById("statFantasma");
        if (statFantasma) statFantasma.textContent = fantasmas;
      }

      function filtrarAlunosLocal(searchValue) {
        _renderizarTabelaAlunos(alunosTodosCache, alunosFilterAtivo);
      }

      function setAlunosFilter(filter, btnEl) {
        alunosFilterAtivo = filter;
        // Atualizar classes dos botões
        document.querySelectorAll(".alunos-filter-btn").forEach(b => b.classList.remove("active"));
        if (btnEl) btnEl.classList.add("active");
        _renderizarTabelaAlunos(alunosTodosCache, filter);
      }

      async function openAlunoEditor(studentId, view) {
        if (!studentId) return;
        window.location.href = buildAlunoEditorUrl(studentId, view || null);
      }

      async function excluirAluno(studentId, studentName) {
        const nome = studentName || "este aluno";
        const ok = await showConfirm(`Deseja realmente excluir ${nome}? Esta ação não pode ser desfeita.`, {
          title: "Excluir aluno",
          confirmLabel: "Excluir",
          cancelLabel: "Cancelar",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${studentId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            },
          );

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || "Erro ao excluir aluno");
          }

          if (currentEditingStudentId === studentId) {
            closeAlunoEditor();
          }

          showAlert("alunosAlert", "Aluno excluído com sucesso!", "success");
          await carregarAlunos();
          await carregarAlunosSelect();
        } catch (error) {
          showAlert(
            "alunosAlert",
            error.message || "Erro ao excluir aluno",
            "error",
          );
        }
      }

      function closeAlunoEditor(event) {
        currentEditingStudentId = null;
        window.location.href = buildPersonalPageUrl("alunos");
      }

      // ── Avaliações Físicas (armazenamento local por aluno) ──────────────────

      function _avaliacaoStorageKey(studentId) {
        return `ezp_avaliacoes_${studentId}`;
      }

      function _lerAvaliacoes(studentId) {
        try {
          const raw = localStorage.getItem(_avaliacaoStorageKey(studentId));
          return raw ? JSON.parse(raw) : [];
        } catch { return []; }
      }

      function _salvarAvaliacoes(studentId, avaliacoes) {
        localStorage.setItem(_avaliacaoStorageKey(studentId), JSON.stringify(avaliacoes));
      }

      function carregarAvaliacoes(studentId) {
        const list = document.getElementById("studentAvaliacoesList");
        if (!list) return;
        const avaliacoes = _lerAvaliacoes(studentId);

        if (!avaliacoes.length) {
          list.innerHTML = `
            <div class="avaliacao-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              <p>Nenhuma avaliação registrada ainda.</p>
              <span>Clique em "+ Nova avaliação" para registrar a primeira.</span>
            </div>`;
          return;
        }

        // Ordenar da mais recente para mais antiga
        const sorted = [...avaliacoes].sort((a, b) => (b.data || "").localeCompare(a.data || ""));

        list.innerHTML = sorted.map((av, idx) => {
          const imc = av.peso && av.altura
            ? (av.peso / Math.pow(av.altura / 100, 2)).toFixed(1)
            : av.imc || "—";
          return `
            <div class="avaliacao-card">
              <div class="avaliacao-card-header">
                <span class="avaliacao-card-date">${av.data ? _formatFinanceDueDate(av.data) : "—"}</span>
                <button class="student-action-btn danger" style="width:28px;height:28px;" title="Excluir avaliação"
                  onclick="excluirAvaliacao('${escapeHtml(studentId)}', '${escapeHtml(av.id)}')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                </button>
              </div>
              <div class="avaliacao-card-metrics">
                ${av.peso     ? `<div class="avaliacao-metric"><span>Peso</span><strong>${av.peso} kg</strong></div>` : ""}
                ${av.altura   ? `<div class="avaliacao-metric"><span>Altura</span><strong>${av.altura} cm</strong></div>` : ""}
                ${imc !== "—" ? `<div class="avaliacao-metric"><span>IMC</span><strong>${imc}</strong></div>` : ""}
                ${av.gordura  ? `<div class="avaliacao-metric"><span>% Gordura</span><strong>${av.gordura}%</strong></div>` : ""}
                ${av.massa    ? `<div class="avaliacao-metric"><span>% Massa</span><strong>${av.massa}%</strong></div>` : ""}
              </div>
              ${av.obs ? `<p class="avaliacao-card-obs">${escapeHtml(av.obs)}</p>` : ""}
            </div>`;
        }).join("");
      }

      function abrirNovaAvaliacao() {
        const form = document.getElementById("studentAvaliacaoForm");
        if (!form) return;
        form.classList.remove("hidden");
        // Preencher data com hoje
        const today = new Date().toISOString().slice(0, 10);
        const dataEl = document.getElementById("avaliacaoData");
        if (dataEl && !dataEl.value) dataEl.value = today;
        // Auto-cálculo do IMC
        const pesoEl   = document.getElementById("avaliacaoPeso");
        const alturaEl = document.getElementById("avaliacaoAltura");
        const imcEl    = document.getElementById("avaliacaoImc");
        const calcImc = () => {
          const p = parseFloat(pesoEl?.value);
          const a = parseFloat(alturaEl?.value);
          if (p > 0 && a > 0 && imcEl) {
            imcEl.value = (p / Math.pow(a / 100, 2)).toFixed(1);
          } else if (imcEl) { imcEl.value = ""; }
        };
        pesoEl?.addEventListener("input", calcImc);
        alturaEl?.addEventListener("input", calcImc);
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function cancelarAvaliacao() {
        const form = document.getElementById("studentAvaliacaoForm");
        if (form) {
          form.classList.add("hidden");
          // Limpar campos
          ["avaliacaoData","avaliacaoPeso","avaliacaoAltura","avaliacaoGordura","avaliacaoMassa","avaliacaoImc","avaliacaoObservacoes"]
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        }
      }

      function salvarAvaliacao() {
        if (!currentEditingStudentId) return;
        const data    = document.getElementById("avaliacaoData")?.value;
        const peso    = document.getElementById("avaliacaoPeso")?.value;
        const altura  = document.getElementById("avaliacaoAltura")?.value;
        const gordura = document.getElementById("avaliacaoGordura")?.value;
        const massa   = document.getElementById("avaliacaoMassa")?.value;
        const imc     = document.getElementById("avaliacaoImc")?.value;
        const obs     = document.getElementById("avaliacaoObservacoes")?.value?.trim();

        if (!data) { showToast("Informe a data da avaliação.", "warn"); return; }
        if (!peso && !gordura && !massa) { showToast("Informe pelo menos um dado da avaliação.", "warn"); return; }

        const avaliacao = {
          id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          data,
          peso:    peso    ? parseFloat(peso)    : null,
          altura:  altura  ? parseFloat(altura)  : null,
          gordura: gordura ? parseFloat(gordura) : null,
          massa:   massa   ? parseFloat(massa)   : null,
          imc:     imc     ? parseFloat(imc)     : null,
          obs:     obs || null,
          criadoEm: new Date().toISOString(),
        };

        const avaliacoes = _lerAvaliacoes(currentEditingStudentId);
        avaliacoes.push(avaliacao);
        _salvarAvaliacoes(currentEditingStudentId, avaliacoes);

        showToast("Avaliação salva com sucesso!", "success");
        cancelarAvaliacao();
        carregarAvaliacoes(currentEditingStudentId);
      }

      function excluirAvaliacao(studentId, avaliacaoId) {
        const avaliacoes = _lerAvaliacoes(studentId).filter(a => a.id !== avaliacaoId);
        _salvarAvaliacoes(studentId, avaliacoes);
        carregarAvaliacoes(studentId);
        showToast("Avaliação excluída.", "info");
      }

      async function carregarDetalhesAlunoEditor(studentId) {
        try {
          // Carregar perfil + treinos em paralelo (sessões paginadas separadas)
          const [profileRes, workoutsRes] = await Promise.all([
            fetch(`${getApiBaseUrl()}/api/students/${studentId}/profile`, {
              headers: { Authorization: `Bearer ${authToken}` },
            }),
            fetch(`${getApiBaseUrl()}/api/students/${studentId}/workouts`, {
              headers: { Authorization: `Bearer ${authToken}` },
            }),
          ]);

          if (!profileRes.ok)  throw new Error(`Perfil HTTP ${profileRes.status}`);
          if (!workoutsRes.ok) throw new Error(`Treinos HTTP ${workoutsRes.status}`);

          const profileData  = await profileRes.json();
          const workoutsData = await workoutsRes.json();

          const student = profileData.student;

          const titleName = document.getElementById("studentEditorTitleName");
          if (titleName) titleName.textContent = student.name || "Aluno";

          document.getElementById("editAlunoNome").value        = student.name || "";
          document.getElementById("editAlunoEmail").value       = student.email || "";
          document.getElementById("editAlunoWhatsapp").value    = student.whatsapp_number || "";
          document.getElementById("editAlunoTipoSanguineo").value = student.blood_type || "";
          document.getElementById("editAlunoPeso").value        = student.weight_kg ?? "";
          document.getElementById("editAlunoAltura").value      = student.height_cm ?? "";
          document.getElementById("editAlunoMensalidade").value = student.monthly_fee ?? "";
          document.getElementById("editAlunoDiaPagamento").value = student.payment_day ?? "";

          const workouts = workoutsData.workouts || [];
          currentStudentAssignedWorkoutIds = workouts
            .map((w) => w?.id)
            .filter((id) => typeof id === "string");

          studentInsightsActiveTab = "history";
          studentReportData = null;
          studentReportCalendarYear  = new Date().getFullYear();
          studentReportCalendarMonth = new Date().getMonth();
          studentSessionsPage = 1;

          openStudentInsightsTab("history");
          renderStudentWorkoutsEditor(workouts);
          renderAvailableWorkoutsForStudent([]); // carregado on-demand ao abrir o seletor
          renderHistoricoPagamentosAluno(
            profileData.payment_history || [],
            student.payment_day,
          );

          // Carregar sessões apenas se a view de progresso estiver ativa
          const currentView = getAlunoEditorViewFromUrl();
          if (currentView === "progresso") {
            carregarSessoesAluno(studentId, 1);
          }
        } catch (error) {
          console.error("Erro ao carregar detalhes do aluno:", error);
          showAlert("studentEditorAlert", "Erro ao carregar dados do aluno", "error");
        }
      }

      async function carregarSessoesAluno(studentId, page) {
        try {
          studentSessionsPage = page || 1;
          const res = await fetch(
            `${getApiBaseUrl()}/api/students/${studentId}/sessions?page=${studentSessionsPage}&limit=${STUDENT_SESSIONS_API_PAGE_SIZE}`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();
          renderStudentSessionsEditor(result.data || []);

          // Atualizar controles de paginação de sessões
          const paginationEl = document.getElementById("studentSessionsPagination");
          if (paginationEl) {
            const totalPages = result.pagination?.total_pages ?? 1;
            if (totalPages <= 1) {
              paginationEl.innerHTML = "";
            } else {
              paginationEl.innerHTML = `
                <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                  <button class="btn btn-secondary" onclick="carregarSessoesAluno('${studentId}',${studentSessionsPage - 1})" ${studentSessionsPage <= 1 ? "disabled" : ""}>← Anterior</button>
                  <span style="font-size:12px;color:#6b7280;">Página ${studentSessionsPage} de ${totalPages}</span>
                  <button class="btn btn-secondary" onclick="carregarSessoesAluno('${studentId}',${studentSessionsPage + 1})" ${studentSessionsPage >= totalPages ? "disabled" : ""}>Próxima →</button>
                </div>`;
            }
          }
        } catch (err) {
          console.error("Erro ao carregar sessões do aluno:", err);
        }
      }

      async function salvarAlunoEdicao() {
        if (!currentEditingStudentId) return;

        try {
          const payload = {
            name: document.getElementById("editAlunoNome").value.trim(),
            email:
              document.getElementById("editAlunoEmail").value.trim() || null,
            whatsapp_number: document
              .getElementById("editAlunoWhatsapp")
              .value.trim(),
            blood_type:
              document.getElementById("editAlunoTipoSanguineo").value.trim() ||
              null,
            weight_kg:
              document.getElementById("editAlunoPeso").value === ""
                ? null
                : Number(document.getElementById("editAlunoPeso").value),
            height_cm:
              document.getElementById("editAlunoAltura").value === ""
                ? null
                : Number(document.getElementById("editAlunoAltura").value),
            monthly_fee:
              document.getElementById("editAlunoMensalidade").value === ""
                ? null
                : Number(document.getElementById("editAlunoMensalidade").value),
            payment_day:
              document.getElementById("editAlunoDiaPagamento").value === ""
                ? null
                : Number(document.getElementById("editAlunoDiaPagamento").value),
          };

          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (response.status === 409) {
              throw new Error(
                "Este WhatsApp já está vinculado a outro aluno. Confirme o número com o personal responsável.",
              );
            }
            throw new Error(err.message || "Erro ao salvar aluno");
          }

          showAlert(
            "studentEditorAlert",
            "Aluno atualizado com sucesso",
            "success",
          );
          await carregarPagamentosAlunoEdicao();
          await carregarFinanceiroDashboard(false);
          carregarAlunos();
          carregarAlunosSelect();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao atualizar aluno",
            "error",
          );
        }
      }

      // ── Cache do dashboard financeiro para filtro local ──────────────────────
      let _financeiroCache = null; // { payload, reference_month }

      function formatCurrencyBRL(value) {
        const amount = Number(value || 0);
        return amount.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 2,
        });
      }

      function formatReferenceMonthLabel(referenceMonth) {
        if (!referenceMonth || !/^\d{4}-\d{2}$/.test(referenceMonth)) {
          return "-";
        }

        const [year, month] = referenceMonth.split("-").map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        });
      }

      function formatDateLabel(dateValue) {
        if (!dateValue) return "-";
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return "-";
        return parsed.toLocaleDateString("pt-BR");
      }

      function renderFinanceStudentList(rows, mode) {
        if (!Array.isArray(rows) || rows.length === 0) {
          return '<p style="color:#6b7280;">Nenhum aluno nesta lista.</p>';
        }

        return `
          <div class="finance-student-list">
            ${rows
              .map((row) => {
                const dueDate = formatDateLabel(row?.due_date);
                const amount = formatCurrencyBRL(row?.monthly_fee);
                const secondary =
                  mode === "overdue"
                    ? `${row?.days_overdue || 0} dia(s) em atraso`
                    : `vence em ${row?.days_until_due || 0} dia(s)`;

                return `
                  <div class="finance-student-item">
                    <span class="finance-student-name">${escapeHtml(row?.name || "Aluno")}</span>
                    <span class="finance-student-meta">Vencimento: ${escapeHtml(dueDate)} | Mensalidade: ${escapeHtml(amount)}</span>
                    <span class="finance-student-meta">${escapeHtml(secondary)}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        `;
      }

      async function carregarFinanceiroDashboard(showErrors = true) {
        if (isAdminSession) return;
        markTabLoaded("financeiro");

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/finance/dashboard`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao carregar dashboard financeiro");
          }

          _financeiroCache = payload;

          const indicators      = payload.indicators || {};
          const referenceMonth  = payload.reference_month || "";
          const refLabel        = formatReferenceMonthLabel(referenceMonth);

          // ── Subtítulo da página ──
          const referenceEl = document.getElementById("financeiroReferenceMonth");
          if (referenceEl) {
            const now = new Date();
            const monthName = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
            referenceEl.textContent = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} · cobrança automática 5 dias antes, no vencimento e após o vencimento`;
          }

          // ── KPI Cards ──
          const earnedEl      = document.getElementById("financeMetricEarned");
          const toReceiveEl   = document.getElementById("financeMetricToReceive");
          const overdueEl     = document.getElementById("financeMetricOverdue");
          const tagPaidEl     = document.getElementById("financeTagPaid");
          const tagToReceiveEl = document.getElementById("financeTagToReceive");
          const tagOverdueEl  = document.getElementById("financeTagOverdue");

          if (earnedEl)    earnedEl.textContent    = formatCurrencyBRL(indicators.earned_amount    || 0);
          if (toReceiveEl) toReceiveEl.textContent = formatCurrencyBRL(indicators.to_receive_amount || 0);
          if (overdueEl)   overdueEl.textContent   = formatCurrencyBRL(indicators.overdue_amount   || 0);

          if (tagPaidEl) {
            tagPaidEl.textContent = `${indicators.paid_count || 0} de ${indicators.billable_count || 0} mensalidades`;
          }
          if (tagToReceiveEl) {
            tagToReceiveEl.textContent = `${(indicators.billable_count || 0) - (indicators.paid_count || 0) - (indicators.overdue_count || 0)} a vencer`;
          }
          if (tagOverdueEl) {
            tagOverdueEl.textContent = `${indicators.overdue_count || 0} atrasado${indicators.overdue_count !== 1 ? "s" : ""}`;
          }

          // ── Seletor de mês (gera opções com o mês atual por padrão) ──
          _populateFinanceMonthFilter(referenceMonth);

          // ── Renderizar tabela ──
          _renderizarTabelaFinanceiro(payload.all_students || [], "");

        } catch (error) {
          if (showErrors) {
            showToast(error?.message || "Erro ao carregar dashboard financeiro", "error");
          }
        }
      }

      function _populateFinanceMonthFilter(currentMonth) {
        const sel = document.getElementById("financeMonthFilter");
        if (!sel) return;

        // Gera últimos 6 meses + próximo mês
        const options = [];
        const now = new Date();
        for (let i = -1; i <= 5; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
          const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
          const parts = capitalized.split(" de ");
          const shortLabel = `${parts[0].slice(0, 3)}/${parts[1] || d.getFullYear()}`;
          options.push({ value, label: shortLabel, fullLabel: capitalized });
        }

        sel.innerHTML = options.map(o =>
          `<option value="${o.value}"${o.value === currentMonth ? " selected" : ""}>${o.label}</option>`
        ).join("");
      }

      function filtrarTabelaFinanceiro() {
        if (!_financeiroCache) return;
        const statusFilter = document.getElementById("financeStatusFilter")?.value || "";
        _renderizarTabelaFinanceiro(_financeiroCache.all_students || [], statusFilter);
      }

      function _renderizarTabelaFinanceiro(students, statusFilter) {
        const tbody = document.getElementById("financeiroTableBody");
        if (!tbody) return;

        const filtered = statusFilter
          ? students.filter(s => s.payment_status === statusFilter)
          : students;

        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:32px;">Nenhum registro encontrado.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(s => {
          const name        = escapeHtml(s.name || "—");
          const amount      = escapeHtml(formatCurrencyBRL(s.monthly_fee || 0));
          const dueDate     = s.due_date ? _formatFinanceDueDate(s.due_date) : "—";
          const statusBadge = _financeStatusBadge(s.payment_status);
          const actionBtn   = _financeActionBtn(s);

          return `
            <tr>
              <td><span class="finance-student-name-cell">${name}</span></td>
              <td><span class="finance-amount-cell">${amount}</span></td>
              <td><span class="finance-due-cell">${dueDate}</span></td>
              <td>${statusBadge}</td>
              <td style="text-align:right;">${actionBtn}</td>
            </tr>`;
        }).join("");

        // Rodapé
        const noteEl = document.getElementById("financeiroFooterNote");
        if (noteEl) {
          noteEl.textContent = `${filtered.length} cobrança${filtered.length !== 1 ? "s" : ""} exibida${filtered.length !== 1 ? "s" : ""}`;
        }
      }

      function _formatFinanceDueDate(dateStr) {
        if (!dateStr) return "—";
        try {
          const [y, m, d] = dateStr.split("-");
          return `${d}/${m}/${y}`;
        } catch (_) { return dateStr; }
      }

      function _financeStatusBadge(status) {
        if (status === "pago")     return `<span class="badge-pago">Pago</span>`;
        if (status === "atrasado") return `<span class="badge-atrasado">Atrasado</span>`;
        return `<span class="badge-pendente">Pendente</span>`;
      }

      function _financeActionBtn(student) {
        const safeId   = escapeHtml(student.id || "");
        const safeName = escapeHtml(student.name || "").replace(/'/g, "\\'");
        const safePhone = escapeHtml(student.whatsapp_number || "");

        if (student.payment_status === "pago") {
          return `<button class="finance-action-btn" onclick="marcarPagamentoAluno('${safeId}', false)" title="Marcar como não pago">Recibo</button>`;
        }
        if (student.payment_status === "atrasado") {
          const waLink = safePhone
            ? `https://wa.me/${safePhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${student.name || ""}, sua mensalidade está em atraso. Podemos regularizar?`)}`
            : null;
          return waLink
            ? `<button class="finance-action-btn btn-cobrar" onclick="window.open('${waLink}','_blank')" title="Cobrar via WhatsApp">Cobrar</button>`
            : `<button class="finance-action-btn btn-cobrar" onclick="marcarPagamentoAluno('${safeId}', true)" title="Marcar como pago">Marcar pago</button>`;
        }
        // Pendente
        const waLink = safePhone
          ? `https://wa.me/${safePhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${student.name || ""}, segue o Pix para pagamento da mensalidade!`)}`
          : null;
        return waLink
          ? `<button class="finance-action-btn btn-pix" onclick="window.open('${waLink}','_blank')" title="Enviar Pix via WhatsApp">Enviar Pix</button>`
          : `<button class="finance-action-btn" onclick="marcarPagamentoAluno('${safeId}', true)" title="Marcar como pago">Marcar pago</button>`;
      }

      async function marcarPagamentoAluno(studentId, received) {
        if (!studentId) return;
        const now = new Date();
        const refMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${studentId}/payments/${refMonth}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ received }),
            }
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          showToast(received ? "Pagamento marcado como recebido" : "Pagamento desmarcado", "success");
          await carregarFinanceiroDashboard(false);
        } catch (err) {
          showToast(err?.message || "Erro ao atualizar pagamento", "error");
        }
      }

      function renderFinanceStudentList(rows, mode) {
        if (!Array.isArray(rows) || rows.length === 0) {
          return '<p style="color:#6b7280;">Nenhum aluno nesta lista.</p>';
        }
        return `
          <div class="finance-student-list">
            ${rows.map((row) => {
              const dueDate  = formatDateLabel(row?.due_date);
              const amount   = formatCurrencyBRL(row?.monthly_fee);
              const secondary = mode === "overdue"
                ? `${row?.days_overdue || 0} dia(s) em atraso`
                : `vence em ${row?.days_until_due || 0} dia(s)`;
              return `
                <div class="finance-student-item">
                  <span class="finance-student-name">${escapeHtml(row?.name || "Aluno")}</span>
                  <span class="finance-student-meta">Vencimento: ${escapeHtml(dueDate)} | Mensalidade: ${escapeHtml(amount)}</span>
                  <span class="finance-student-meta">${escapeHtml(secondary)}</span>
                </div>`;
            }).join("")}
          </div>`;
      }

      function renderHistoricoPagamentosAluno(history, paymentDay) {
        const root = document.getElementById("studentEditorPaymentsHistory");
        if (!root) return;

        if (!Array.isArray(history) || history.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Sem meses disponíveis para controle.</p>';
          return;
        }

        root.innerHTML = `
          <div class="payment-history-list">
            ${history
              .slice()
              .reverse()
              .map((row) => {
                const referenceMonth = String(row?.reference_month || "");
                const monthLabel = formatReferenceMonthLabel(referenceMonth);
                const dueDate = row?.due_date ? formatDateLabel(row.due_date) : "Sem dia definido";
                const receivedAt = row?.received_at
                  ? `Recebido em ${formatDateLabel(row.received_at)}`
                  : "Ainda não recebido";

                return `
                  <div class="payment-history-row">
                    <div>
                      <strong style="text-transform:capitalize;">${escapeHtml(monthLabel)}</strong><br />
                      <small>Vencimento: ${escapeHtml(dueDate)}</small>
                    </div>
                    <div>
                      <small>${escapeHtml(receivedAt)}</small>
                    </div>
                    <label class="payment-history-toggle">
                      <input
                        type="checkbox"
                        ${row?.received ? "checked" : ""}
                        onchange="atualizarStatusRecebimentoAluno('${referenceMonth}', this.checked)"
                      />
                      Recebido
                    </label>
                  </div>
                `;
              })
              .join("")}
          </div>
        `;
      }

      async function carregarPagamentosAlunoEdicao() {
        if (!currentEditingStudentId) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/payments`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao carregar pagamentos");
          }

          renderHistoricoPagamentosAluno(
            payload.history || [],
            payload.student?.payment_day,
          );
        } catch (error) {
          const root = document.getElementById("studentEditorPaymentsHistory");
          if (root) {
            root.innerHTML = `<p style="color:#ef4444;">${escapeHtml(error?.message || "Erro ao carregar pagamentos")}</p>`;
          }
        }
      }

      async function atualizarStatusRecebimentoAluno(referenceMonth, received) {
        if (!currentEditingStudentId || !referenceMonth) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/payments/${encodeURIComponent(referenceMonth)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({ received: Boolean(received) }),
            },
          );

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao atualizar pagamento");
          }

          await carregarPagamentosAlunoEdicao();
          await carregarFinanceiroDashboard(false);
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error?.message || "Erro ao atualizar pagamento",
            "error",
          );
          await carregarPagamentosAlunoEdicao();
        }
      }

      function renderStudentWorkoutsEditor(workouts) {
        const root = document.getElementById("studentEditorWorkouts");
        if (!workouts || workouts.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Nenhum treino cadastrado.</p>';
          return;
        }

        root.innerHTML = workouts
          .map((workout) => {
            const exercises = workout.workout_exercises || [];
            const displayValidUntil = workout.assignment_valid_until
              ? new Date(workout.assignment_valid_until).toLocaleDateString(
                  "pt-BR",
                )
              : "Sem validade";
            const trackingMode = workout.assignment_tracking_mode || "per_exercise";
            return `
              <details class="workout-card workout-accordion">
                <summary>
                  <span class="workout-summary-title">${escapeHtml(workout.name || "Treino")}</span>
                  <span class="accordion-summary-right">
                    <span class="workout-summary-validity">Validade: ${escapeHtml(displayValidUntil)}</span>
                    <span class="accordion-chevron" aria-hidden="true"></span>
                  </span>
                </summary>

                <div class="workout-accordion-body">
                  <div class="workout-meta">
                    <span>ID treino: ${escapeHtml(workout.id)}</span>
                  </div>
                  <div class="editor-grid">
                    <div class="form-group full">
                      <label>Nome do treino</label>
                      <input type="text" id="w_name_${workout.id}" value="${escapeHtml(workout.name || "")}" />
                    </div>
                    <div class="form-group">
                      <label>Data base do treino</label>
                      <input type="date" id="w_start_${workout.id}" value="${escapeHtml(workout.start_date || "")}" />
                    </div>
                    <div class="form-group">
                      <label>Validade para este aluno</label>
                      <input type="date" id="w_until_${workout.id}" value="${escapeHtml(workout.assignment_valid_until || "")}" />
                    </div>
                    <div class="form-group full">
                      <label>Modo de acompanhamento</label>
                      <select id="w_tracking_${workout.id}">
                        <option value="per_exercise" ${trackingMode === "per_exercise" ? "selected" : ""}>A cada exercício</option>
                        <option value="per_workout" ${trackingMode === "per_workout" ? "selected" : ""}>A cada treino (PSE geral ao encerrar)</option>
                        <option value="none" ${trackingMode === "none" ? "selected" : ""}>Sem acompanhamento</option>
                      </select>
                    </div>
                  </div>
                  <button class="btn btn-primary" onclick="salvarTreinoAluno('${workout.id}')">Salvar treino</button>
                  <button class="btn btn-secondary" style="margin-left:8px;" onclick="desvincularTreinoDoAluno('${workout.id}')">Desvincular do aluno</button>


                  <div style="margin-top: 10px;">
                    <h4 class="workout-section-title">Exerc&#237;cios</h4>
                    ${
                      exercises.length > 0
                        ? (() => {
                            const sorted = [...exercises].sort((a, b) => a.order_index - b.order_index);
                            const containerId = `we_list_${workout.id}`;
                            return `<div id="${containerId}" class="exercise-list-dnd">${
                              sorted.map((ex) => {
                                const catalog = Array.isArray(ex.exercise_catalog) ? ex.exercise_catalog[0] : ex.exercise_catalog;
                                const variation = Array.isArray(ex.exercise_variations) ? ex.exercise_variations[0] : ex.exercise_variations;
                                const legacy = Array.isArray(ex.exercises) ? ex.exercises[0] : ex.exercises;
                                const displayName = ex._display_name || (catalog?.name ?? legacy?.name ?? "Exerc\u00edcio") + (variation?.name ? " - " + variation.name : "");
                                return `
                                <div class="exercise-row" draggable="true" data-we-id="${ex.id}" data-workout-id="${workout.id}" data-order="${ex.order_index}">
                                  <p class="exercise-title"><span class="drag-handle" title="Arrastar para reordenar">&#9776;</span>&#127947; ${escapeHtml(displayName)}</p>
                                   <div class="exercise-fields-grid">
                                     <div class="exercise-field">
                                       <label for="we_sets_${ex.id}">S&#233;ries</label>
                                       <input type="number" min="1" id="we_sets_${ex.id}" value="${escapeHtml(String(ex.target_sets || ""))}" />
                                     </div>
                                     <div class="exercise-field">
                                       <label for="we_reps_${ex.id}">Repeti&#231;&#245;es</label>
                                       <input type="number" min="1" id="we_reps_${ex.id}" value="${escapeHtml(String(ex.target_reps || ""))}" />
                                     </div>
                                     <div class="exercise-field">
                                       <label for="we_weight_${ex.id}">Peso (kg)</label>
                                       <input type="number" min="0" step="0.1" id="we_weight_${ex.id}" value="${escapeHtml(ex.target_weight == null ? "" : String(ex.target_weight))}" />
                                     </div>
                                     <div class="exercise-field">
                                       <label for="we_rest_${ex.id}">Descanso (s)</label>
                                       <input type="number" min="0" step="1" id="we_rest_${ex.id}" value="${escapeHtml(ex.rest_seconds == null ? "" : String(ex.rest_seconds))}" />
                                     </div>
                                   </div>
                                   <input type="hidden" id="we_order_${ex.id}" value="${escapeHtml(String(ex.order_index ?? 0))}" />
                                   <div class="form-group" style="margin-top:8px;">
                                     <label for="we_desc_${ex.id}">Orienta&#231;&#245;es/observa&#231;&#245;es <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                                     <textarea id="we_desc_${ex.id}" rows="2" placeholder="Orientações personalizadas para este exercício neste treino">${escapeHtml(ex.custom_description || "")}</textarea>
                                   </div>
                                   <div class="exercise-actions">
                                     <button class="btn btn-primary" onclick="salvarExercicioTreino('${workout.id}','${ex.id}')">Salvar</button>
                                     <button class="btn btn-danger" onclick="excluirExercicioTreino('${workout.id}','${ex.id}')">Excluir</button>
                                   </div>
                                </div>
                              `}).join("")
                            }</div>`;
                          })()
                        : '<p style="color:#6b7280;">Sem exerc&#237;cios neste treino.</p>'
                    }
                  </div>
                </div>
              </details>
            `;
          })
          .join("");
        setTimeout(initAllDndLists, 0);
      }

      function renderAvailableWorkoutsForStudent(workouts) {
        const root = document.getElementById("studentEditorAvailableWorkouts");
        currentStudentAvailableWorkouts = workouts || [];
        selectedWorkoutForStudent = null;

        root.innerHTML = `
          <div class="workout-search-shell">
            <label style="font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;display:block;">Buscar treino para atribuir</label>
            <div style="position:relative;">
              <input
                type="text"
                id="studentWorkoutSearchInput"
                placeholder="Clique ou digite para buscar um treino..."
                autocomplete="off"
                oninput="buscarTreinosParaAluno(this.value)"
                onfocus="mostrarTodosTreinosParaAluno()"
                style="width:100%;padding:9px 36px 9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:inherit;"
              />
              <svg style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#9ca3af;pointer-events:none;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <div id="studentWorkoutDropdown" class="autocomplete-dropdown" style="display:none;"></div>
            </div>
            <div id="selectedWorkoutForStudent"></div>
          </div>
        `;

        // Pré-carregar lista ao abrir para ficar pronta quando o usuário clicar
        _carregarListaTreinosDisponiveis("", false);
      }

      function mostrarTodosTreinosParaAluno() {
        const input = document.getElementById("studentWorkoutSearchInput");
        const query = (input?.value || "").trim();
        _carregarListaTreinosDisponiveis(query, true);
      }

      async function buscarTreinosParaAluno(termo) {
        if (workoutSearchTimeout) clearTimeout(workoutSearchTimeout);
        workoutSearchTimeout = setTimeout(() => {
          _carregarListaTreinosDisponiveis((termo || "").trim(), true);
        }, 200);
      }

      async function _carregarListaTreinosDisponiveis(query, showDropdown) {
        const dropdown = document.getElementById("studentWorkoutDropdown");
        if (!dropdown) return;

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/workouts`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (response.status === 401 || response.status === 403) { handleUnauthorized(); return; }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const workouts = await response.json();
          const available = (workouts || []).filter(
            (w) => !currentStudentAssignedWorkoutIds.includes(w.id),
          );
          currentStudentAvailableWorkouts = available;

          const filtered = query
            ? available.filter((w) => String(w.name || "").toLowerCase().includes(query.toLowerCase()))
            : available;

          if (!showDropdown && !query) {
            dropdown.style.display = "none";
            return;
          }

          if (filtered.length === 0) {
            dropdown.innerHTML = `<div style="padding:10px;color:#6b7280;font-size:13px;">
              ${query ? `Nenhum treino encontrado para "${escapeHtml(query)}".` : "Nenhum treino disponível para atribuir."}
            </div>`;
            dropdown.style.display = "block";
            return;
          }

          dropdown.innerHTML = filtered.map((w) => {
            const exerciseCount = Array.isArray(w.exercises) ? w.exercises.length : 0;
            const meta = [
              w.day_of_week ? w.day_of_week : null,
              exerciseCount > 0 ? `${exerciseCount} exercício${exerciseCount !== 1 ? "s" : ""}` : null,
            ].filter(Boolean).join(" · ");
            return `
              <div class="autocomplete-item"
                   onclick="selecionarTreinoParaAluno('${escapeHtml(w.id)}')"
                   onmouseover="this.style.background='#f3f4f6'"
                   onmouseout="this.style.background='white'">
                <strong>${escapeHtml(w.name || "Treino")}</strong>
                ${meta ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
              </div>`;
          }).join("");
          dropdown.style.display = "block";

        } catch (error) {
          console.error("Erro ao buscar treinos para aluno:", error);
          const dropdown2 = document.getElementById("studentWorkoutDropdown");
          if (dropdown2) {
            dropdown2.innerHTML = `<div style="padding:10px;color:#ef4444;font-size:13px;">Erro ao buscar treinos.</div>`;
            dropdown2.style.display = "block";
          }
        }
      }

      function selecionarTreinoParaAluno(workoutId) {
        const workout = currentStudentAvailableWorkouts.find(
          (w) => w.id === workoutId,
        );
        if (!workout) return;

        selectedWorkoutForStudent = workout;

        // Fechar o dropdown
        const dropdown = document.getElementById("studentWorkoutDropdown");
        if (dropdown) dropdown.style.display = "none";

        // Preencher o input com o nome do treino selecionado
        const input = document.getElementById("studentWorkoutSearchInput");
        if (input) input.value = workout.name || "";

        // Renderizar bloco de confirmação
        const selectedRoot = document.getElementById("selectedWorkoutForStudent");
        if (!selectedRoot) return;

        const exerciseCount = Array.isArray(workout.exercises) ? workout.exercises.length : 0;
        const meta = [
          workout.day_of_week ? workout.day_of_week : null,
          exerciseCount > 0 ? `${exerciseCount} exercício${exerciseCount !== 1 ? "s" : ""}` : null,
        ].filter(Boolean).join(" · ");

        selectedRoot.innerHTML = `
          <div class="selected-workout-box" style="margin-top:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
              <div>
                <strong style="font-size:13px;color:#0d1b26;">${escapeHtml(workout.name || "Treino")}</strong>
                ${meta ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
              </div>
              <button type="button" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px;"
                onclick="limparSelecaoTreino()" title="Limpar seleção">&times;</button>
            </div>
            <div class="form-group" style="margin-bottom:10px;">
              <label style="font-size:12px;font-weight:600;color:#6b7280;">Validade para este aluno (opcional)</label>
              <input type="date" id="selectedWorkoutValidUntil" style="height:36px;" />
            </div>
            <button class="btn btn-primary" style="width:100%;font-size:13px;height:38px;" onclick="atribuirTreinoAoAlunoAtual()">
              Atribuir treino ao aluno
            </button>
          </div>
        `;
      }

      function limparSelecaoTreino() {
        selectedWorkoutForStudent = null;
        const input = document.getElementById("studentWorkoutSearchInput");
        if (input) { input.value = ""; input.focus(); }
        const selectedRoot = document.getElementById("selectedWorkoutForStudent");
        if (selectedRoot) selectedRoot.innerHTML = "";
        // Mostrar todos os treinos novamente
        mostrarTodosTreinosParaAluno();
      }

      async function salvarTreinoAluno(workoutId) {
        try {
          const workoutPayload = {
            name: document.getElementById(`w_name_${workoutId}`).value.trim(),
            start_date:
              document.getElementById(`w_start_${workoutId}`).value || null,
          };
          const assignmentPayload = {
            valid_until:
              document.getElementById(`w_until_${workoutId}`).value || null,
            tracking_mode:
              document.getElementById(`w_tracking_${workoutId}`)?.value ||
              "per_exercise",
          };

          const workoutResp = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(workoutPayload),
            },
          );

          if (!workoutResp.ok) {
            const err = await workoutResp.json();
            throw new Error(err.message || "Erro ao salvar treino");
          }

          if (currentEditingStudentId) {
            const assignmentResp = await fetch(
              `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/workouts/${workoutId}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify(assignmentPayload),
              },
            );

            if (!assignmentResp.ok) {
              const err = await assignmentResp.json();
              throw new Error(err.message || "Erro ao atualizar validade");
            }
          }

          showAlert("studentEditorAlert", "Treino atualizado", "success");
          if (currentEditingStudentId) {
            await carregarDetalhesAlunoEditor(currentEditingStudentId);
          }
          carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao atualizar treino",
            "error",
          );
        }
      }

      async function desvincularTreinoDoAluno(workoutId) {
        const ok = await showConfirm("Deseja remover este treino do aluno?", {
          title: "Remover treino",
          confirmLabel: "Remover",
          variant: "danger",
        });
        if (!ok) return;

        try {
          if (!currentEditingStudentId) return;
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/workouts/${workoutId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            },
          );

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro ao desvincular treino");
          }

          showAlert("studentEditorAlert", "Treino desvinculado", "success");
          if (currentEditingStudentId) {
            await carregarDetalhesAlunoEditor(currentEditingStudentId);
          }
          carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao desvincular treino",
            "error",
          );
        }
      }

      async function atribuirTreinoAoAlunoAtual(workoutId) {
        if (!currentEditingStudentId) return;

        try {
          const finalWorkoutId = workoutId || selectedWorkoutForStudent?.id;
          if (!finalWorkoutId) {
            throw new Error("Selecione um treino para atribuir");
          }

          const validUntilInput = workoutId
            ? document.getElementById(`aw_until_${workoutId}`)
            : document.getElementById("selectedWorkoutValidUntil");
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/workouts/${finalWorkoutId}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                valid_until: validUntilInput?.value || null,
              }),
            },
          );

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro ao atribuir treino");
          }

          showAlert(
            "studentEditorAlert",
            "Treino atribuído ao aluno",
            "success",
          );
          selectedWorkoutForStudent = null;
          await carregarDetalhesAlunoEditor(currentEditingStudentId);
          carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao atribuir treino",
            "error",
          );
        }
      }
      // ── Drag & drop reorder ────────────────────────────────────────────────
      let _dndDraggingEl = null;

      function initDndList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll(".exercise-row[draggable]").forEach((row) => {
          row.addEventListener("dragstart", _dndOnDragStart);
          row.addEventListener("dragend",   _dndOnDragEnd);
          row.addEventListener("dragover",  _dndOnDragOver);
          row.addEventListener("dragleave", _dndOnDragLeave);
          row.addEventListener("drop",      _dndOnDrop);
        });
      }

      function _dndOnDragStart(e) {
        _dndDraggingEl = this;
        this.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", this.dataset.weId);
      }

      function _dndOnDragEnd() {
        this.classList.remove("dragging");
        document.querySelectorAll(".exercise-row.drag-over").forEach((el) => el.classList.remove("drag-over"));
        _dndDraggingEl = null;
      }

      function _dndOnDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (this !== _dndDraggingEl) this.classList.add("drag-over");
      }

      function _dndOnDragLeave() {
        this.classList.remove("drag-over");
      }

      function _dndOnDrop(e) {
        e.preventDefault();
        this.classList.remove("drag-over");
        if (!_dndDraggingEl || _dndDraggingEl === this) return;
        const container = this.closest(".exercise-list-dnd");
        if (!container) return;
        const rows = Array.from(container.querySelectorAll(".exercise-row[data-we-id]"));
        const fromIdx = rows.indexOf(_dndDraggingEl);
        const toIdx   = rows.indexOf(this);
        if (fromIdx === -1 || toIdx === -1) return;
        // Reorder DOM
        if (fromIdx < toIdx) {
          container.insertBefore(_dndDraggingEl, this.nextSibling);
        } else {
          container.insertBefore(_dndDraggingEl, this);
        }
        // Persist to API
        const workoutId = _dndDraggingEl.dataset.workoutId;
        const updatedRows = Array.from(container.querySelectorAll(".exercise-row[data-we-id]"));
        const payload = updatedRows.map((el, idx) => ({ id: el.dataset.weId, order_index: idx }));
        // Optimistically update data-order attrs
        updatedRows.forEach((el, idx) => { el.dataset.order = idx; });
        fetch(`${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/reorder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify(payload),
        }).catch((err) => console.error("Erro ao salvar ordem:", err));
      }

      // Chamar apos renderizar listas de exercicios
      function initAllDndLists() {
        document.querySelectorAll(".exercise-list-dnd").forEach((container) => {
          initDndList(container.id);
        });
      }
      // ─────────────────────────────────────────────────────────────────────


      async function salvarExercicioTreino(workoutId, workoutExerciseId) {
        try {
          const payload = {
            target_sets: Number(
              document.getElementById(`we_sets_${workoutExerciseId}`).value,
            ),
            target_reps: Number(
              document.getElementById(`we_reps_${workoutExerciseId}`).value,
            ),
            target_weight:
              document.getElementById(`we_weight_${workoutExerciseId}`)
                .value === ""
                ? null
                : Number(
                    document.getElementById(`we_weight_${workoutExerciseId}`)
                      .value,
                  ),
            order_index: Number(
              document.getElementById(`we_order_${workoutExerciseId}`)?.value ?? 0,
            ),
            rest_seconds:
              document.getElementById(`we_rest_${workoutExerciseId}`).value ===
              ""
                ? null
                : Number(
                    document.getElementById(`we_rest_${workoutExerciseId}`)
                      .value,
                  ),
            custom_description:
              document.getElementById(`we_desc_${workoutExerciseId}`)?.value?.trim() || null,
          };

          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/${workoutExerciseId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro ao salvar exercício");
          }

          showAlert("studentEditorAlert", "Exercício atualizado", "success");
          if (currentEditingStudentId) {
            await carregarDetalhesAlunoEditor(currentEditingStudentId);
          }
          carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao atualizar exercício",
            "error",
          );
        }
      }

      async function excluirExercicioTreino(workoutId, workoutExerciseId) {
        const ok = await showConfirm("Deseja excluir este exercício do treino?", {
          title: "Excluir exercício",
          confirmLabel: "Excluir",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/${workoutExerciseId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            },
          );

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || "Erro ao excluir exercício");
          }

          showAlert("studentEditorAlert", "Exercício removido", "success");
          if (currentEditingStudentId) {
            await carregarDetalhesAlunoEditor(currentEditingStudentId);
          }
          carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "studentEditorAlert",
            error.message || "Erro ao excluir exercício",
            "error",
          );
        }
      }

      function openStudentInsightsTab(tab) {
        const nextTab = tab === "report" ? "report" : "history";
        studentInsightsActiveTab = nextTab;

        const historyButton = document.getElementById("studentHistoryTabButton");
        const reportButton = document.getElementById("studentReportTabButton");
        const historyPanel = document.getElementById("studentInsightsHistoryPanel");
        const reportPanel = document.getElementById("studentInsightsReportPanel");

        historyButton?.classList.toggle("active", nextTab === "history");
        reportButton?.classList.toggle("active", nextTab === "report");
        historyPanel?.classList.toggle("active", nextTab === "history");
        reportPanel?.classList.toggle("active", nextTab === "report");

        if (nextTab === "report") {
          carregarRelatorioAluno();
        }
      }

      function renderStudentSessionsEditor(sessions) {
        studentSessionsAll = Array.isArray(sessions) ? sessions : [];
        studentSessionsCurrentPage = 1;
        renderStudentSessionsCurrentPage();
      }

      function changeStudentSessionsPage(nextPage) {
        const totalPages = Math.max(
          1,
          Math.ceil(studentSessionsAll.length / STUDENT_SESSIONS_PAGE_SIZE),
        );
        studentSessionsCurrentPage = Math.min(
          totalPages,
          Math.max(1, nextPage),
        );
        renderStudentSessionsCurrentPage();
      }

      function renderStudentSessionsCurrentPage() {
        const root = document.getElementById("studentEditorSessions");
        if (!root) return;

        if (!studentSessionsAll || studentSessionsAll.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Nenhum treino realizado ainda.</p>';
          return;
        }

        const totalPages = Math.max(
          1,
          Math.ceil(studentSessionsAll.length / STUDENT_SESSIONS_PAGE_SIZE),
        );
        const page = Math.min(studentSessionsCurrentPage, totalPages);
        const startIndex = (page - 1) * STUDENT_SESSIONS_PAGE_SIZE;
        const pageRows = studentSessionsAll.slice(
          startIndex,
          startIndex + STUDENT_SESSIONS_PAGE_SIZE,
        );

        const cardsHtml = pageRows
          .map((session) => {
            const date = session.date
              ? new Date(session.date).toLocaleDateString("pt-BR")
              : "-";
            return `
              <details class="session-card session-accordion">
                <summary>
                  <span class="workout-summary-title">${escapeHtml(session.workout_name || "Treino")}</span>
                  <span class="accordion-summary-right">
                    <span class="workout-summary-validity">Data: ${escapeHtml(date)}</span>
                    <span class="accordion-chevron" aria-hidden="true"></span>
                  </span>
                </summary>
                <div class="session-accordion-body">
                  <p style="color:#475569;white-space:pre-wrap;">${escapeHtml(session.summary || "Sem extrato salvo.")}</p>
                </div>
              </details>
            `;
          })
          .join("");

        root.innerHTML = `
          ${cardsHtml}
          <div class="sessions-pagination">
            <span style="color:#64748b;font-size:12px;">
              Mostrando ${startIndex + 1}-${Math.min(startIndex + STUDENT_SESSIONS_PAGE_SIZE, studentSessionsAll.length)} de ${studentSessionsAll.length} treinos
            </span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn btn-secondary" ${page <= 1 ? "disabled" : ""} onclick="changeStudentSessionsPage(${page - 1})">Anterior</button>
              <span style="color:#334155;font-size:12px;">Página ${page} de ${totalPages}</span>
              <button class="btn btn-secondary" ${page >= totalPages ? "disabled" : ""} onclick="changeStudentSessionsPage(${page + 1})">Próxima</button>
            </div>
          </div>
        `;
      }

      async function carregarRelatorioAluno() {
        if (!currentEditingStudentId) return;

        const root = document.getElementById("studentEditorReport");
        if (!root) return;

        if (studentReportData) {
          renderRelatorioAluno(studentReportData);
          return;
        }

        root.innerHTML = '<p style="color:#6b7280;">Carregando relatório...</p>';

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/students/${currentEditingStudentId}/report`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || `HTTP ${response.status}`);
          }

          studentReportData = await response.json();
          renderRelatorioAluno(studentReportData);
        } catch (error) {
          root.innerHTML = `<p style="color:#ef4444;">${escapeHtml(error?.message || "Erro ao carregar relatório")}</p>`;
        }
      }

      function renderRelatorioAluno(report) {
        const root = document.getElementById("studentEditorReport");
        if (!root) return;

        const trainedDays = Array.isArray(report?.trained_days)
          ? report.trained_days
          : [];
        const muscleGroups = Array.isArray(report?.muscle_groups)
          ? report.muscle_groups
          : [];
        const topOver = Array.isArray(report?.top_over_target)
          ? report.top_over_target
          : [];
        const topUnder = Array.isArray(report?.top_under_target)
          ? report.top_under_target
          : [];
        const weightTimeline = Array.isArray(report?.weight_timeline)
          ? report.weight_timeline
          : [];

        root.innerHTML = `
          <div class="student-report-grid">
            <div class="student-report-box">
              <h4>Calendário de treinos</h4>
              <div id="studentReportCalendar"></div>
            </div>
            <div class="student-report-box">
              <h4>Grupos musculares mais treinados</h4>
              <div id="studentReportRadar"></div>
            </div>
          </div>

          <div class="student-report-metrics" style="margin-top:12px;">
            <div class="student-report-box">
              <h4>Top 5 acima da carga recomendada</h4>
              <ul class="student-report-list" id="studentTopOverList"></ul>
            </div>
            <div class="student-report-box">
              <h4>Top 5 abaixo da carga recomendada</h4>
              <ul class="student-report-list" id="studentTopUnderList"></ul>
            </div>
          </div>

          <div class="student-report-box" style="margin-top:12px;">
            <h4>Evolução de peso do aluno</h4>
            <div id="studentWeightTimeline"></div>
          </div>
        `;

        renderStudentReportCalendar(trainedDays);
        renderStudentReportRadar(muscleGroups);
        renderStudentOverUnderList("studentTopOverList", topOver, true);
        renderStudentOverUnderList("studentTopUnderList", topUnder, false);
        renderStudentWeightTimeline(weightTimeline);
      }

      function changeStudentReportCalendarMonth(step) {
        studentReportCalendarMonth += step;
        if (studentReportCalendarMonth < 0) {
          studentReportCalendarMonth = 11;
          studentReportCalendarYear -= 1;
        } else if (studentReportCalendarMonth > 11) {
          studentReportCalendarMonth = 0;
          studentReportCalendarYear += 1;
        }

        if (studentReportData) {
          renderStudentReportCalendar(studentReportData.trained_days || []);
        }
      }

      function renderStudentReportCalendar(trainedDays) {
        const root = document.getElementById("studentReportCalendar");
        if (!root) return;

        const trainedSet = new Set(
          (trainedDays || []).map((day) => String(day).slice(0, 10)),
        );
        const weekDays = ["D", "S", "T", "Q", "Q", "S", "S"];
        const monthLabel = new Date(
          studentReportCalendarYear,
          studentReportCalendarMonth,
          1,
        ).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const firstDay = new Date(
          studentReportCalendarYear,
          studentReportCalendarMonth,
          1,
        );
        const lastDay = new Date(
          studentReportCalendarYear,
          studentReportCalendarMonth + 1,
          0,
        );

        const startWeekday = firstDay.getDay();
        const totalDays = lastDay.getDate();
        const cells = [];

        for (let i = 0; i < startWeekday; i += 1) {
          cells.push('<td></td>');
        }

        for (let day = 1; day <= totalDays; day += 1) {
          const dateKey = `${studentReportCalendarYear}-${String(
            studentReportCalendarMonth + 1,
          ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const trained = trainedSet.has(dateKey);
          cells.push(
            `<td><span class="student-calendar-day ${trained ? "trained" : ""}">${day}</span></td>`,
          );
        }

        while (cells.length % 7 !== 0) {
          cells.push('<td></td>');
        }

        const rows = [];
        for (let i = 0; i < cells.length; i += 7) {
          rows.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);
        }

        root.innerHTML = `
          <div class="student-calendar-header">
            <button class="btn btn-secondary" onclick="changeStudentReportCalendarMonth(-1)">&#8592;</button>
            <strong style="text-transform:capitalize;">${escapeHtml(monthLabel)}</strong>
            <button class="btn btn-secondary" onclick="changeStudentReportCalendarMonth(1)">&#8594;</button>
          </div>
          <table class="student-calendar-grid">
            <thead>
              <tr>${weekDays.map((day) => `<th>${day}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${rows.join("")}
            </tbody>
          </table>
        `;
      }

      function renderStudentReportRadar(muscleGroups) {
        const root = document.getElementById("studentReportRadar");
        if (!root) return;

        const data = (muscleGroups || []).filter(
          (item) => Number(item?.sessions ?? 0) > 0,
        );

        if (data.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Sem dados suficientes para o gráfico de teia.</p>';
          return;
        }

        const width = 320;
        const height = 320;
        const cx = width / 2;
        const cy = height / 2;
        const radius = 110;
        const maxValue = Math.max(...data.map((d) => Number(d.sessions || 0)), 1);
        const steps = 4;

        const gridPolygons = [];
        for (let step = 1; step <= steps; step += 1) {
          const scale = step / steps;
          const points = data
            .map((_, idx) => {
              const angle = (Math.PI * 2 * idx) / data.length - Math.PI / 2;
              const x = cx + Math.cos(angle) * radius * scale;
              const y = cy + Math.sin(angle) * radius * scale;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
          gridPolygons.push(
            `<polygon points="${points}" fill="none" stroke="#e2e8f0" stroke-width="1" />`,
          );
        }

        const axes = data
          .map((item, idx) => {
            const angle = (Math.PI * 2 * idx) / data.length - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            const lx = cx + Math.cos(angle) * (radius + 22);
            const ly = cy + Math.sin(angle) * (radius + 22);
            return `
              <line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#cbd5e1" stroke-width="1" />
              <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" text-anchor="middle" fill="#475569">${escapeHtml(item.name)}</text>
            `;
          })
          .join("");

        const dataPoints = data
          .map((item, idx) => {
            const angle = (Math.PI * 2 * idx) / data.length - Math.PI / 2;
            const value = Number(item.sessions || 0) / maxValue;
            const x = cx + Math.cos(angle) * radius * value;
            const y = cy + Math.sin(angle) * radius * value;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");

        root.innerHTML = `
          <svg viewBox="0 0 ${width} ${height}" width="100%" height="300" role="img" aria-label="Gráfico de teia por grupos musculares">
            ${gridPolygons.join("")}
            ${axes}
            <polygon points="${dataPoints}" fill="rgba(2, 77, 58, 0.22)" stroke="#024d3a" stroke-width="2" />
          </svg>
        `;
      }

      function renderStudentOverUnderList(listId, rows, isOver) {
        const list = document.getElementById(listId);
        if (!list) return;

        if (!rows || rows.length === 0) {
          list.innerHTML =
            '<li><span style="color:#6b7280;">Sem registros suficientes.</span></li>';
          return;
        }

        list.innerHTML = rows
          .map((item) => {
            const sign = isOver ? "+" : "-";
            return `
              <li>
                <span>${escapeHtml(item.exercise_name || "Exercício")}</span>
                <span style="white-space:nowrap;color:${isOver ? "#065f46" : "#b91c1c"};font-weight:700;">
                  ${sign}${Number(item.avg_diff_kg || 0).toFixed(2)}kg
                </span>
              </li>
            `;
          })
          .join("");
      }

      function renderStudentWeightTimeline(weightTimeline) {
        const root = document.getElementById("studentWeightTimeline");
        if (!root) return;

        if (!weightTimeline || weightTimeline.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Sem histórico de peso para o período.</p>';
          return;
        }

        const points = weightTimeline
          .map((item) => ({
            date: String(item.date || "").slice(0, 10),
            weight: Number(item.weight_kg || 0),
          }))
          .filter((item) => item.date && Number.isFinite(item.weight) && item.weight > 0)
          .sort((a, b) => a.date.localeCompare(b.date));

        if (points.length === 0) {
          root.innerHTML =
            '<p style="color:#6b7280;">Sem histórico de peso para o período.</p>';
          return;
        }

        const width = 820;
        const height = 250;
        const padding = { top: 20, right: 20, bottom: 35, left: 40 };
        const minWeight = Math.min(...points.map((p) => p.weight));
        const maxWeight = Math.max(...points.map((p) => p.weight));
        const weightRange = Math.max(1, maxWeight - minWeight);
        const n = points.length;

        const toX = (index) => {
          if (n === 1) return (width - padding.left - padding.right) / 2 + padding.left;
          return (
            padding.left +
            (index / (n - 1)) * (width - padding.left - padding.right)
          );
        };

        const toY = (weight) => {
          const ratio = (weight - minWeight) / weightRange;
          return height - padding.bottom - ratio * (height - padding.top - padding.bottom);
        };

        const polyline = points
          .map((p, index) => `${toX(index).toFixed(1)},${toY(p.weight).toFixed(1)}`)
          .join(" ");

        const circles = points
          .map(
            (p, index) => `
              <circle cx="${toX(index).toFixed(1)}" cy="${toY(p.weight).toFixed(1)}" r="4" fill="#024d3a">
                <title>${new Date(p.date).toLocaleDateString("pt-BR")}: ${p.weight.toFixed(1)}kg</title>
              </circle>
            `,
          )
          .join("");

        const first = points[0];
        const last = points[points.length - 1];

        root.innerHTML = `
          <div style="margin-bottom:8px;color:#475569;font-size:13px;">
            ${escapeHtml(new Date(first.date).toLocaleDateString("pt-BR"))} (${first.weight.toFixed(1)}kg) &#8594; ${escapeHtml(new Date(last.date).toLocaleDateString("pt-BR"))} (${last.weight.toFixed(1)}kg)
          </div>
          <svg viewBox="0 0 ${width} ${height}" width="100%" height="260" role="img" aria-label="Gráfico temporal do peso do aluno">
            <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#cbd5e1" />
            <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#cbd5e1" />
            <polyline points="${polyline}" fill="none" stroke="#024d3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            ${circles}
            <text x="${padding.left}" y="${height - 10}" font-size="11" fill="#64748b">${escapeHtml(new Date(first.date).toLocaleDateString("pt-BR"))}</text>
            <text x="${width - padding.right}" y="${height - 10}" font-size="11" text-anchor="end" fill="#64748b">${escapeHtml(new Date(last.date).toLocaleDateString("pt-BR"))}</text>
          </svg>
        `;
      }

      async function carregarAdminPersonals() {
        if (!isAdminSession || !adminToken) return;

        const container = document.getElementById("adminPersonalsBody");
        if (!container) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const personals = await response.json();
          adminPersonalsCache = Array.isArray(personals) ? personals : [];

          if (!adminPersonalsCache || adminPersonalsCache.length === 0) {
            container.innerHTML =
              '<div style="text-align:center;color:#6b7280;padding:20px;">Nenhum personal cadastrado</div>';
            return;
          }

          container.innerHTML = adminPersonalsCache
            .map((p) => {
              const createdAt = p.created_at
                ? new Date(p.created_at).toLocaleDateString("pt-BR")
                : "-";
              const phone = p.phone ? escapeHtml(p.phone) : "Sem WhatsApp";
              return `
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 14px;
                    padding: 14px;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    margin-bottom: 10px;
                    background: #ffffff;
                    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
                  "
                >
                  <div style="min-width: 0; display: flex; flex-direction: column; gap: 4px">
                    <div style="font-weight: 700; color: #111827; line-height: 1.2">
                      ${escapeHtml(p.name || "")}
                    </div>
                    <div style="color: #475569; font-size: 14px; line-height: 1.2">
                      ${phone}
                    </div>
                    <div style="color: #94a3b8; font-size: 12px; line-height: 1.2">
                      Criado em ${escapeHtml(createdAt)}
                    </div>
                  </div>

                  <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                    <button class="btn btn-secondary" style="white-space:nowrap;" onclick="editarPersonalAdmin('${p.id}')">Editar</button>
                    <button class="btn" style="background:#dbeafe;color:#0369a1;white-space:nowrap;" onclick="abrirAlunosPersonalAdmin('${p.id}', '${escapeHtml(p.name || "")}')">Ver alunos</button>
                    <button class="btn" style="background:#fee2e2;color:#dc2626;white-space:nowrap;" onclick="excluirPersonalAdmin('${p.id}', '${escapeHtml(p.name || "")}')">Excluir</button>
                  </div>
                </div>
              `;
            })
            .join("");
        } catch (error) {
          console.error("Erro ao carregar personals do admin:", error);
          container.innerHTML =
            '<div style="text-align:center;color:#ef4444;padding:20px;">Erro ao carregar personals</div>';
        }
      }

      async function criarPersonalAdmin() {
        if (!adminToken) return;

        const name = document.getElementById("adminPersonalNome").value.trim();
        const email = document
          .getElementById("adminPersonalEmail")
          .value.trim()
          .toLowerCase();
        const phone = document
          .getElementById("adminPersonalWhatsapp")
          .value.trim();
        const password = document.getElementById("adminPersonalSenha").value;

        if (!name || !email || !password) {
          showAlert("adminAlert", "Preencha nome, email e senha", "error");
          return;
        }

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify({
                name,
                email,
                password,
                ...(phone ? { phone } : {}),
              }),
            },
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Erro ao cadastrar personal");
          }

          showAlert("adminAlert", "Personal cadastrado com sucesso", "success");
          document.getElementById("adminPersonalNome").value = "";
          document.getElementById("adminPersonalEmail").value = "";
          document.getElementById("adminPersonalWhatsapp").value = "";
          document.getElementById("adminPersonalSenha").value = "";
          await carregarAdminPersonals();
        } catch (error) {
          showAlert(
            "adminAlert",
            error.message || "Erro ao cadastrar personal",
            "error",
          );
        }
      }

      function editarPersonalAdmin(personalId) {
        const personal = adminPersonalsCache.find((item) => item.id === personalId);

        if (!personal) {
          showAlert(
            "adminAlert",
            "Não foi possível abrir o formulário de edição do personal.",
            "error",
          );
          return;
        }

        adminPersonalEditAtualId = personalId;
        document.getElementById("adminEditPersonalNome").value = personal.name || "";
        document.getElementById("adminEditPersonalEmail").value = personal.email || "";
        document.getElementById("adminEditPersonalWhatsapp").value = personal.phone || "";
        document.getElementById("adminEditPersonalInstance").value =
          personal.evolution_instance_name || "";
        document.getElementById("adminEditPersonalSenha").value = "";
        document.getElementById("adminPersonalEditAlert").innerHTML = "";

        document.getElementById("adminPersonalEditModal").classList.add("open");
      }

      function closeAdminPersonalEditModal(event) {
        if (event && event.target?.id !== "adminPersonalEditModal") return;
        adminPersonalEditAtualId = null;
        document
          .getElementById("adminPersonalEditModal")
          .classList.remove("open");
      }

      async function salvarPersonalAdmin() {
        if (!adminToken) return;
        if (!adminPersonalEditAtualId) return;

        const name = document.getElementById("adminEditPersonalNome").value.trim();
        const email = document
          .getElementById("adminEditPersonalEmail")
          .value.trim()
          .toLowerCase();
        const phone = document
          .getElementById("adminEditPersonalWhatsapp")
          .value.trim();
        const evolutionInstance = document
          .getElementById("adminEditPersonalInstance")
          .value.trim();
        const password = document.getElementById("adminEditPersonalSenha").value;

        if (!name || !email) {
          showAlert(
            "adminPersonalEditAlert",
            "Nome e email são obrigatórios.",
            "error",
          );
          return;
        }

        const payload = {
          name,
          email,
          phone,
          ...(evolutionInstance
            ? { evolution_instance_name: evolutionInstance }
            : {}),
        };

        if (password) {
          payload.password = password;
        }

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals/${adminPersonalEditAtualId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify(payload),
            },
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Erro ao atualizar personal");
          }

          closeAdminPersonalEditModal();
          showAlert("adminAlert", "Personal atualizado com sucesso", "success");
          await carregarAdminPersonals();
        } catch (error) {
          showAlert(
            "adminPersonalEditAlert",
            error.message || "Erro ao atualizar personal",
            "error",
          );
        }
      }

      async function excluirPersonalAdmin(personalId, personalName) {
        if (!adminToken) return;

        const confirmado = await showConfirm(
          `Deseja realmente excluir o personal "${personalName}"? Esta ação não pode ser desfeita.`,
          { title: "Excluir personal", confirmLabel: "Excluir", variant: "danger" }
        );
        if (!confirmado) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals/${personalId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || `HTTP ${response.status}`);
          }

          showAlert(
            "adminAlert",
            `Personal "${personalName}" excluído com sucesso`,
            "success",
          );
          await carregarAdminPersonals();
        } catch (error) {
          showAlert(
            "adminAlert",
            error.message || "Erro ao excluir personal",
            "error",
          );
        }
      }

      let adminAlunosPersonalId = null;
      let adminAlunosPersonalName = null;
      let adminAlunosCache = [];
      let adminAlunoEditAtualId = null;

      function normalizeAdminWhatsappWith55(rawValue) {
        const digitsOnly = String(rawValue || "").replace(/\D+/g, "");
        if (!digitsOnly) return "";

        let normalized = digitsOnly;

        while (normalized.startsWith("00")) {
          normalized = normalized.slice(2);
        }

        if (normalized.startsWith("0")) {
          normalized = normalized.replace(/^0+/, "");
        }

        if (normalized.startsWith("55")) {
          return normalized;
        }

        if (normalized.length === 10 || normalized.length === 11) {
          return `55${normalized}`;
        }

        return normalized;
      }

      async function abrirAlunosPersonalAdmin(personalId, personalName) {
        if (!adminToken) return;

        adminAlunosPersonalId = personalId;
        adminAlunosPersonalName = personalName;

        document.getElementById("adminAlunosPersonalName").textContent = personalName;
        const drawer = document.getElementById("adminAlunosDrawer");
        if (drawer) drawer.classList.add("open");

        await carregarAlunosPersonalAdmin();
      }

      function closeAdminAlunosDrawer(event) {
        if (event && event.target.id !== "adminAlunosDrawer") return;
        const drawer = document.getElementById("adminAlunosDrawer");
        if (drawer) drawer.classList.remove("open");
        adminAlunosPersonalId = null;
        adminAlunosCache = [];
      }

      async function carregarAlunosPersonalAdmin() {
        if (!adminToken || !adminAlunosPersonalId) return;

        const tbody = document.getElementById("adminAlunosTable");
        if (!tbody) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals/${adminAlunosPersonalId}/students`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const alunos = await response.json();
          adminAlunosCache = Array.isArray(alunos) ? alunos : [];

          if (!alunos || alunos.length === 0) {
            tbody.innerHTML =
              '<div style="text-align:center;color:#6b7280;padding:20px;">Nenhum aluno cadastrado</div>';
            return;
          }

          tbody.innerHTML = `
            <div style="overflow-x: auto;">
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="background:#f3f4f6;border-bottom:1px solid #e5e7eb;">
                    <th style="padding:8px;text-align:left;font-weight:600;">Nome</th>
                    <th style="padding:8px;text-align:left;font-weight:600;">WhatsApp</th>
                    <th style="padding:8px;text-align:left;font-weight:600;">Email</th>
                    <th style="padding:8px;text-align:left;font-weight:600;">Status</th>
                    <th style="padding:8px;text-align:left;font-weight:600;">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${adminAlunosCache
                    .map(
                      (a) => `
                    <tr style="border-bottom:1px solid #e5e7eb;">
                      <td style="padding:8px;">${escapeHtml(a.name || "")}</td>
                      <td style="padding:8px;">${escapeHtml(a.whatsapp_number || "-")}</td>
                      <td style="padding:8px;">${escapeHtml(a.email || "-")}</td>
                      <td style="padding:8px;">
                        <span style="padding:4px 8px;background:${a.is_active ? "#dcfce7" : "#fecaca"};color:${a.is_active ? "#166534" : "#991b1b"};border-radius:4px;font-size:12px;">
                          ${a.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td style="padding:8px;">
                        <div style="display:flex;gap:6px;">
                          <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" onclick="editarAlunoAdmin('${a.id}')">Editar</button>
                          <button class="btn" style="padding:4px 8px;font-size:12px;background:#fee2e2;color:#dc2626;" onclick="deletarAlunoAdmin('${a.id}', '${escapeHtml(a.name || "")}')">Deletar</button>
                        </div>
                      </td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `;
        } catch (error) {
          console.error("Erro ao carregar alunos do admin:", error);
          tbody.innerHTML =
            '<div style="text-align:center;color:#ef4444;padding:20px;">Erro ao carregar alunos</div>';
        }
      }

      function criarNovoAlunoAdmin() {
        const nome = prompt("Nome do aluno:");
        if (!nome) return;

        const whatsapp = prompt("WhatsApp (ex: 5511999999999):");
        if (!whatsapp) return;

        salvarNovoAlunoAdmin(nome, whatsapp);
      }

      async function salvarNovoAlunoAdmin(nome, whatsapp) {
        if (!adminToken || !adminAlunosPersonalId) return;

        const normalizedWhatsapp = normalizeAdminWhatsappWith55(whatsapp);
        if (!normalizedWhatsapp || !normalizedWhatsapp.startsWith("55")) {
          showAlert(
            "adminAlunosAlert",
            "WhatsApp inválido. Informe com DDD; o sistema adiciona 55 automaticamente quando necessário.",
            "error",
          );
          return;
        }

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals/${adminAlunosPersonalId}/students`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify({
                name: nome,
                whatsapp_number: normalizedWhatsapp,
              }),
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao criar aluno");
          }

          showAlert("adminAlunosAlert", "Aluno criado com sucesso", "success");
          await carregarAlunosPersonalAdmin();
        } catch (error) {
          showAlert(
            "adminAlunosAlert",
            error.message || "Erro ao criar aluno",
            "error",
          );
        }
      }

      function editarAlunoAdmin(alunoId) {
        const aluno = adminAlunosCache.find((item) => item.id === alunoId);
        if (!aluno) {
          showAlert("adminAlunosAlert", "Aluno não encontrado para edição", "error");
          return;
        }

        adminAlunoEditAtualId = alunoId;
        document.getElementById("adminAlunoEditAlert").innerHTML = "";
        document.getElementById("adminEditAlunoNome").value = aluno.name || "";
        document.getElementById("adminEditAlunoWhatsapp").value =
          aluno.whatsapp_number || "";
        document.getElementById("adminEditAlunoEmail").value = aluno.email || "";
        document.getElementById("adminEditAlunoTipoSanguineo").value =
          aluno.blood_type || "";
        document.getElementById("adminEditAlunoPeso").value =
          aluno.weight_kg ?? "";
        document.getElementById("adminEditAlunoAltura").value =
          aluno.height_cm ?? "";
        document.getElementById("adminEditAlunoStatus").value =
          String(Boolean(aluno.is_active));

        document.getElementById("adminAlunoEditModal").classList.add("open");
      }

      function closeAdminAlunoEditModal(event) {
        if (event && event.target?.id !== "adminAlunoEditModal") return;
        adminAlunoEditAtualId = null;
        document.getElementById("adminAlunoEditModal").classList.remove("open");
      }

      async function salvarAlunoAdminEdicao() {
        if (!adminToken || !adminAlunoEditAtualId) return;

        const name = document.getElementById("adminEditAlunoNome").value.trim();
        const whatsappInput =
          document.getElementById("adminEditAlunoWhatsapp").value.trim();
        const email = document.getElementById("adminEditAlunoEmail").value.trim();
        const bloodType = document.getElementById(
          "adminEditAlunoTipoSanguineo",
        ).value;
        const weightValue = document.getElementById("adminEditAlunoPeso").value;
        const heightValue =
          document.getElementById("adminEditAlunoAltura").value;
        const isActiveValue =
          document.getElementById("adminEditAlunoStatus").value === "true";

        if (!name) {
          showAlert("adminAlunoEditAlert", "Nome é obrigatório", "error");
          return;
        }

        const normalizedWhatsapp = normalizeAdminWhatsappWith55(whatsappInput);
        if (!normalizedWhatsapp || !normalizedWhatsapp.startsWith("55")) {
          showAlert(
            "adminAlunoEditAlert",
            "WhatsApp inválido. Informe com DDD; o sistema adiciona 55 automaticamente quando necessário.",
            "error",
          );
          return;
        }

        const patch = {
          name,
          whatsapp_number: normalizedWhatsapp,
          blood_type: bloodType || "",
          weight_kg: weightValue === "" ? null : Number(weightValue),
          height_cm: heightValue === "" ? null : Number(heightValue),
          is_active: isActiveValue,
          ...(email ? { email } : {}),
        };

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/students/${adminAlunoEditAtualId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify(patch),
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao atualizar aluno");
          }

          closeAdminAlunoEditModal();
          showAlert("adminAlunosAlert", "Aluno atualizado com sucesso", "success");
          await carregarAlunosPersonalAdmin();
        } catch (error) {
          showAlert(
            "adminAlunoEditAlert",
            error.message || "Erro ao atualizar aluno",
            "error",
          );
        }
      }

      async function deletarAlunoAdmin(alunoId, alunoName) {
        if (!adminToken) return;

        const confirmado = await showConfirm(
          `Deseja realmente excluir o aluno "${alunoName}"? Esta ação não pode ser desfeita.`,
          { title: "Excluir aluno", confirmLabel: "Excluir", variant: "danger" }
        );
        if (!confirmado) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/students/${alunoId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || `HTTP ${response.status}`);
          }

          showAlert(
            "adminAlunosAlert",
            `Aluno "${alunoName}" deletado com sucesso`,
            "success",
          );
          await carregarAlunosPersonalAdmin();
        } catch (error) {
          showAlert(
            "adminAlunosAlert",
            error.message || "Erro ao deletar aluno",
            "error",
          );
        }
      }

      function generateAdminEmbedCode() {
        const sourceInput = document.getElementById("adminEmbedSource");
        const codeArea = document.getElementById("adminEmbedCode");
        const hostEl = document.getElementById("adminEmbedHost");
        const recoveryInput = document.getElementById(
          "adminRecoveryRedirectUrl",
        );
        if (!sourceInput || !codeArea || !hostEl || !recoveryInput) return;

        const source = (sourceInput.value || "landing-principal")
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .toLowerCase();
        if (!recoveryInput.value.trim()) {
          recoveryInput.value = `${window.location.origin}/?password-reset=1`;
        }
        const recoveryRedirect = (recoveryInput.value || "").trim();

        const base = getApiBaseUrl();
        hostEl.textContent = `${base}/embed/personal-signup.html`;

        const recoveryAttr = recoveryRedirect
          ? ` data-recovery-redirect="${recoveryRedirect.replace(/"/g, "&quot;")}"`
          : "";

        const embedCode = `<script src="${base}/embed/personal-signup-embed.js" data-source="${source}"${recoveryAttr}><\\/script>`;
        codeArea.value = embedCode;
      }

      async function copyAdminEmbedCode() {
        const codeArea = document.getElementById("adminEmbedCode");
        if (!codeArea || !codeArea.value) {
          showAlert(
            "adminSettingsAlert",
            "Gere o código antes de copiar.",
            "error",
          );
          return;
        }

        try {
          await navigator.clipboard.writeText(codeArea.value);
          showAlert(
            "adminSettingsAlert",
            "Código copiado para a área de transferência.",
            "success",
          );
        } catch (error) {
          codeArea.select();
          document.execCommand("copy");
          showAlert(
            "adminSettingsAlert",
            "Código copiado com fallback do navegador.",
            "success",
          );
        }
      }

      async function carregarRelatorioOrigensAdmin() {
        if (!adminToken) return;

        const daysInput = document.getElementById("adminReportDays");
        const tbody = document.getElementById("adminSourceReportBody");
        const totalEl = document.getElementById("adminSourceTotalSignups");
        if (!daysInput || !tbody || !totalEl) return;

        const days = Number(daysInput.value || 30);
        tbody.innerHTML =
          '<tr><td colspan="2" style="text-align:center">Carregando...</td></tr>';

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/personals/source-report?days=${encodeURIComponent(days)}`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.message || "Erro ao carregar relatório");
          }

          totalEl.textContent = String(data.total_signups ?? 0);

          const sources = Array.isArray(data.sources) ? data.sources : [];
          if (sources.length === 0) {
            tbody.innerHTML =
              '<tr><td colspan="2" style="text-align:center;color:#6b7280;">Sem cadastros no período</td></tr>';
            return;
          }

          tbody.innerHTML = sources
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.source || "sem-origem")}</td>
                  <td>${escapeHtml(String(row.count || 0))}</td>
                </tr>
              `,
            )
            .join("");
        } catch (error) {
          totalEl.textContent = "-";
          tbody.innerHTML =
            '<tr><td colspan="2" style="text-align:center;color:#ef4444;">Erro ao carregar relatório</td></tr>';
          showAlert(
            "adminSourceReportAlert",
            error.message || "Erro ao carregar relatório",
            "error",
          );
        }
      }

      async function verificarStatusWhatsAppAdmin() {
        if (!isAdminSession || !adminToken) return;

        const statusEl = document.getElementById("adminWhatsappStatus");
        if (!statusEl) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/whatsapp/connection/status`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.message || "Erro ao consultar status");
          }

          const isConnected = data.state === "open";
          const statusClass = isConnected ? "connected" : "disconnected";
          const statusText = isConnected ? "Conectado" : "Desconectado";
          const statusIcon = isConnected ? "&#9989;" : "&#10060;";
          statusEl.innerHTML = `<span class="status-badge status-${statusClass}">${statusIcon} ${statusText}</span>`;
        } catch (error) {
          statusEl.innerHTML =
            '<span class="status-badge status-disconnected">&#9888; Erro ao verificar</span>';
        }
      }

      async function gerarQRCodeAdmin() {
        if (!isAdminSession || !adminToken) return;

        const container = document.getElementById("adminQrCodeContainer");
        if (!container) return;

        try {
          const statusResp = await fetch(
            `${getApiBaseUrl()}/api/admin/whatsapp/connection/status`,
            {
              headers: { Authorization: `Bearer ${adminToken}` },
            },
          );
          const statusData = await statusResp.json().catch(() => ({}));

          if (statusResp.status === 401) {
            handleUnauthorized();
            return;
          }

          if (statusResp.ok && statusData.state === "open") {
            container.classList.remove("hidden");
            container.innerHTML = `
              <div style="padding: 20px; background: rgba(115, 213, 55, 0.2); border-radius: 8px; margin-top: 12px;">
                <h3 style="color: #024d3a; margin-bottom: 10px;">&#9989; WhatsApp já conectado</h3>
                <p style="color: #047857;">A instância unificada já está pronta para uso.</p>
              </div>
            `;
            return;
          }

          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/whatsapp/connection/qrcode`,
            {
              headers: { Authorization: `Bearer ${adminToken}` },
            },
          );
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.message || "Erro ao gerar QR Code");
          }

          container.classList.remove("hidden");

          const qrImage =
            normalizeQrImageData(data.base64) ||
            normalizeQrImageData(data.qrcode) ||
            normalizeQrImageData(data.code);

          if (qrImage) {
            container.innerHTML = `
              <div style="margin-top: 16px;">
                <h3>Escaneie o QR Code com o WhatsApp oficial do bot</h3>
                <img src="${qrImage}" alt="QR Code" />
                <p style="color: #6b7280;">Abra o WhatsApp > Aparelhos conectados > Conectar aparelho.</p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 8px;">O QR Code expira em poucos segundos.</p>
              </div>
            `;
          } else if (data.pairingCode || data.code) {
            const pairingCode = data.pairingCode || data.code;
            container.innerHTML = `
              <div style="padding: 20px; background: #eff6ff; border-radius: 8px; margin-top: 12px;">
                <h3 style="color: #1e40af; margin-bottom: 10px;">Use o código de pareamento</h3>
                <p style="color: #1e3a8a; font-size: 28px; letter-spacing: 2px; font-weight: 700; margin: 8px 0;">${pairingCode}</p>
                <p style="color: #1e40af;">No WhatsApp, vá em Aparelhos conectados e informe este código.</p>
              </div>
            `;
          } else {
            container.innerHTML =
              '<p style="color: #ef4444;">Não foi possível renderizar o QR Code. Tente novamente.</p>';
          }

          setTimeout(() => verificarStatusWhatsAppAdmin(), 3000);
        } catch (error) {
          container.classList.remove("hidden");
          container.innerHTML =
            '<p style="color: #ef4444;">Erro ao conectar com a Evolution API. Verifique a configuração.</p>';
        }
      }

      async function desconectarWhatsAppAdmin() {
        if (!isAdminSession || !adminToken) return;

        const ok = await showConfirm("Deseja desconectar o WhatsApp unificado? O bot ficará offline até uma nova conexão.", {
          title: "Desconectar WhatsApp",
          confirmLabel: "Desconectar",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/admin/whatsapp/connection/logout`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
            },
          );

          const data = await response.json().catch(() => ({}));

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(data.message || "Erro ao desconectar WhatsApp");
          }

          const container = document.getElementById("adminQrCodeContainer");
          if (container) {
            container.classList.add("hidden");
            container.innerHTML = "";
          }

          showToast("WhatsApp desconectado com sucesso.", "success");
          verificarStatusWhatsAppAdmin();
        } catch (error) {
          showToast(error.message || "Erro ao desconectar WhatsApp.", "error");
        }
      }

      function limparFormularioExercicio() {
        const catalogo = document.getElementById("novoCatalogoNome");
        const variacao = document.getElementById("novaVariacaoNome");
        const equipamento = document.getElementById("novoEquipamentoNome");
        const pegadaPisada = document.getElementById("novaPegadaPisadaNome");
        const metodo = document.getElementById("novoMetodoNome");
        const grupoMuscular = document.getElementById("novoGrupoMuscularNome");
        if (catalogo) catalogo.value = "";
        if (variacao) variacao.value = "";
        if (equipamento) equipamento.value = "";
        if (pegadaPisada) pegadaPisada.value = "";
        if (metodo) metodo.value = "";
        if (grupoMuscular) grupoMuscular.value = "";
        document.getElementById("exerciciosAlert").innerHTML = "";
        exerciciosSimilaresCache = [];
      }

      let catalogoBuscaAtual = "";
      let variacaoBuscaAtual = "";
      let equipamentoBuscaAtual = "";
      let pegadaPisadaBuscaAtual = "";
      let metodoBuscaAtual = "";
      let grupoMuscularBuscaAtual = "";

      let muscleGroupsSelectCache = null;

      async function obterGruposMuscularesParaSelect(forceReload) {
        if (muscleGroupsSelectCache && !forceReload) return muscleGroupsSelectCache;
        try {
          const response = await fetch(`${getApiBaseUrl()}/api/muscle-groups?limit=1000`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (!response.ok) return muscleGroupsSelectCache || [];
          muscleGroupsSelectCache = (await response.json()) || [];
          return muscleGroupsSelectCache;
        } catch (e) {
          return muscleGroupsSelectCache || [];
        }
      }

      async function preencherSelectNovoCatalogoGrupoMuscular() {
        const select = document.getElementById("novoCatalogoGrupoMuscular");
        if (!select) return;
        const grupos = await obterGruposMuscularesParaSelect();
        select.innerHTML =
          '<option value="">Sem grupo</option>' +
          grupos.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
      }

      async function criarCatalogoExercicio() {
        const nome = document.getElementById("novoCatalogoNome")?.value?.trim();
        if (!nome) {
          showToast("Informe o nome do exercício.", "warn");
          return;
        }
        const muscleGroupId = document.getElementById("novoCatalogoGrupoMuscular")?.value || null;
        const videoUrl      = document.getElementById("novoCatalogoVideo")?.value?.trim() || null;

        // Monta o campo notes a partir de execução + pegada selecionadas
        const variacaoNome = document.getElementById("novoCatalogoVariacao")?.selectedOptions?.[0]?.text || "";
        const pegadaNome   = document.getElementById("novoCatalogoPegada")?.selectedOptions?.[0]?.text || "";
        const parts = [variacaoNome, pegadaNome ? `pegada ${pegadaNome}` : ""]
          .filter(s => s && s !== "Sem execução" && s !== "pegada Sem pegada");
        const notes = parts.length ? parts.join(" · ") : null;

        const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ name: nome, muscle_group_id: muscleGroupId, notes, video_url: videoUrl }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showToast(err.message || "Erro ao cadastrar exercício.", "error");
          return;
        }

        document.getElementById("novoCatalogoNome").value = "";
        const groupSelect = document.getElementById("novoCatalogoGrupoMuscular");
        if (groupSelect) groupSelect.value = "";
        ["novoCatalogoEquipamento","novoCatalogoVariacao","novoCatalogoPegada","novoCatalogoMetodo","novoCatalogoVideo"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        showToast("Exercício cadastrado com sucesso.", "success");
        await carregarCatalogoExercicios();
      }

      async function criarGrupoMuscular() {
        const nome = document.getElementById("novoGrupoMuscularNome")?.value?.trim();
        if (!nome) {
          showAlert("exerciciosAlert", "Informe o nome do grupo muscular.", "error");
          return;
        }

        const response = await fetch(`${getApiBaseUrl()}/api/muscle-groups`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: nome }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao cadastrar grupo muscular.", "error");
          return;
        }

        document.getElementById("novoGrupoMuscularNome").value = "";
        muscleGroupsSelectCache = null;
        showAlert("exerciciosAlert", "Grupo muscular cadastrado com sucesso.", "success");
        await carregarGruposMuscularesExercicios();
        await preencherSelectNovoCatalogoGrupoMuscular();
        await _renderizarPillsGrupoExercicio();
      }

      function abrirImportacaoXlsCatalogo() {
        const input = document.getElementById("catalogoImportXlsInput");
        if (!input) return;
        input.value = "";
        input.click();
      }

      async function baixarModeloXlsCatalogo() {
        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/exercise-catalog/import-template`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401 || response.status === 403) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.message || "Erro ao baixar modelo XLS");
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "modelo-importacao-exercicios.xlsx";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        } catch (error) {
          showAlert(
            "exerciciosAlert",
            error?.message || "Erro ao baixar modelo XLS",
            "error",
          );
        }
      }

      async function importarCatalogoExerciciosXls(event) {
        const file = event?.target?.files?.[0];
        if (!file) return;

        const fileName = String(file.name || "").toLowerCase();
        if (!fileName.endsWith(".xls") && !fileName.endsWith(".xlsx")) {
          showAlert("exerciciosAlert", "Selecione um arquivo .xls ou .xlsx", "error");
          return;
        }

        const resetExisting = Boolean(
          document.getElementById("importCatalogoResetCheckbox")?.checked,
        );

        try {
          showAlert("exerciciosAlert", "Importando planilha de exercícios...", "success");

          const fileBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
            reader.readAsDataURL(file);
          });

          const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog/import-xls`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              filename: file.name,
              file_base64: String(fileBase64 || ""),
              reset_existing: resetExisting,
            }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao importar exercícios");
          }

          showAlert(
            "exerciciosAlert",
            `Importação concluída. ${payload.imported_count || 0} novos exercício(s), ${payload.skipped_existing_count || 0} já existentes.`,
            "success",
          );

          await carregarCatalogoExercicios();
          await carregarVariacoesExercicios();
        } catch (error) {
          showAlert(
            "exerciciosAlert",
            error?.message || "Erro ao importar planilha",
            "error",
          );
        }
      }

      async function resetarBaseExercicios() {
        const ok = await showConfirm("Deseja realmente zerar toda a base de exercícios e execuções? Esta ação não pode ser desfeita.", {
          title: "Zerar base de exercícios",
          confirmLabel: "Zerar tudo",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog/reset-base`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ confirm: true }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.message || "Erro ao resetar base de exercícios");
          }

          showAlert("exerciciosAlert", "Base de exercícios zerada com sucesso.", "success");
          await carregarCatalogoExercicios();
          await carregarVariacoesExercicios();
        } catch (error) {
          showAlert(
            "exerciciosAlert",
            error?.message || "Erro ao resetar base de exercícios",
            "error",
          );
        }
      }

      async function criarVariacaoExercicio() {
        const nome = document.getElementById("novaVariacaoNome")?.value?.trim();
        if (!nome) {
          showAlert("exerciciosAlert", "Informe o nome da execução.", "error");
          return;
        }

        const response = await fetch(`${getApiBaseUrl()}/api/exercise-variations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: nome }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao cadastrar execução.", "error");
          return;
        }

        document.getElementById("novaVariacaoNome").value = "";
        showAlert("exerciciosAlert", "Execução cadastrada com sucesso.", "success");
        await carregarVariacoesExercicios();
      }

      async function criarPegadaPisadaCatalogo() {
        const nome = document.getElementById("novaPegadaPisadaNome")?.value?.trim();
        if (!nome) {
          showAlert("exerciciosAlert", "Informe o nome da pegada/pisada.", "error");
          return;
        }

        const response = await fetch(`${getApiBaseUrl()}/api/grip-footing-catalog`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: nome }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao cadastrar pegada/pisada.", "error");
          return;
        }

        document.getElementById("novaPegadaPisadaNome").value = "";
        showAlert("exerciciosAlert", "Pegada/Pisada cadastrada com sucesso.", "success");
        await carregarPegadasPisadasExercicios();
      }

      async function criarMetodoCatalogo() {
        const nome = document.getElementById("novoMetodoNome")?.value?.trim();
        if (!nome) {
          showAlert("exerciciosAlert", "Informe o nome do método.", "error");
          return;
        }

        const response = await fetch(`${getApiBaseUrl()}/api/method-catalog`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: nome }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao cadastrar método.", "error");
          return;
        }

        document.getElementById("novoMetodoNome").value = "";
        showAlert("exerciciosAlert", "Método cadastrado com sucesso.", "success");
        await carregarMetodosExercicios();
      }

      async function criarEquipamentoCatalogo() {
        const nome = document.getElementById("novoEquipamentoNome")?.value?.trim();
        if (!nome) {
          showAlert("exerciciosAlert", "Informe o nome do equipamento.", "error");
          return;
        }

        const response = await fetch(`${getApiBaseUrl()}/api/equipment-catalog`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ name: nome }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao cadastrar equipamento.", "error");
          return;
        }

        document.getElementById("novoEquipamentoNome").value = "";
        showAlert("exerciciosAlert", "Equipamento cadastrado com sucesso.", "success");
        await carregarEquipamentosExercicios();
      }

      // Filtro de grupo muscular ativo na biblioteca
      let _exercicioGrupoFiltroAtivo = "";

      async function carregarCatalogoExercicios() {
        try {
          const params = new URLSearchParams();
          if (catalogoBuscaAtual) params.set("search", catalogoBuscaAtual);
          if (_exercicioGrupoFiltroAtivo) params.set("muscle_group_id", _exercicioGrupoFiltroAtivo);
          params.set("limit", "200");

          const response = await fetch(
            `${getApiBaseUrl()}/api/exercise-catalog?${params.toString()}`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );

          if (response.status === 401) { handleUnauthorized(); return; }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const exercicios = (await response.json()) || [];
          const body = document.getElementById("exerciseCatalogBody");
          if (!body) return;

          if (!exercicios.length) {
            body.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:32px;">Nenhum exercício encontrado.</div>`;
            return;
          }

          // Paleta de cores para badges de grupo muscular
          const groupColors = [
            { bg: "rgba(34,197,94,0.12)", color: "#15803d" },
            { bg: "rgba(59,130,246,0.12)", color: "#1d4ed8" },
            { bg: "rgba(168,85,247,0.12)", color: "#7e22ce" },
            { bg: "rgba(245,158,11,0.12)", color: "#92400e" },
            { bg: "rgba(239,68,68,0.1)",  color: "#b91c1c" },
            { bg: "rgba(20,184,166,0.12)", color: "#0f766e" },
          ];
          const groupColorMap = {};
          let colorIdx = 0;
          const getGroupColor = (name) => {
            if (!name) return groupColors[0];
            if (!groupColorMap[name]) { groupColorMap[name] = groupColors[colorIdx++ % groupColors.length]; }
            return groupColorMap[name];
          };

          body.innerHTML = exercicios.map(e => {
            const safeId      = escapeHtml(e.id);
            const safeName    = escapeHtml(e.name || "Exercício");
            const safeNameStr = String(e.name || "").replace(/'/g, "\\'");
            const groupName   = e.muscle_group_name || null;
            const col         = getGroupColor(groupName);
            const groupBadge  = groupName
              ? `<span class="exercicio-card-tag" style="background:${col.bg};color:${col.color};">${escapeHtml(groupName)}</span>`
              : "";
            const metaText   = e.notes     ? escapeHtml(e.notes)     : "";
            const safeVideo  = escapeHtml(e.video_url || "");
            return `
              <div class="exercicio-card" onclick="abrirEditarExercicio('${safeId}','${safeName.replace(/'/g, "\\'")}','${escapeHtml(groupName || "")}','${escapeHtml(e.muscle_group_id || "")}','${escapeHtml(e.notes || "")}','${safeVideo}')">
                <div class="exercicio-card-header">
                  <span class="exercicio-card-name">${safeName}</span>
                  <span class="exercicio-card-arrow">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
                </div>
                <div class="exercicio-card-tags">${groupBadge}</div>
                ${metaText ? `<span class="exercicio-card-meta">${metaText}</span>` : ""}
                <div class="exercicio-card-actions">
                  <button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;"
                    onclick="event.stopPropagation();abrirEditarExercicio('${safeId}','${safeName.replace(/'/g, "\\'")}','${escapeHtml(groupName || "")}','${escapeHtml(e.muscle_group_id || "")}','${escapeHtml(e.notes || "")}','${safeVideo}')">Editar</button>
                  <button class="btn btn-danger" style="padding:5px 10px;font-size:12px;"
                    onclick="event.stopPropagation();excluirCatalogoExercicio('${safeId}','${safeNameStr}')">Excluir</button>
                </div>
              </div>`;
          }).join("");
        } catch (error) {
          const body = document.getElementById("exerciseCatalogBody");
          if (body) body.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#ef4444;padding:32px;">Erro ao carregar exercícios.</div>`;
        }
      }

      function filtrarCatalogoPorGrupo(groupId, btnEl) {
        _exercicioGrupoFiltroAtivo = groupId || "";
        document.querySelectorAll(".exercicio-grupo-pill").forEach(b => b.classList.remove("active"));
        if (btnEl) btnEl.classList.add("active");
        carregarCatalogoExercicios();
      }

      async function salvarGrupoMuscularRapido(exercicioId) {
        // Redireciona para o novo modal de edição completo
        // (o exercício precisa ter seus dados buscados)
        const body = document.getElementById("exerciseCatalogBody");
        const card = body?.querySelector(`[onclick*="${exercicioId}"]`);
        const nome = card?.querySelector(".exercicio-card-name")?.textContent || "";
        abrirEditarExercicio(exercicioId, nome, "", "", "");
      }

      // ── Modal de edição de exercício ────────────────────────────────────────────

      /**
       * Abre o popup de edição de exercício com os dados atuais pré-preenchidos.
       * @param {string} id - UUID do exercício
       * @param {string} nome - Nome (somente leitura)
       * @param {string} groupName - Nome do grupo muscular atual (para exibição)
       * @param {string} groupId - UUID do grupo muscular atual
       * @param {string} notes - Notas atuais
       */
      async function abrirEditarExercicio(id, nome, groupName, groupId, notes, videoUrl) {
        const modal = document.getElementById("exercicioEditModal");
        if (!modal) return;

        // Preencher campos de exibição
        document.getElementById("exercicioEditNome").textContent = nome || "—";
        document.getElementById("exercicioEditId").value = id;
        const videoEl = document.getElementById("exercicioEditVideo");
        if (videoEl) videoEl.value = videoUrl || "";

        // Limpar alerta anterior
        const alertEl = document.getElementById("exercicioEditAlert");
        if (alertEl) alertEl.innerHTML = "";

        // Popular selects em paralelo
        const [grupos, variac, pegada, equip, metodo] = await Promise.all([
          obterGruposMuscularesParaSelect(),
          fetch(`${getApiBaseUrl()}/api/exercise-variations?limit=200`,  { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/grip-footing-catalog?limit=200`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/equipment-catalog?limit=200`,    { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/method-catalog?limit=200`,       { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
        ]);

        const fillSel = (selId, items, placeholder, selectedId) => {
          const sel = document.getElementById(selId);
          if (!sel) return;
          sel.innerHTML = `<option value="">${placeholder}</option>` +
            items.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join("");
          if (selectedId) sel.value = selectedId;
        };

        fillSel("exercicioEditGrupo",      grupos, "Sem grupo",      groupId);
        fillSel("exercicioEditVariacao",   variac, "Sem execução",   "");
        fillSel("exercicioEditPegada",     pegada, "Sem pegada",     "");
        fillSel("exercicioEditEquipamento",equip,  "Sem equipamento","");
        fillSel("exercicioEditMetodo",     metodo, "Sem método",     "");

        // Tentar inferir execução/pegada a partir das notas (best-effort)
        if (notes) {
          const parts = notes.split("·").map(s => s.trim());
          if (parts[0]) {
            const variacaoMatch = variac.find(v => v.name.toLowerCase() === parts[0].toLowerCase());
            if (variacaoMatch) document.getElementById("exercicioEditVariacao").value = variacaoMatch.id;
          }
          if (parts[1]) {
            const pegadaText = parts[1].replace(/^pegada\s*/i, "").trim();
            const pegadaMatch = pegada.find(p => p.name.toLowerCase() === pegadaText.toLowerCase());
            if (pegadaMatch) document.getElementById("exercicioEditPegada").value = pegadaMatch.id;
          }
        }

        modal.classList.add("open");
        // Foco no primeiro select
        setTimeout(() => document.getElementById("exercicioEditGrupo")?.focus(), 60);
      }

      function fecharEditarExercicio(event) {
        if (event && event.target !== document.getElementById("exercicioEditModal")) return;
        document.getElementById("exercicioEditModal")?.classList.remove("open");
      }

      // Fechar com Escape
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
          const modal = document.getElementById("exercicioEditModal");
          if (modal?.classList.contains("open")) {
            modal.classList.remove("open");
          }
        }
      });

      async function salvarEdicaoExercicio() {
        const id       = document.getElementById("exercicioEditId")?.value;
        const groupId  = document.getElementById("exercicioEditGrupo")?.value || null;
        const videoUrl = document.getElementById("exercicioEditVideo")?.value?.trim() || null;
        const variacaoSel = document.getElementById("exercicioEditVariacao");
        const pegadaSel   = document.getElementById("exercicioEditPegada");

        if (!id) return;

        // Monta campo notes a partir de execução + pegada selecionadas
        const variacaoNome = variacaoSel?.selectedOptions?.[0]?.value ? variacaoSel.selectedOptions[0].text : "";
        const pegadaNome   = pegadaSel?.selectedOptions?.[0]?.value   ? pegadaSel.selectedOptions[0].text   : "";
        const noteParts    = [variacaoNome, pegadaNome ? `pegada ${pegadaNome}` : ""].filter(Boolean);
        const notesValue   = noteParts.length ? noteParts.join(" · ") : null;

        const saveBtn = document.querySelector(".exercicio-edit-save-btn");
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando..."; }

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog/${id}/notes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ muscle_group_id: groupId, notes: notesValue, video_url: videoUrl }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message || "Erro ao salvar exercício");

          showToast("Exercício atualizado com sucesso.", "success");
          document.getElementById("exercicioEditModal")?.classList.remove("open");
          await carregarCatalogoExercicios();
          await _renderizarPillsGrupoExercicio();
        } catch (err) {
          showToast(err?.message || "Erro ao salvar exercício.", "error");
        } finally {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salvar alterações"; }
        }
      }

      async function salvarGrupoMuscularCatalogoExercicio(exercicioId) {
        const select = document.getElementById(`cat_grupo_${exercicioId}`);
        if (!select) return;
        const muscleGroupId = select.value || null;

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog/${exercicioId}/notes`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ muscle_group_id: muscleGroupId }),
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message || "Erro ao salvar grupo muscular");
          showAlert("exerciciosAlert", "Grupo muscular do exercício atualizado.", "success");
        } catch (error) {
          showAlert("exerciciosAlert", error?.message || "Erro ao salvar grupo muscular", "error");
        }
      }

      async function carregarGruposMuscularesExercicios() {
        try {
          const searchParam = grupoMuscularBuscaAtual
            ? `?search=${encodeURIComponent(grupoMuscularBuscaAtual)}&limit=80`
            : "?limit=80";
          const response = await fetch(
            `${getApiBaseUrl()}/api/muscle-groups${searchParam}`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          if (response.status === 401) { handleUnauthorized(); return; }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const itens = (await response.json()) || [];
          const body = document.getElementById("muscleGroupCatalogBody");
          if (!body) return;
          if (!itens.length) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub">Nenhum grupo muscular encontrado.</span></div>';
            return;
          }
          body.innerHTML = itens
            .map((item) => `
              <div class="catalog-row">
                <div><div class="catalog-row-title">${escapeHtml(item.name || "Grupo")}</div></div>
                <button class="btn btn-danger" onclick="excluirGrupoMuscular('${escapeHtml(item.id)}','${escapeHtml(String(item.name || "")).replace(/'/g, "\\'")}')">Excluir</button>
              </div>`)
            .join("");
        } catch (error) {
          const body = document.getElementById("muscleGroupCatalogBody");
          if (body) body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub" style="color:#ef4444;">Erro ao carregar grupos musculares.</span></div>';
        }
      }

      async function excluirGrupoMuscular(id, nome) {
        if (!await showConfirm(`Deseja excluir o grupo muscular "${nome}"?`, { title: "Excluir grupo muscular", confirmLabel: "Excluir", variant: "danger" })) return;
        try {
          const response = await fetch(`${getApiBaseUrl()}/api/muscle-groups/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || "Erro ao excluir grupo muscular");
          }
          showToast("Grupo muscular excluído.", "success");
          muscleGroupsSelectCache = null;
          await carregarGruposMuscularesExercicios();
          await preencherSelectNovoCatalogoGrupoMuscular();
          await _renderizarPillsGrupoExercicio();
        } catch (error) {
          showToast(error?.message || "Erro ao excluir grupo muscular", "error");
        }
      }

      async function carregarVariacoesExercicios() {
        try {
          const searchParam = variacaoBuscaAtual
            ? `?search=${encodeURIComponent(variacaoBuscaAtual)}&limit=80`
            : "?limit=80";
          const response = await fetch(
            `${getApiBaseUrl()}/api/exercise-variations${searchParam}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const variacoes = (await response.json()) || [];
          const body = document.getElementById("exerciseVariationsBody");
          if (!body) return;
          if (!variacoes.length) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub">Nenhuma execução encontrada.</span></div>';
            return;
          }

          body.innerHTML = variacoes
            .map(
              (v) => `
                <div class="catalog-row">
                  <div>
                    <div class="catalog-row-title">${escapeHtml(v.name || "Execução")}</div>
                  </div>
                  <button class="btn btn-danger" onclick="excluirVariacaoExercicio('${escapeHtml(v.id)}','${escapeHtml(String(v.name || "")).replace(/'/g, "\\'")}')">Excluir</button>
                </div>
            `,
            )
            .join("");
        } catch (error) {
          const body = document.getElementById("exerciseVariationsBody");
          if (body) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub" style="color:#ef4444;">Erro ao carregar execuções.</span></div>';
          }
        }
      }

      async function carregarPegadasPisadasExercicios() {
        try {
          const searchParam = pegadaPisadaBuscaAtual
            ? `?search=${encodeURIComponent(pegadaPisadaBuscaAtual)}&limit=80`
            : "?limit=80";
          const response = await fetch(
            `${getApiBaseUrl()}/api/grip-footing-catalog${searchParam}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const itens = (await response.json()) || [];
          const body = document.getElementById("gripFootingCatalogBody");
          if (!body) return;
          if (!itens.length) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub">Nenhuma pegada/pisada encontrada.</span></div>';
            return;
          }

          body.innerHTML = itens
            .map(
              (item) => `
                <div class="catalog-row">
                  <div>
                    <div class="catalog-row-title">${escapeHtml(item.name || "Pegada/Pisada")}</div>
                  </div>
                  <button class="btn btn-danger" onclick="excluirPegadaPisadaExercicio('${escapeHtml(item.id)}','${escapeHtml(String(item.name || "")).replace(/'/g, "\\'")}')">Excluir</button>
                </div>
            `,
            )
            .join("");
        } catch (error) {
          const body = document.getElementById("gripFootingCatalogBody");
          if (body) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub" style="color:#ef4444;">Erro ao carregar pegadas/pisadas.</span></div>';
          }
        }
      }

      async function carregarMetodosExercicios() {
        try {
          const searchParam = metodoBuscaAtual
            ? `?search=${encodeURIComponent(metodoBuscaAtual)}&limit=80`
            : "?limit=80";
          const response = await fetch(
            `${getApiBaseUrl()}/api/method-catalog${searchParam}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const itens = (await response.json()) || [];
          const body = document.getElementById("methodCatalogBody");
          if (!body) return;
          if (!itens.length) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub">Nenhum método encontrado.</span></div>';
            return;
          }

          body.innerHTML = itens
            .map(
              (item) => `
                <div class="catalog-row">
                  <div>
                    <div class="catalog-row-title">${escapeHtml(item.name || "Método")}</div>
                  </div>
                  <button class="btn btn-danger" onclick="excluirMetodoExercicio('${escapeHtml(item.id)}','${escapeHtml(String(item.name || "")).replace(/'/g, "\\'")}')">Excluir</button>
                </div>
            `,
            )
            .join("");
        } catch (error) {
          const body = document.getElementById("methodCatalogBody");
          if (body) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub" style="color:#ef4444;">Erro ao carregar métodos.</span></div>';
          }
        }
      }

      async function carregarEquipamentosExercicios() {
        try {
          const searchParam = equipamentoBuscaAtual
            ? `?search=${encodeURIComponent(equipamentoBuscaAtual)}&limit=80`
            : "?limit=80";
          const response = await fetch(
            `${getApiBaseUrl()}/api/equipment-catalog${searchParam}`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const equipamentos = (await response.json()) || [];
          const body = document.getElementById("equipmentCatalogBody");
          if (!body) return;
          if (!equipamentos.length) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub">Nenhum equipamento encontrado.</span></div>';
            return;
          }

          body.innerHTML = equipamentos
            .map(
              (eq) => `
                <div class="catalog-row">
                  <div>
                    <div class="catalog-row-title">${escapeHtml(eq.name || "Equipamento")}</div>
                  </div>
                  <button class="btn btn-danger" onclick="excluirEquipamentoExercicio('${escapeHtml(eq.id)}','${escapeHtml(String(eq.name || "")).replace(/'/g, "\\'")}')">Excluir</button>
                </div>
            `,
            )
            .join("");
        } catch (error) {
          const body = document.getElementById("equipmentCatalogBody");
          if (body) {
            body.innerHTML = '<div class="catalog-row"><span class="catalog-row-sub" style="color:#ef4444;">Erro ao carregar equipamentos.</span></div>';
          }
        }
      }

      async function carregarExercicios() {
        markTabLoaded("exercicios");
        await Promise.all([
          carregarGruposMuscularesExercicios(),
          carregarCatalogoExercicios(),
          carregarEquipamentosExercicios(),
          carregarVariacoesExercicios(),
          carregarPegadasPisadasExercicios(),
          carregarMetodosExercicios(),
          preencherSelectNovoCatalogoGrupoMuscular(),
          _popularSelectsFormExercicio(),
          _renderizarPillsGrupoExercicio(),
        ]);
      }

      /** Popular os selects do novo formulário (equipamento, variação, pegada, método) */
      async function _popularSelectsFormExercicio() {
        const [equip, variac, pegada, metodo] = await Promise.all([
          fetch(`${getApiBaseUrl()}/api/equipment-catalog?limit=200`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/exercise-variations?limit=200`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/grip-footing-catalog?limit=200`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`${getApiBaseUrl()}/api/method-catalog?limit=200`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
        ]);

        const fillSelect = (id, items, placeholder) => {
          const sel = document.getElementById(id);
          if (!sel) return;
          sel.innerHTML = `<option value="">${placeholder}</option>` +
            items.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join("");
        };

        fillSelect("novoCatalogoEquipamento", equip,   "Sem equipamento");
        fillSelect("novoCatalogoVariacao",    variac,  "Sem execução");
        fillSelect("novoCatalogoPegada",      pegada,  "Sem pegada");
        fillSelect("novoCatalogoMetodo",      metodo,  "Sem método");
      }

      /** Renderiza as pills de filtro por grupo muscular na biblioteca */
      async function _renderizarPillsGrupoExercicio() {
        const container = document.getElementById("exercicioGrupoPills");
        if (!container) return;
        const grupos = await obterGruposMuscularesParaSelect();
        const currentActive = _exercicioGrupoFiltroAtivo;
        container.innerHTML = `<button class="exercicio-grupo-pill${!currentActive ? " active" : ""}" data-group="" onclick="filtrarCatalogoPorGrupo('',this)">Todos</button>` +
          grupos.map(g => `<button class="exercicio-grupo-pill${currentActive === g.id ? " active" : ""}" data-group="${escapeHtml(g.id)}" onclick="filtrarCatalogoPorGrupo('${escapeHtml(g.id)}',this)">${escapeHtml(g.name)}</button>`).join("");
      }

      /** Abrir modal de gerenciar catálogo */
      function abrirModalGerenciarCatalogo() {
        const modal = document.getElementById("gerenciarCatalogoModal");
        if (modal) {
          modal.classList.add("open");
          // Carrega a aba ativa
          const activePanel = modal.querySelector(".catalog-modal-panel.active");
          const panelId = activePanel?.id?.replace("catalogPanel_", "");
          _carregarPainelCatalogoModal(panelId || "grupos");
        }
      }

      function fecharModalGerenciarCatalogo(event) {
        if (event && event.target !== document.getElementById("gerenciarCatalogoModal")) return;
        const modal = document.getElementById("gerenciarCatalogoModal");
        if (modal) modal.classList.remove("open");
      }

      function openCatalogModalTab(panelKey, btnEl) {
        document.querySelectorAll(".catalog-modal-tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".catalog-modal-panel").forEach(p => p.classList.remove("active"));
        if (btnEl) btnEl.classList.add("active");
        const panel = document.getElementById(`catalogPanel_${panelKey}`);
        if (panel) panel.classList.add("active");
        _carregarPainelCatalogoModal(panelKey);
      }

      function _carregarPainelCatalogoModal(panelKey) {
        if (panelKey === "grupos")  carregarGruposMuscularesExercicios();
        if (panelKey === "equip")   carregarEquipamentosExercicios();
        if (panelKey === "exec")    carregarVariacoesExercicios();
        if (panelKey === "pegada")  carregarPegadasPisadasExercicios();
        if (panelKey === "metodo")  carregarMetodosExercicios();
      }

      function filtrarGruposMuscularesExercicios(valor) {
        grupoMuscularBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarGruposMuscularesExercicios(), 250);
      }

      function filtrarCatalogoExercicios(valor) {
        catalogoBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarCatalogoExercicios(), 250);
      }

      function filtrarVariacoesExercicios(valor) {
        variacaoBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarVariacoesExercicios(), 250);
      }

      function filtrarEquipamentosExercicios(valor) {
        equipamentoBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarEquipamentosExercicios(), 250);
      }

      function filtrarPegadasPisadasExercicios(valor) {
        pegadaPisadaBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarPegadasPisadasExercicios(), 250);
      }

      function filtrarMetodosExercicios(valor) {
        metodoBuscaAtual = (valor || "").trim();
        if (exerciciosFiltroTimeout) clearTimeout(exerciciosFiltroTimeout);
        exerciciosFiltroTimeout = setTimeout(() => carregarMetodosExercicios(), 250);
      }

      async function excluirCatalogoExercicio(id, nome) {
        if (!await showConfirm(`Deseja excluir o exercício "${nome}"?`, { title: "Excluir exercício", confirmLabel: "Excluir", variant: "danger" })) return;
        const response = await fetch(`${getApiBaseUrl()}/api/exercise-catalog/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao excluir exercício.", "error");
          return;
        }
        showAlert("exerciciosAlert", "Exercício excluído.", "success");
        await carregarCatalogoExercicios();
      }

      async function excluirVariacaoExercicio(id, nome) {
        if (!await showConfirm(`Deseja excluir a execução "${nome}"?`, { title: "Excluir execução", confirmLabel: "Excluir", variant: "danger" })) return;
        const response = await fetch(`${getApiBaseUrl()}/api/exercise-variations/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao excluir execução.", "error");
          return;
        }
        showAlert("exerciciosAlert", "Execução excluída.", "success");
        await carregarVariacoesExercicios();
      }

      async function excluirPegadaPisadaExercicio(id, nome) {
        if (!await showConfirm(`Deseja excluir a pegada/pisada "${nome}"?`, { title: "Excluir pegada/pisada", confirmLabel: "Excluir", variant: "danger" })) return;
        const response = await fetch(`${getApiBaseUrl()}/api/grip-footing-catalog/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao excluir pegada/pisada.", "error");
          return;
        }
        showAlert("exerciciosAlert", "Pegada/Pisada excluída.", "success");
        await carregarPegadasPisadasExercicios();
      }

      async function excluirMetodoExercicio(id, nome) {
        if (!await showConfirm(`Deseja excluir o método "${nome}"?`, { title: "Excluir método", confirmLabel: "Excluir", variant: "danger" })) return;
        const response = await fetch(`${getApiBaseUrl()}/api/method-catalog/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao excluir método.", "error");
          return;
        }
        showAlert("exerciciosAlert", "Método excluído.", "success");
        await carregarMetodosExercicios();
      }

      async function excluirEquipamentoExercicio(id, nome) {
        if (!await showConfirm(`Deseja excluir o equipamento "${nome}"?`, { title: "Excluir equipamento", confirmLabel: "Excluir", variant: "danger" })) return;
        const response = await fetch(`${getApiBaseUrl()}/api/equipment-catalog/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          showAlert("exerciciosAlert", err.message || "Erro ao excluir equipamento.", "error");
          return;
        }
        showAlert("exerciciosAlert", "Equipamento excluído.", "success");
        await carregarEquipamentosExercicios();
      }

      async function criarExercicio() {
        await criarCatalogoExercicio();
      }

      function carregarExerciciosPagina() {
        carregarExercicios();
      }

      function filtrarBibliotecaExercicios(valor) {
        filtrarCatalogoExercicios(valor);
      }

      function limparBuscaExercicios() {
        const input = document.getElementById("catalogoBuscaExercicios");
        if (input) {
          input.value = "";
        }
        catalogoBuscaAtual = "";
        carregarCatalogoExercicios();
      }

      async function buscarExerciciosSimilaresNome() {
        return;
      }

      async function carregarAlunosSelect() {
        try {
          const apiUrl =
            window.location.hostname === "localhost"
              ? "http://localhost:3333"
              : window.location.origin;

          const response = await fetch(`${apiUrl}/api/students`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (response.status === 401) {
            handleUnauthorized();
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (error) {
          console.error("Erro ao carregar alunos para select:", error);
        }
      }

      let exerciciosDoTreino = [];
      const exGroupState = {};

      function getNovoTreinoState(index) {
        if (!exGroupState[index]) {
          exGroupState[index] = {
            groupId: "",
            groupName: "",
            exerciseId: "",
            exerciseName: "",
          };
        }
        return exGroupState[index];
      }

      function getNovoTreinoRows(index, field) {
        const state = getNovoTreinoState(index);
        const rows = tabComboTreeState.rows || [];

        return rows.filter((row) => {
          if (field !== "group" && state.groupId && row.muscle_group_id !== state.groupId) {
            return false;
          }
          if (field !== "exercise" && state.exerciseId && row.exercise_catalog_id !== state.exerciseId) {
            return false;
          }
          return true;
        });
      }

      async function carregarTreeNovoTreino() {
        return carregarComboTreeEdicao();
      }

      function limparEstadoNovoTreino(index) {
        delete exGroupState[index];
        exVarState[index] = [];
        exEquipState[index] = [];
        exGripState[index] = [];
        exMethodState[index] = [];
        renderVarTags(index);
        renderEquipTags(index);
        renderGripTags(index);
        renderMethodTags(index);
      }

      function resetNovoTreinoDependentes(index, fromField) {
        const clearInput = (id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        };

        const hideDropdown = (id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = "none";
        };

        if (fromField === "group") {
          clearInput(`excat_search_${index}`);
          clearInput(`excat_id_${index}`);
          clearInput(`exvar_search_${index}`);
          clearInput(`exequip_search_${index}`);
          clearInput(`exgrip_search_${index}`);
          clearInput(`exmethod_search_${index}`);
          clearInput(`exvarid_${index}`);
          clearInput(`exvarids_${index}`);
          clearInput(`exequip_id_${index}`);
          clearInput(`exequip_ids_${index}`);
          clearInput(`exgrip_id_${index}`);
          clearInput(`exgrip_ids_${index}`);
          clearInput(`exmethod_id_${index}`);
          clearInput(`exmethod_ids_${index}`);
          exVarState[index] = [];
          exEquipState[index] = [];
          exGripState[index] = [];
          exMethodState[index] = [];
          renderVarTags(index);
          renderEquipTags(index);
          renderGripTags(index);
          renderMethodTags(index);
        }

        if (fromField === "exercise") {
          clearInput(`exvar_search_${index}`);
          clearInput(`exequip_search_${index}`);
          clearInput(`exgrip_search_${index}`);
          clearInput(`exmethod_search_${index}`);
          clearInput(`exvarid_${index}`);
          clearInput(`exvarids_${index}`);
          clearInput(`exequip_id_${index}`);
          clearInput(`exequip_ids_${index}`);
          clearInput(`exgrip_id_${index}`);
          clearInput(`exgrip_ids_${index}`);
          clearInput(`exmethod_id_${index}`);
          clearInput(`exmethod_ids_${index}`);
          exVarState[index] = [];
          exEquipState[index] = [];
          exGripState[index] = [];
          exMethodState[index] = [];
          renderVarTags(index);
          renderEquipTags(index);
          renderGripTags(index);
          renderMethodTags(index);
        }

        if (fromField === "variation") {
          clearInput(`exequip_search_${index}`);
          clearInput(`exgrip_search_${index}`);
          clearInput(`exmethod_search_${index}`);
          clearInput(`exequip_id_${index}`);
          clearInput(`exequip_ids_${index}`);
          clearInput(`exgrip_id_${index}`);
          clearInput(`exgrip_ids_${index}`);
          clearInput(`exmethod_id_${index}`);
          clearInput(`exmethod_ids_${index}`);
          exEquipState[index] = [];
          exGripState[index] = [];
          exMethodState[index] = [];
          renderEquipTags(index);
          renderGripTags(index);
          renderMethodTags(index);
        }

        if (fromField === "equipment") {
          clearInput(`exgrip_search_${index}`);
          clearInput(`exmethod_search_${index}`);
          clearInput(`exgrip_id_${index}`);
          clearInput(`exgrip_ids_${index}`);
          clearInput(`exmethod_id_${index}`);
          clearInput(`exmethod_ids_${index}`);
          exGripState[index] = [];
          exMethodState[index] = [];
          renderGripTags(index);
          renderMethodTags(index);
        }

        if (fromField === "grip") {
          clearInput(`exmethod_search_${index}`);
          clearInput(`exmethod_id_${index}`);
          clearInput(`exmethod_ids_${index}`);
          exMethodState[index] = [];
          renderMethodTags(index);
        }

        hideDropdown(`exmg_dropdown_${index}`);
        hideDropdown(`excat_dropdown_${index}`);
        hideDropdown(`exvar_dropdown_${index}`);
        hideDropdown(`exequip_dropdown_${index}`);
        hideDropdown(`exgrip_dropdown_${index}`);
        hideDropdown(`exmethod_dropdown_${index}`);

        updateIAButtonState(index);
      }

      function adicionarExercicioAoTreino() {
        const container = document.getElementById("exerciciosContainer");
        const index = exerciciosDoTreino.length;

        const exercicioDiv = document.createElement("div");
        exercicioDiv.className = "exercicio-item";
        exercicioDiv.style.cssText =
          "background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 15px; position: relative;";
        exercicioDiv.innerHTML = `
          <button onclick="removerExercicioDoTreino(${index})"
                  style="position: absolute; top: 10px; right: 10px; background: #ef4444; color: white; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 18px;">
            &times;
          </button>

          <div class="workout-add-grid">
            <div class="form-group" style="position: relative;">
              <label>Grupo muscular <small style="font-weight:400;color:#6b7280;">(filtro opcional)</small></label>
              <div style="position:relative;display:flex;align-items:center;">
                <input
                  type="text"
                  id="exmg_search_${index}"
                  placeholder="Opcional: clique para filtrar os grupos..."
                  autocomplete="off"
                  oninput="buscarGrupoMuscular(${index}, this.value)"
                  onfocus="buscarGrupoMuscular(${index}, this.value)"
                  style="padding-right:28px;width:100%;"
                />
                <button
                  type="button"
                  title="Limpar filtro de grupo muscular"
                  style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:2px 4px;"
                  onclick="limparFiltroGrupoMuscular(${index})"
                >&times;</button>
              </div>
              <input type="hidden" id="exmg_id_${index}" />
              <div id="exmg_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>

            <div class="form-group" style="position: relative;">
              <label>Exercício *</label>
              <input
                type="text"
                id="excat_search_${index}"
                placeholder="Digite para buscar exercício (grupo opcional)..."
                autocomplete="off"
                oninput="buscarCatalogo(${index}, this.value)"
                onfocus="buscarCatalogo(${index}, this.value)"
              />
              <input type="hidden" id="excat_id_${index}" />
              <div id="excat_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>
          </div>

          <div class="workout-optional-grid">
            <div id="exequip_wrapper_${index}" class="form-group" style="position:relative;">
              <label>Equipamento <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
              <div id="exequip_tags_${index}" class="tag-container"></div>
              <input type="text" id="exequip_search_${index}" placeholder="Digite para buscar equipamento..." autocomplete="off"
                     oninput="buscarEquipamento(${index}, this.value)" onfocus="buscarEquipamento(${index}, this.value)" />
              <input type="hidden" id="exequip_id_${index}" />
              <input type="hidden" id="exequip_ids_${index}" />
              <div id="exequip_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>

            <div id="exvar_wrapper_${index}" class="form-group" style="position:relative;">
              <label>Execução <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
              <div id="exvar_tags_${index}" class="tag-container"></div>
              <input type="text" id="exvar_search_${index}" placeholder="Digite para buscar execução..." autocomplete="off"
                     oninput="buscarVariacao(${index}, this.value)" onfocus="buscarVariacao(${index}, this.value)" />
              <div id="exvar_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>

            <div id="exgrip_wrapper_${index}" class="form-group" style="position:relative;">
              <label>Pegada/Pisada <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
              <div id="exgrip_tags_${index}" class="tag-container"></div>
              <input type="text" id="exgrip_search_${index}" placeholder="Digite para buscar pegada/pisada..." autocomplete="off"
                     oninput="buscarPegadaPisada(${index}, this.value)" onfocus="buscarPegadaPisada(${index}, this.value)" />
              <input type="hidden" id="exgrip_id_${index}" />
              <input type="hidden" id="exgrip_ids_${index}" />
              <div id="exgrip_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>

            <div id="exmethod_wrapper_${index}" class="form-group" style="position:relative;">
              <label>Método <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
              <div id="exmethod_tags_${index}" class="tag-container"></div>
              <input type="text" id="exmethod_search_${index}" placeholder="Digite para buscar método..." autocomplete="off"
                     oninput="buscarMetodo(${index}, this.value)" onfocus="buscarMetodo(${index}, this.value)" />
              <input type="hidden" id="exmethod_id_${index}" />
              <input type="hidden" id="exmethod_ids_${index}" />
              <div id="exmethod_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
            </div>
          </div>

          <div id="exmeta_wrapper_${index}" style="display:block;">
            <div class="form-group">
              <label>Orienta&#231;&#245;es/observa&#231;&#245;es <small style="font-weight:400;color:#6b7280;">(edit&#225;vel)</small></label>
              <textarea id="exdesc_${index}" rows="2" placeholder="Carregando..."></textarea>
              <small id="exdesc_mg_${index}" style="color:#6b7280;font-size:12px;display:block;margin-top:2px;"></small>
            </div>
            <button type="button" class="btn btn-secondary" id="exai_btn_${index}" onclick="gerarDescricaoExercicioIA(${index})" disabled style="margin-bottom:10px;">Gerar descrição com IA</button>
          </div>

          <input type="hidden" id="exvarid_${index}" />
          <input type="hidden" id="exvarids_${index}" />

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-top: 10px;">
            <div class="form-group">
              <label>Séries *</label>
              <input type="number" id="series_${index}" min="1" value="" placeholder="Ex: 3" required />
            </div>
            <div class="form-group">
              <label>Repetições *</label>
              <input type="number" id="reps_${index}" min="1" value="" placeholder="Ex: 12" required />
            </div>
            <div class="form-group">
              <label>Peso (kg)</label>
              <input type="number" id="peso_${index}" min="0" step="0.5" value="" placeholder="Ex: 20" />
            </div>
            <div class="form-group">
              <label>Descanso (s)</label>
              <input type="number" id="descanso_${index}" min="0" max="3600" step="5" value="" placeholder="Ex: 60" />
            </div>
          </div>

          <!-- ── Bi-set ────────────────────────────────────────────────────── -->
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;color:#374151;">
              <input type="checkbox" id="biset_check_${index}"
                     onchange="toggleBiset(${index})"
                     style="width:16px;height:16px;accent-color:#16a34a;cursor:pointer;" />
              Combinar com outro exercício <span style="background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:9999px;letter-spacing:.4px;">BI-SET</span>
            </label>
          </div>

          <!-- Bloco do segundo exercício do bi-set (oculto por padrão) -->
          <div id="biset_block_${index}" style="display:none;margin-top:12px;padding:12px;background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;position:relative;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:9999px;">BI-SET</span>
              <span style="font-size:13px;color:#15803d;font-weight:500;">2º exercício — executado em sequência, sem descanso</span>
            </div>

            <div class="workout-add-grid">
              <div class="form-group" style="position:relative;">
                <label>Grupo muscular <small style="font-weight:400;color:#6b7280;">(filtro opcional)</small></label>
                <div style="position:relative;display:flex;align-items:center;">
                  <input type="text" id="bs_exmg_search_${index}"
                         placeholder="Opcional: filtrar por grupo..."
                         autocomplete="off"
                         oninput="buscarGrupoMuscularBiset(${index}, this.value)"
                         onfocus="buscarGrupoMuscularBiset(${index}, this.value)"
                         style="padding-right:28px;width:100%;" />
                  <button type="button"
                          style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:2px 4px;"
                          onclick="limparFiltroGrupoMuscularBiset(${index})">&times;</button>
                </div>
                <input type="hidden" id="bs_exmg_id_${index}" />
                <div id="bs_exmg_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>

              <div class="form-group" style="position:relative;">
                <label>Exercício * <small style="font-weight:400;color:#dc2626;">(obrigatório no bi-set)</small></label>
                <input type="text" id="bs_excat_search_${index}"
                       placeholder="Digite para buscar o 2º exercício..."
                       autocomplete="off"
                       oninput="buscarCatalogoBiset(${index}, this.value)"
                       onfocus="buscarCatalogoBiset(${index}, this.value)" />
                <input type="hidden" id="bs_excat_id_${index}" />
                <div id="bs_excat_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>
            </div>

            <div class="workout-optional-grid" style="margin-top:8px;">
              <div class="form-group" style="position:relative;">
                <label>Equipamento <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                <input type="text" id="bs_exequip_search_${index}" placeholder="Equipamento..." autocomplete="off"
                       oninput="buscarEquipamentoBiset(${index}, this.value)" onfocus="buscarEquipamentoBiset(${index}, this.value)" />
                <input type="hidden" id="bs_exequip_id_${index}" />
                <div id="bs_exequip_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>
              <div class="form-group" style="position:relative;">
                <label>Execução <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                <input type="text" id="bs_exvar_search_${index}" placeholder="Execução..." autocomplete="off"
                       oninput="buscarVariacaoBiset(${index}, this.value)" onfocus="buscarVariacaoBiset(${index}, this.value)" />
                <input type="hidden" id="bs_exvarid_${index}" />
                <div id="bs_exvar_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>
              <div class="form-group" style="position:relative;">
                <label>Pegada/Pisada <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                <input type="text" id="bs_exgrip_search_${index}" placeholder="Pegada/Pisada..." autocomplete="off"
                       oninput="buscarPegadaBiset(${index}, this.value)" onfocus="buscarPegadaBiset(${index}, this.value)" />
                <input type="hidden" id="bs_exgrip_id_${index}" />
                <div id="bs_exgrip_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>
              <div class="form-group" style="position:relative;">
                <label>Método <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                <input type="text" id="bs_exmethod_search_${index}" placeholder="Método..." autocomplete="off"
                       oninput="buscarMetodoBiset(${index}, this.value)" onfocus="buscarMetodoBiset(${index}, this.value)" />
                <input type="hidden" id="bs_exmethod_id_${index}" />
                <div id="bs_exmethod_dropdown_${index}" class="autocomplete-dropdown" style="display:none;"></div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px;">
              <div class="form-group">
                <label>Repetições *</label>
                <input type="number" id="bs_reps_${index}" min="1" placeholder="Ex: 12" />
              </div>
              <div class="form-group">
                <label>Peso (kg)</label>
                <input type="number" id="bs_peso_${index}" min="0" step="0.5" placeholder="Ex: 20" />
              </div>
              <div class="form-group">
                <label>Descanso após bi-set (s)</label>
                <input type="number" id="bs_descanso_${index}" min="0" max="3600" step="5" placeholder="Ex: 60" />
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #86efac;">
              <button type="button"
                      onclick="confirmarBiset(${index})"
                      style="flex:1;padding:8px 12px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">
                ✓ Confirmar Bi-set
              </button>
              <button type="button"
                      onclick="cancelarBiset(${index})"
                      style="padding:8px 12px;background:#fff;color:#6b7280;border:1px solid #d1d5db;border-radius:6px;font-weight:500;cursor:pointer;font-size:13px;">
                ✕ Cancelar
              </button>
            </div>
          </div>
        `;

        container.appendChild(exercicioDiv);
        exerciciosDoTreino.push({ index });
      }

      // -- Estado in-memory para multi-seleção ----------------------------------
      const exVarState = {};    // { [index]: [{id, name}] }
      const exEquipState = {};  // { [index]: [{id, name}] }
      const exGripState = {};   // { [index]: [{id, name}] }
      const exMethodState = {}; // { [index]: [{id, name}] }

      // ── Bi-set: estado in-memory para seleção em cascata do 2º exercício ──
      const bsBuscaTimeout = {};  // debounce por index
      const bsMgState = {};       // { [index]: { id, name } } — grupo muscular do 2º exercício

      // Mostra/oculta o bloco do 2º exercício do bi-set
      function toggleBiset(index) {
        const checked = document.getElementById(`biset_check_${index}`)?.checked;
        const block   = document.getElementById(`biset_block_${index}`);
        if (!block) return;
        block.style.display = checked ? "block" : "none";
        if (!checked) {
          // Limpa campos do 2º exercício ao desmarcar
          const fields = ["bs_exmg_search_","bs_excat_search_","bs_exequip_search_",
                          "bs_exvar_search_","bs_exgrip_search_","bs_exmethod_search_",
                          "bs_reps_","bs_peso_","bs_descanso_"];
          fields.forEach(f => { const el = document.getElementById(`${f}${index}`); if (el) el.value = ""; });
          const hiddens = ["bs_exmg_id_","bs_excat_id_","bs_exequip_id_",
                           "bs_exvarid_","bs_exgrip_id_","bs_exmethod_id_"];
          hiddens.forEach(f => { const el = document.getElementById(`${f}${index}`); if (el) el.value = ""; });
          if (bsMgState[index]) delete bsMgState[index];
        }
      }

      // Confirma o bi-set: fecha o bloco e mostra resumo visual do 2º exercício selecionado
      function confirmarBiset(index) {
        const catSearch = document.getElementById(`bs_excat_search_${index}`)?.value;
        const catId     = document.getElementById(`bs_excat_id_${index}`)?.value;
        if (!catId) {
          showToast("Selecione o 2º exercício do Bi-set antes de confirmar.", "warn");
          return;
        }
        const block = document.getElementById(`biset_block_${index}`);
        if (block) {
          // Atualiza o cabeçalho do bloco para mostrar que está confirmado
          const header = block.querySelector(".biset-status-label");
          if (header) header.textContent = `✓ ${catSearch || "2º exercício"} selecionado`;
        }
        // Mantém o bloco aberto mas scroll para o exercício principal
        document.getElementById(`biset_check_${index}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      // Cancela o bi-set: desmarca o checkbox e limpa o bloco
      function cancelarBiset(index) {
        const chk = document.getElementById(`biset_check_${index}`);
        if (chk) { chk.checked = false; }
        toggleBiset(index);
      }

      // ── Busca de grupo muscular para o 2º exercício do bi-set ──
      function buscarGrupoMuscularBiset(index, termo) {
        const dropdown = document.getElementById(`bs_exmg_dropdown_${index}`);
        if (!dropdown) return;
        if (!termo || !termo.trim()) { dropdown.style.display = "none"; return; }
        clearTimeout(bsBuscaTimeout[`mg_${index}`]);
        bsBuscaTimeout[`mg_${index}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/muscle-groups?search=${encodeURIComponent(termo)}&limit=20`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum grupo encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarGrupoMuscularBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 200);
      }
      function selecionarGrupoMuscularBiset(index, id, name) {
        bsMgState[index] = { id, name };
        const el = document.getElementById(`bs_exmg_search_${index}`);
        if (el) el.value = name;
        const hidEl = document.getElementById(`bs_exmg_id_${index}`);
        if (hidEl) hidEl.value = id;
        const dd = document.getElementById(`bs_exmg_dropdown_${index}`);
        if (dd) dd.style.display = "none";
        // Limpa o exercício selecionado quando muda o grupo
        const catSearch = document.getElementById(`bs_excat_search_${index}`);
        if (catSearch) catSearch.value = "";
        const catId = document.getElementById(`bs_excat_id_${index}`);
        if (catId) catId.value = "";
      }
      function limparFiltroGrupoMuscularBiset(index) {
        if (bsMgState[index]) delete bsMgState[index];
        const el = document.getElementById(`bs_exmg_search_${index}`);
        if (el) el.value = "";
        const hidEl = document.getElementById(`bs_exmg_id_${index}`);
        if (hidEl) hidEl.value = "";
        const dd = document.getElementById(`bs_exmg_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // ── Busca de exercício (catálogo) para o 2º exercício do bi-set ──
      function buscarCatalogoBiset(index, termo) {
        const dropdown = document.getElementById(`bs_excat_dropdown_${index}`);
        if (!dropdown) return;
        clearTimeout(bsBuscaTimeout[`cat_${index}`]);
        const query = (termo || "").trim();
        bsBuscaTimeout[`cat_${index}`] = setTimeout(async () => {
          try {
            const params = new URLSearchParams();
            if (query) params.set("search", query);
            params.set("limit", "1000");
            const groupId = bsMgState[index]?.id;
            if (groupId) params.set("muscle_group_id", groupId);
            const res = await fetch(`${getApiBaseUrl()}/api/exercise-catalog?${params.toString()}`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum exercício encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarCatalogoBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 <strong>${escapeHtml(item.name)}</strong>
                 ${item.muscle_group_name ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">${escapeHtml(item.muscle_group_name)}</span>` : ""}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 300);
      }
      function selecionarCatalogoBiset(index, id, name) {
        const search = document.getElementById(`bs_excat_search_${index}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`bs_excat_id_${index}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`bs_excat_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // ── Busca de equipamento para o 2º exercício do bi-set ──
      function buscarEquipamentoBiset(index, termo) {
        const dropdown = document.getElementById(`bs_exequip_dropdown_${index}`);
        if (!dropdown) return;
        clearTimeout(bsBuscaTimeout[`equip_${index}`]);
        const query = (termo || "").trim();
        bsBuscaTimeout[`equip_${index}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/equipment-catalog?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum equipamento encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarEquipamentoBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 250);
      }
      function selecionarEquipamentoBiset(index, id, name) {
        const search = document.getElementById(`bs_exequip_search_${index}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`bs_exequip_id_${index}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`bs_exequip_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // ── Busca de variação/execução para o 2º exercício do bi-set ──
      function buscarVariacaoBiset(index, termo) {
        const dropdown = document.getElementById(`bs_exvar_dropdown_${index}`);
        if (!dropdown) return;
        clearTimeout(bsBuscaTimeout[`var_${index}`]);
        const query = (termo || "").trim();
        bsBuscaTimeout[`var_${index}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/exercise-variations?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhuma execução encontrada.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarVariacaoBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 300);
      }
      function selecionarVariacaoBiset(index, id, name) {
        const search = document.getElementById(`bs_exvar_search_${index}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`bs_exvarid_${index}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`bs_exvar_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // ── Busca de pegada/pisada para o 2º exercício do bi-set ──
      function buscarPegadaBiset(index, termo) {
        const dropdown = document.getElementById(`bs_exgrip_dropdown_${index}`);
        if (!dropdown) return;
        clearTimeout(bsBuscaTimeout[`grip_${index}`]);
        const query = (termo || "").trim();
        bsBuscaTimeout[`grip_${index}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/grip-footing-catalog?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhuma pegada encontrada.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarPegadaBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 250);
      }
      function selecionarPegadaBiset(index, id, name) {
        const search = document.getElementById(`bs_exgrip_search_${index}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`bs_exgrip_id_${index}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`bs_exgrip_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // ── Busca de método para o 2º exercício do bi-set ──
      function buscarMetodoBiset(index, termo) {
        const dropdown = document.getElementById(`bs_exmethod_dropdown_${index}`);
        if (!dropdown) return;
        clearTimeout(bsBuscaTimeout[`method_${index}`]);
        const query = (termo || "").trim();
        bsBuscaTimeout[`method_${index}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/method-catalog?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum método encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarMetodoBiset(${index},'${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 250);
      }
      function selecionarMetodoBiset(index, id, name) {
        const search = document.getElementById(`bs_exmethod_search_${index}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`bs_exmethod_id_${index}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`bs_exmethod_dropdown_${index}`);
        if (dd) dd.style.display = "none";
      }

      // Caches para seleção em cascata - Novo Treino
      const grupoMuscularBuscaTimeout = {};
      let catalogoBuscaTimeout = {};
      let variacaoBuscaTimeout = {};
      let equipamentoBuscaTimeout = {};
      let gripBuscaTimeout = {};
      let methodBuscaTimeout = {};

      async function buscarGrupoMuscular(index, termo) {
        if (grupoMuscularBuscaTimeout[index]) clearTimeout(grupoMuscularBuscaTimeout[index]);
        const dropdown = document.getElementById(`exmg_dropdown_${index}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        grupoMuscularBuscaTimeout[index] = setTimeout(async () => {
          try {
            const params = new URLSearchParams();
            if (query) params.set("search", query);
            params.set("limit", "1000");
            const response = await fetch(
              `${getApiBaseUrl()}/api/muscle-groups?${params.toString()}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({ id: item.id, label: item.name }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarGrupoMuscular(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                <strong>${escapeHtml(item.label)}</strong>
              </div>
            `);
          } catch (e) {
            dropdown.style.display = "none";
          }
        }, 200);
      }

      function selecionarGrupoMuscular(index, groupId, groupName) {
        const search = document.getElementById(`exmg_search_${index}`);
        const hidden = document.getElementById(`exmg_id_${index}`);
        const dropdown = document.getElementById(`exmg_dropdown_${index}`);
        if (search) search.value = groupName;
        if (hidden) hidden.value = groupId;
        if (dropdown) dropdown.style.display = "none";

        const state = getNovoTreinoState(index);
        state.groupId = groupId;
        state.groupName = groupName;
        state.exerciseId = "";
        state.exerciseName = "";

        resetNovoTreinoDependentes(index, "group");
      }

      function limparFiltroGrupoMuscular(index) {
        const search = document.getElementById(`exmg_search_${index}`);
        const hidden = document.getElementById(`exmg_id_${index}`);
        const dropdown = document.getElementById(`exmg_dropdown_${index}`);
        if (search) { search.value = ""; }
        if (hidden) { hidden.value = ""; }
        if (dropdown) { dropdown.style.display = "none"; }

        const state = getNovoTreinoState(index);
        state.groupId = "";
        state.groupName = "";
        state.exerciseId = "";
        state.exerciseName = "";

        resetNovoTreinoDependentes(index, "group");
        // Reabrir dropdown com todos os exercícios (sem filtro de grupo)
        buscarCatalogo(index, document.getElementById(`excat_search_${index}`)?.value || "");
      }

      function renderVarTags(index) {
        const items = exVarState[index] || [];
        const el = document.getElementById(`exvar_tags_${index}`);
        if (el) {
          el.innerHTML = items.map((item) =>
            `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeVariacaoItem(${index},'${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
          ).join("");
        }
        document.getElementById(`exvarids_${index}`).value = items.map((i) => i.id).join(",");
        document.getElementById(`exvarid_${index}`).value = items[0]?.id || "";
        updateIAButtonState(index);
      }

      function removeVariacaoItem(index, id) {
        exVarState[index] = (exVarState[index] || []).filter((i) => i.id !== id);
        renderVarTags(index);
      }

      function renderEquipTags(index) {
        const items = exEquipState[index] || [];
        const el = document.getElementById(`exequip_tags_${index}`);
        if (el) {
          el.innerHTML = items.map((item) =>
            `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeEquipamentoItem(${index},'${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
          ).join("");
        }
        document.getElementById(`exequip_ids_${index}`).value = items.map((i) => i.id).join(",");
        document.getElementById(`exequip_id_${index}`).value = items[0]?.id || "";
        updateIAButtonState(index);
      }

      function removeEquipamentoItem(index, id) {
        exEquipState[index] = (exEquipState[index] || []).filter((i) => i.id !== id);
        renderEquipTags(index);
      }

      function renderGripTags(index) {
        const items = exGripState[index] || [];
        const el = document.getElementById(`exgrip_tags_${index}`);
        if (el) {
          el.innerHTML = items.map((item) =>
            `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removePegadaPisadaItem(${index},'${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
          ).join("");
        }
        document.getElementById(`exgrip_ids_${index}`).value = items.map((i) => i.id).join(",");
        document.getElementById(`exgrip_id_${index}`).value = items[0]?.id || "";
      }

      function removePegadaPisadaItem(index, id) {
        exGripState[index] = (exGripState[index] || []).filter((i) => i.id !== id);
        renderGripTags(index);
      }

      function renderMethodTags(index) {
        const items = exMethodState[index] || [];
        const el = document.getElementById(`exmethod_tags_${index}`);
        if (el) {
          el.innerHTML = items.map((item) =>
            `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeMetodoItem(${index},'${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
          ).join("");
        }
        document.getElementById(`exmethod_ids_${index}`).value = items.map((i) => i.id).join(",");
        document.getElementById(`exmethod_id_${index}`).value = items[0]?.id || "";
      }

      function removeMetodoItem(index, id) {
        exMethodState[index] = (exMethodState[index] || []).filter((i) => i.id !== id);
        renderMethodTags(index);
      }

      function updateIAButtonState(index) {
        const catalogId = document.getElementById(`excat_id_${index}`)?.value;
        const btn = document.getElementById(`exai_btn_${index}`);
        if (btn) btn.disabled = !catalogId;
      }

      async function buscarCatalogo(index, termo) {
        if (catalogoBuscaTimeout[index]) clearTimeout(catalogoBuscaTimeout[index]);
        const dropdown = document.getElementById(`excat_dropdown_${index}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        const state = getNovoTreinoState(index);
        catalogoBuscaTimeout[index] = setTimeout(async () => {
          try {
            const params = new URLSearchParams();
            if (query) params.set("search", query);
            params.set("limit", "1000");
            if (state.groupId) params.set("muscle_group_id", state.groupId);

            const response = await fetch(
              `${getApiBaseUrl()}/api/exercise-catalog?${params.toString()}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({
                id: item.id,
                label: item.name,
                notes: item.notes,
                muscleGroupId: item.muscle_group_id,
                muscleGroupName: item.muscle_group_name,
              }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarCatalogo(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}', '${escapeHtml(item.muscleGroupId || "")}', '${escapeHtml(item.muscleGroupName || "").replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                <strong>${escapeHtml(item.label)}</strong>
                ${item.notes ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(item.notes)}</div>` : ""}
              </div>
            `);
          } catch (e) {
            dropdown.style.display = "none";
          }
        }, 300);
      }

      async function selecionarCatalogo(index, catalogId, catalogName, groupId, groupName) {
        document.getElementById(`excat_search_${index}`).value = catalogName;
        document.getElementById(`excat_id_${index}`).value = catalogId;
        document.getElementById(`excat_dropdown_${index}`).style.display = "none";
        const groupSearch = document.getElementById(`exmg_search_${index}`);
        const groupHidden = document.getElementById(`exmg_id_${index}`);
        if (groupId && groupSearch) groupSearch.value = groupName || groupSearch.value;
        if (groupId && groupHidden) groupHidden.value = groupId;
        const state = getNovoTreinoState(index);
        state.exerciseId = catalogId;
        state.exerciseName = catalogName;
        if (groupId) {
          state.groupId = groupId;
          state.groupName = groupName || state.groupName;
        }
        // Reset execução e equipamento
        resetNovoTreinoDependentes(index, "exercise");
        document.getElementById(`exequip_wrapper_${index}`).style.display = "block";
        document.getElementById(`exvar_wrapper_${index}`).style.display = "block";
        document.getElementById(`exgrip_wrapper_${index}`).style.display = "block";
        document.getElementById(`exmethod_wrapper_${index}`).style.display = "block";
        document.getElementById(`exmeta_wrapper_${index}`).style.display = "block";
        updateIAButtonState(index);
      }

      async function buscarVariacao(index, termo) {
        if (variacaoBuscaTimeout[index]) clearTimeout(variacaoBuscaTimeout[index]);
        const dropdown = document.getElementById(`exvar_dropdown_${index}`);
        if (!dropdown) return;
        const state = getNovoTreinoState(index);
        if (!state.exerciseId) {
          dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;text-align:center;">Selecione um exercício primeiro.</div>';
          dropdown.style.display = "block";
          return;
        }
        const query = normalizeComboSearch(termo || "");
        const limit = query ? 1000 : 1000;
        variacaoBuscaTimeout[index] = setTimeout(async () => {
          try {
            const response = await fetch(
              `${getApiBaseUrl()}/api/exercise-variations?search=${encodeURIComponent(query)}&limit=${limit}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({ id: item.id, label: item.name }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarVariacaoItem(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                <strong>${escapeHtml(item.label)}</strong>
              </div>
            `);
          } catch (e) {
            dropdown.style.display = "none";
          }
        }, 300);
      }

      function selecionarVariacaoItem(index, variationId, variationName) {
        document.getElementById(`exvar_search_${index}`).value = "";
        document.getElementById(`exvar_dropdown_${index}`).style.display = "none";
        if (!exVarState[index]) exVarState[index] = [];
        if (!exVarState[index].find((i) => i.id === variationId)) {
          exVarState[index].push({ id: variationId, name: variationName });
        }
        renderVarTags(index);
      }

      async function buscarEquipamento(index, termo) {
        if (equipamentoBuscaTimeout[index]) clearTimeout(equipamentoBuscaTimeout[index]);
        const dropdown = document.getElementById(`exequip_dropdown_${index}`);
        if (!dropdown) return;
        const state = getNovoTreinoState(index);
        if (!state.exerciseId) {
          dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;text-align:center;">Selecione um exercício primeiro.</div>';
          dropdown.style.display = "block";
          return;
        }
        const query = normalizeComboSearch(termo || "");
        const limit = query ? 1000 : 1000;
        equipamentoBuscaTimeout[index] = setTimeout(async () => {
          try {
            const response = await fetch(
              `${getApiBaseUrl()}/api/equipment-catalog?search=${encodeURIComponent(query)}&limit=${limit}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({ id: item.id, label: item.name }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarEquipamentoItem(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.label)}
              </div>
            `);
          } catch (e) {}
        }, 250);
      }

      function selecionarEquipamentoItem(index, equipId, equipName) {
        document.getElementById(`exequip_search_${index}`).value = "";
        document.getElementById(`exequip_dropdown_${index}`).style.display = "none";
        if (!exEquipState[index]) exEquipState[index] = [];
        if (!exEquipState[index].find((i) => i.id === equipId)) {
          exEquipState[index].push({ id: equipId, name: equipName });
        }
        renderEquipTags(index);
      }

      async function buscarPegadaPisada(index, termo) {
        if (gripBuscaTimeout[index]) clearTimeout(gripBuscaTimeout[index]);
        const dropdown = document.getElementById(`exgrip_dropdown_${index}`);
        if (!dropdown) return;
        const state = getNovoTreinoState(index);
        if (!state.exerciseId) {
          dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;text-align:center;">Selecione um exercício primeiro.</div>';
          dropdown.style.display = "block";
          return;
        }
        const query = normalizeComboSearch(termo || "");
        const limit = query ? 1000 : 1000;
        gripBuscaTimeout[index] = setTimeout(async () => {
          try {
            const response = await fetch(
              `${getApiBaseUrl()}/api/grip-footing-catalog?search=${encodeURIComponent(query)}&limit=${limit}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({ id: item.id, label: item.name }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarPegadaPisadaItem(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.label)}
              </div>
            `);
          } catch (e) {}
        }, 250);
      }

      function selecionarPegadaPisadaItem(index, gripId, gripName) {
        document.getElementById(`exgrip_search_${index}`).value = "";
        document.getElementById(`exgrip_dropdown_${index}`).style.display = "none";
        if (!exGripState[index]) exGripState[index] = [];
        if (!exGripState[index].find((i) => i.id === gripId)) {
          exGripState[index].push({ id: gripId, name: gripName });
        }
        renderGripTags(index);
      }

      async function buscarMetodo(index, termo) {
        if (methodBuscaTimeout[index]) clearTimeout(methodBuscaTimeout[index]);
        const dropdown = document.getElementById(`exmethod_dropdown_${index}`);
        if (!dropdown) return;
        const state = getNovoTreinoState(index);
        if (!state.exerciseId) {
          dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;text-align:center;">Selecione um exercício primeiro.</div>';
          dropdown.style.display = "block";
          return;
        }
        const query = normalizeComboSearch(termo || "");
        const limit = query ? 1000 : 1000;
        methodBuscaTimeout[index] = setTimeout(async () => {
          try {
            const response = await fetch(
              `${getApiBaseUrl()}/api/method-catalog?search=${encodeURIComponent(query)}&limit=${limit}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok) return;
            const items = await response.json();
            const options = (Array.isArray(items) ? items : [])
              .map((item) => ({ id: item.id, label: item.name }))
              .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

            renderComboDropdown(dropdown, options, (item) => `
              <div class="autocomplete-item"
                   onclick="selecionarMetodoItem(${index}, '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.label)}
              </div>
            `);
          } catch (e) {}
        }, 250);
      }

      function selecionarMetodoItem(index, methodId, methodName) {
        document.getElementById(`exmethod_search_${index}`).value = "";
        document.getElementById(`exmethod_dropdown_${index}`).style.display = "none";
        if (!exMethodState[index]) exMethodState[index] = [];
        if (!exMethodState[index].find((i) => i.id === methodId)) {
          exMethodState[index].push({ id: methodId, name: methodName });
        }
        renderMethodTags(index);
      }

      async function gerarDescricaoExercicioIA(index) {
        const catalogId = document.getElementById(`excat_id_${index}`)?.value;
        if (!catalogId) return;
        const varItems = exVarState[index] || [];
        const equipItems = exEquipState[index] || [];
        const gripItems = exGripState[index] || [];
        const methodItems = exMethodState[index] || [];
        const descArea = document.getElementById(`exdesc_${index}`);
        const mgSmall = document.getElementById(`exdesc_mg_${index}`);
        if (!descArea) return;
        descArea.value = "";
        descArea.placeholder = "Gerando descrição com IA...";
        if (mgSmall) mgSmall.textContent = "";
        try {
          const res = await fetch(
            `${getApiBaseUrl()}/api/exercise-combos/generate-description`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({
                exercise_catalog_id: catalogId,
                exercise_variation_id: varItems[0]?.id || null,
                equipment_id: equipItems[0]?.id || null,
                grip_footing_id: gripItems[0]?.id || null,
                method_id: methodItems[0]?.id || null,
              }),
            },
          );
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Erro ${res.status}`);
          }
          const result = await res.json();
          descArea.value = result.description || "";
          descArea.placeholder = "Descrição gerada pela IA...";
          if (mgSmall) mgSmall.textContent = result.muscle_group_name ? `Grupo muscular: ${result.muscle_group_name}` : "";
        } catch (e) {
          descArea.placeholder = e?.message || "Erro ao gerar descrição.";
        }
      }

      // Fechar dropdown ao clicar fora — inclui o campo de busca de treinos do aluno
      document.addEventListener("click", function (e) {
        const isSearchInput = e.target.matches(
          '[id^="exmg_search_"], [id^="excat_search_"], [id^="tab_mg_search_"], ' +
          '[id^="tab_cat_search_"], [id^="exvar_search_"], [id^="exequip_search_"], ' +
          '[id^="exgrip_search_"], [id^="exmethod_search_"], [id^="tab_var_search_"], ' +
          '[id^="tab_equip_search_"], [id^="tab_grip_search_"], [id^="tab_method_search_"], ' +
          '#studentWorkoutSearchInput'
        );
        if (!isSearchInput) {
          document
            .querySelectorAll(".autocomplete-dropdown")
            .forEach((dropdown) => {
              dropdown.style.display = "none";
            });
        }
      });

      function removerExercicioDoTreino(domIndex) {
        // Encontrar a posição correta no array pelo índice DOM original (não pela posição atual no array)
        const arrayPos = exerciciosDoTreino.findIndex((ex) => ex.index === domIndex);
        if (arrayPos === -1) return;

        // Remover o elemento do DOM usando o atributo de identificação
        // items[] usa posição visual, que pode não coincidir com domIndex após remoções anteriores
        exerciciosDoTreino.splice(arrayPos, 1);

        // Limpar estado in-memory associado a esse índice DOM
        delete exGroupState[domIndex];
        delete exVarState[domIndex];
        delete exEquipState[domIndex];
        delete exGripState[domIndex];
        delete exMethodState[domIndex];
        delete bsMgState[domIndex];
        if (grupoMuscularBuscaTimeout[domIndex]) { clearTimeout(grupoMuscularBuscaTimeout[domIndex]); delete grupoMuscularBuscaTimeout[domIndex]; }
        if (catalogoBuscaTimeout[domIndex]) { clearTimeout(catalogoBuscaTimeout[domIndex]); delete catalogoBuscaTimeout[domIndex]; }
        if (variacaoBuscaTimeout[domIndex]) { clearTimeout(variacaoBuscaTimeout[domIndex]); delete variacaoBuscaTimeout[domIndex]; }
        if (equipamentoBuscaTimeout[domIndex]) { clearTimeout(equipamentoBuscaTimeout[domIndex]); delete equipamentoBuscaTimeout[domIndex]; }
        if (gripBuscaTimeout[domIndex]) { clearTimeout(gripBuscaTimeout[domIndex]); delete gripBuscaTimeout[domIndex]; }
        if (methodBuscaTimeout[domIndex]) { clearTimeout(methodBuscaTimeout[domIndex]); delete methodBuscaTimeout[domIndex]; }

        // Remover o nó do DOM: buscar pelo exercicio-item que contém os inputs com esse domIndex
        const container = document.getElementById("exerciciosContainer");
        const items = container.querySelectorAll(".exercicio-item");
        for (const item of items) {
          if (item.querySelector(`#excat_id_${domIndex}`) || item.querySelector(`#series_${domIndex}`)) {
            item.remove();
            break;
          }
        }
      }

      function limparFormularioTreino() {
        document.getElementById("treinoNome").value = "";
        document.getElementById("treinoDataInicio").value = "";
        document.getElementById("exerciciosContainer").innerHTML = "";
        exerciciosDoTreino = [];

        // Limpar todos os estados in-memory por índice para evitar dados stale
        Object.keys(exGroupState).forEach((key) => delete exGroupState[key]);
        Object.keys(exVarState).forEach((key) => delete exVarState[key]);
        Object.keys(exEquipState).forEach((key) => delete exEquipState[key]);
        Object.keys(exGripState).forEach((key) => delete exGripState[key]);
        Object.keys(exMethodState).forEach((key) => delete exMethodState[key]);
        Object.keys(bsMgState).forEach((key) => delete bsMgState[key]);

        // Cancelar todos os timeouts de debounce pendentes para evitar callbacks stale
        Object.keys(grupoMuscularBuscaTimeout).forEach((key) => { clearTimeout(grupoMuscularBuscaTimeout[key]); delete grupoMuscularBuscaTimeout[key]; });
        Object.keys(catalogoBuscaTimeout).forEach((key) => { clearTimeout(catalogoBuscaTimeout[key]); delete catalogoBuscaTimeout[key]; });
        Object.keys(variacaoBuscaTimeout).forEach((key) => { clearTimeout(variacaoBuscaTimeout[key]); delete variacaoBuscaTimeout[key]; });
        Object.keys(equipamentoBuscaTimeout).forEach((key) => { clearTimeout(equipamentoBuscaTimeout[key]); delete equipamentoBuscaTimeout[key]; });
        Object.keys(gripBuscaTimeout).forEach((key) => { clearTimeout(gripBuscaTimeout[key]); delete gripBuscaTimeout[key]; });
        Object.keys(methodBuscaTimeout).forEach((key) => { clearTimeout(methodBuscaTimeout[key]); delete methodBuscaTimeout[key]; });
        Object.keys(bsBuscaTimeout).forEach((key) => { clearTimeout(bsBuscaTimeout[key]); delete bsBuscaTimeout[key]; });

        document.getElementById("treinosAlert").innerHTML = "";
      }

      async function criarTreinoCompleto() {
        const nome = document.getElementById("treinoNome").value;
        const dataInicio = document.getElementById("treinoDataInicio").value;

        if (!nome) {
          showAlert("treinosAlert", "Preencha o nome do treino.", "error");
          return;
        }

        // Coletar exercícios
        const exercises = [];
        let orderCounter = 0;
        for (let i = 0; i < exerciciosDoTreino.length; i++) {
          // Usar o índice real do DOM (exerciciosDoTreino[i].index) e não 'i',
          // pois após remoções os índices HTML podem ser não-contíguos (ex: 0, 2, 3).
          const domIdx = exerciciosDoTreino[i].index;
          const variationIds = (document.getElementById(`exvarids_${domIdx}`)?.value || "").split(",").filter(Boolean);
          const catalogId = document.getElementById(`excat_id_${domIdx}`)?.value;
          const equipIds = (document.getElementById(`exequip_ids_${domIdx}`)?.value || "").split(",").filter(Boolean);
          const gripIds = (document.getElementById(`exgrip_ids_${domIdx}`)?.value || "").split(",").filter(Boolean);
          const methodIds = (document.getElementById(`exmethod_ids_${domIdx}`)?.value || "").split(",").filter(Boolean);
          const series = Number(document.getElementById(`series_${domIdx}`)?.value);
          const reps = Number(document.getElementById(`reps_${domIdx}`)?.value);
          const peso = document.getElementById(`peso_${domIdx}`)?.value;
          const descanso = document.getElementById(`descanso_${domIdx}`)?.value;
          const customDesc = document.getElementById(`exdesc_${domIdx}`)?.value?.trim();

          // ── Bi-set: coletar dados do 2º exercício ──
          const isBiset = document.getElementById(`biset_check_${domIdx}`)?.checked;
          const bsCatalogId  = document.getElementById(`bs_excat_id_${domIdx}`)?.value;
          const bsVariacaoId = document.getElementById(`bs_exvarid_${domIdx}`)?.value;
          const bsEquipId    = document.getElementById(`bs_exequip_id_${domIdx}`)?.value;
          const bsGripId     = document.getElementById(`bs_exgrip_id_${domIdx}`)?.value;
          const bsMethodId   = document.getElementById(`bs_exmethod_id_${domIdx}`)?.value;
          const bsReps       = document.getElementById(`bs_reps_${domIdx}`)?.value;
          const bsPeso       = document.getElementById(`bs_peso_${domIdx}`)?.value;
          const bsDescanso   = document.getElementById(`bs_descanso_${domIdx}`)?.value;

          if (!catalogId) {
            showAlert(
              "treinosAlert",
              `Selecione o exercício no item ${i + 1}.`,
              "error",
            );
            return;
          }

          if (isBiset && !bsCatalogId) {
            showAlert(
              "treinosAlert",
              `O item ${i + 1} está marcado como Bi-set — selecione o 2º exercício.`,
              "error",
            );
            return;
          }

          if (isBiset && (!bsReps || Number(bsReps) < 1)) {
            showAlert(
              "treinosAlert",
              `Preencha as repetições do 2º exercício do Bi-set no item ${i + 1}.`,
              "error",
            );
            return;
          }

          if (
            !Number.isFinite(series) ||
            !Number.isFinite(reps) ||
            series < 1 ||
            reps < 1
          ) {
            showAlert(
              "treinosAlert",
              `Preencha séries e repetições válidas (maiores que 0) para o exercício ${i + 1}.`,
              "error",
            );
            return;
          }

          // UUID compartilhado para os exercícios do bi-set
          const bisetGroupId = isBiset ? crypto.randomUUID() : null;

          const variationLoop = variationIds.length ? variationIds : [null];
          const equipLoop = equipIds.length ? equipIds : [null];
          const gripLoop = gripIds.length ? gripIds : [null];
          const methodLoop = methodIds.length ? methodIds : [null];
          for (const variationId of variationLoop) {
            for (const equipId of equipLoop) {
              for (const gripId of gripLoop) {
                for (const methodId of methodLoop) {
                  exercises.push({
                    ...(variationId ? { exercise_variation_id: variationId } : {}),
                    ...(catalogId ? { exercise_catalog_id: catalogId } : {}),
                    ...(equipId ? { equipment_id: equipId } : {}),
                    ...(gripId ? { grip_footing_id: gripId } : {}),
                    ...(methodId ? { method_id: methodId } : {}),
                    target_sets: series,
                    target_reps: reps,
                    ...(peso !== "" && peso != null ? { target_weight: parseFloat(peso) } : {}),
                    order_index: orderCounter,
                    // No bi-set o descanso fica no 2º exercício; o 1º não tem descanso
                    ...(isBiset ? {} : (descanso ? { rest_seconds: parseInt(descanso) } : {})),
                    custom_description: customDesc || null,
                    ...(bisetGroupId ? { biset_group_id: bisetGroupId } : {}),
                  });
                  orderCounter += 1;
                }
              }
            }
          }

          // 2º exercício do bi-set: adicionado UMA ÚNICA VEZ fora do loop cartesiano,
          // pois o bi-set usa seleção simples (não multi-select) e compartilha o mesmo
          // bisetGroupId com TODOS os exercícios do 1º slot.
          if (isBiset && bsCatalogId) {
            exercises.push({
              ...(bsVariacaoId ? { exercise_variation_id: bsVariacaoId } : {}),
              exercise_catalog_id: bsCatalogId,
              ...(bsEquipId ? { equipment_id: bsEquipId } : {}),
              ...(bsGripId ? { grip_footing_id: bsGripId } : {}),
              ...(bsMethodId ? { method_id: bsMethodId } : {}),
              target_sets: series,
              target_reps: Number(bsReps),
              ...(bsPeso !== "" && bsPeso != null ? { target_weight: parseFloat(bsPeso) } : {}),
              order_index: orderCounter,
              ...(bsDescanso ? { rest_seconds: parseInt(bsDescanso) } : {}),
              custom_description: null,
              biset_group_id: bisetGroupId,
            });
            orderCounter += 1;
          }
        }

        const apiUrl =
          window.location.hostname === "localhost"
            ? "http://localhost:3333"
            : window.location.origin;

        const payload = {
          name: nome,
        };

        if (dataInicio) {
          payload.start_date = dataInicio;
        }

        if (exercises.length > 0) {
          payload.exercises = exercises;
        }

        const response = await fetch(`${apiUrl}/api/workouts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          showAlert(
            "treinosAlert",
            `Treino criado com sucesso!${exercises.length > 0 ? ` ${exercises.length} exercícios adicionados.` : ""}`,
            "success",
          );
          limparFormularioTreino();
          invalidateTab("treinos"); // garante que carregarTreinosAluno vai buscar dados frescos
          carregarTreinosAluno();
        } else {
          const errData = await response.json().catch(() => ({}));
          // Monta mensagem detalhada: usa errData.message ou serializa os erros de validação
          let errMsg = errData.message || "Erro ao criar treino";
          if (!errData.message && Array.isArray(errData)) {
            errMsg = errData.map(e => `${e.path?.join(".")}: ${e.message}`).join(" | ");
          }
          showAlert("treinosAlert", `Erro (${response.status}): ${errMsg}`, "error");
        }
      }

      async function carregarTreinosAluno() {
        // markTabLoaded é chamado APÓS o carregamento bem-sucedido (não antes)
        // para que invalidateTab() funcione corretamente
        try {
          const response = await fetch(`${getApiBaseUrl()}/api/workouts`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const treinos = await response.json();

          if (!treinos || treinos.length === 0) {
            document.getElementById("treinosLista").innerHTML =
              '<p style="color: #6b7280;">Nenhum treino cadastrado</p>';
            markTabLoaded("treinos");
            return;
          }

          // Exercícios já vêm incluídos na resposta — sem N+1
          document.getElementById("treinosLista").innerHTML = treinos
            .map((treino) => {
              const assignedLabel =
                treino.assigned_students && treino.assigned_students.length > 0
                  ? `${treino.assigned_students.length} aluno(s): ${escapeHtml(treino.assigned_students.join(", "))}`
                  : "Treino modelo (sem atribuicao)";

              const exercises = treino.exercises || [];
              const nextOrderIndex = exercises.length;

              return `
                <details id="tw_accordion_${treino.id}" class="workout-card workout-accordion" style="margin-bottom: 12px;">
                  <summary>
                    <span class="workout-summary-title">${escapeHtml(treino.name || "Treino")}</span>
                    <span class="accordion-summary-right">
                      <span class="workout-summary-validity">${assignedLabel}</span>
                      <span class="accordion-chevron" aria-hidden="true"></span>
                    </span>
                  </summary>

                  <div class="workout-accordion-body">
                    <div class="workout-meta">
                      <span>${assignedLabel}</span>
                    </div>
                    <div class="editor-grid">
                      <div class="form-group full">
                        <label>Nome do treino</label>
                        <input type="text" id="tab_w_name_${treino.id}" value="${escapeHtml(treino.name || "")}" />
                      </div>
                      <div class="form-group">
                        <label>Data de início</label>
                        <input type="date" id="tab_w_start_${treino.id}" value="${escapeHtml(treino.start_date || "")}" />
                      </div>
                    </div>
                    <div style="margin-top: 10px; margin-bottom: 10px;">
                      <h4 class="workout-section-title">Exerc&#237;cios do treino</h4>
                      ${
                        (() => {
                          const containerId = `tw_list_${treino.id}`;
                          if (exercises.length > 0) {
                            const sorted = [...exercises].sort((a, b) => a.order_index - b.order_index);

                            // Agrupar exercícios de bi-set pelo biset_group_id
                            const rendered = [];
                            const seenBisetGroups = new Set();

                            sorted.forEach((ex) => {
                              const groupId = ex.biset_group_id;

                              if (groupId && seenBisetGroups.has(groupId)) return; // 2º do par já foi incluído no bloco do 1º
                              if (groupId) seenBisetGroups.add(groupId);

                              const partner = groupId ? sorted.find(e => e.biset_group_id === groupId && e.workout_exercise_id !== ex.workout_exercise_id) : null;

                              const bisetBadge = groupId
                                ? `<span style="background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;margin-left:8px;vertical-align:middle;">BI-SET</span>`
                                : "";

                              const makeExerciseCard = (e, isSecond) => `
                                <div class="exercise-row${isSecond ? "" : ""}" draggable="${!isSecond}" data-we-id="${e.workout_exercise_id}" data-workout-id="${treino.id}" data-order="${e.order_index}"
                                     style="${isSecond ? "margin-top:0;border-top:1px dashed #86efac;border-radius:0 0 6px 6px;" : ""}">
                                  <p class="exercise-title">
                                    ${isSecond
                                      ? `<span style="font-size:11px;font-weight:700;color:#16a34a;margin-right:6px;">2º</span>`
                                      : `<span class="drag-handle" title="Arrastar para reordenar">&#9776;</span>`}
                                    &#127947; ${escapeHtml(e.name || "Exerc\u00edcio")}
                                    ${!isSecond ? bisetBadge : ""}
                                  </p>
                                  <p style="margin:4px 0; font-size:12px; color:#6b7280;">Descri&#231;&#227;o padr&#227;o: ${escapeHtml(e.description_default || e.description || "-")}</p>
                                  <div class="exercise-fields-grid">
                                    <div class="exercise-field">
                                      <label>S&#233;ries</label>
                                      <input type="number" min="1" id="tw_sets_${e.workout_exercise_id}" value="${escapeHtml(String(e.target_sets || ""))}" />
                                    </div>
                                    <div class="exercise-field">
                                      <label>Repeti&#231;&#245;es</label>
                                      <input type="number" min="1" id="tw_reps_${e.workout_exercise_id}" value="${escapeHtml(String(e.target_reps || ""))}" />
                                    </div>
                                    <div class="exercise-field">
                                      <label>Peso (kg)</label>
                                      <input type="number" min="0" step="0.1" id="tw_weight_${e.workout_exercise_id}" value="${escapeHtml(e.target_weight == null ? "" : String(e.target_weight))}" />
                                    </div>
                                    <input type="hidden" id="tw_order_${e.workout_exercise_id}" value="${escapeHtml(String(e.order_index || 0))}" />
                                    <div class="exercise-field">
                                      <label>Descanso (s)</label>
                                      <input type="number" min="0" max="3600" step="5" id="tw_rest_${e.workout_exercise_id}" value="${escapeHtml(e.rest_seconds == null ? "" : String(e.rest_seconds))}" placeholder="Ex: 60" />
                                    </div>
                                  </div>
                                  <div class="form-group" style="margin-top:8px;">
                                     <label>Orienta&#231;&#245;es/observa&#231;&#245;es</label>
                                     <textarea id="tw_desc_${e.workout_exercise_id}" rows="2" placeholder="Se vazio, usa a descri&#231;&#227;o padr&#227;o">${escapeHtml(e.custom_description || "")}</textarea>
                                  </div>
                                  <div class="exercise-actions">
                                    <button class="btn btn-secondary" onclick="salvarExercicioTreinoNaAba('${treino.id}','${e.workout_exercise_id}')">Salvar exerc&#237;cio</button>
                                    <button class="btn btn-danger" onclick="excluirExercicioTreinoNaAba('${treino.id}','${e.workout_exercise_id}')">Excluir exerc&#237;cio</button>
                                  </div>
                                </div>
                              `;

                              if (partner) {
                                // Bloco bi-set: envolve os dois exercícios num container verde
                                rendered.push(`
                                  <div class="exercise-row biset-group-wrapper"
                                       draggable="true"
                                       data-we-id="${ex.workout_exercise_id}"
                                       data-workout-id="${treino.id}"
                                       data-order="${ex.order_index}"
                                       style="padding:0;overflow:hidden;border:2px solid #16a34a;border-radius:8px;background:#f0fdf4;">
                                    ${makeExerciseCard(ex, false)}
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 12px;background:#dcfce7;border-top:1px solid #86efac;border-bottom:1px solid #86efac;">
                                      <span style="font-size:11px;color:#15803d;font-weight:600;">&#8595; Bi-set: executar em seguida sem descanso</span>
                                      <button type="button"
                                              onclick="desagruparBiset('${treino.id}','${ex.workout_exercise_id}','${partner.workout_exercise_id}')"
                                              title="Desagrupar: mantém ambos os exercícios como individuais"
                                              style="background:none;border:1px solid #16a34a;color:#15803d;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
                                        ✕ Desagrupar
                                      </button>
                                    </div>
                                    ${makeExerciseCard(partner, true)}
                                  </div>
                                `);
                              } else {
                                rendered.push(`
                                  <div class="exercise-row" draggable="true" data-we-id="${ex.workout_exercise_id}" data-workout-id="${treino.id}" data-order="${ex.order_index}">
                                    ${makeExerciseCard(ex, false).replace(/<div class="exercise-row[^"]*"[^>]*>/, "").replace(/<\/div>\s*$/, "")}
                                  </div>
                                `);
                              }
                            });

                            return `<div id="${containerId}" class="exercise-list-dnd">${rendered.join("")}</div>`;
                          } else {
                            // Sempre cria o container (mesmo vazio) para que adicionarExercicioTreinoNaAba possa injetar nele
                            return `<div id="${containerId}" class="exercise-list-dnd"></div><p id="tw_empty_${treino.id}" style="color:#6b7280;">Sem exerc&#237;cios neste treino.</p>`;
                          }
                        })()
                      }

                      <div style="margin-top: 12px; padding: 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;">
                        <h5 style="margin-bottom: 8px; color: #334155;">Adicionar exercício ao treino</h5>

                        <div class="workout-add-grid">
                          <div class="form-group" style="position: relative;">
                            <label>Grupo muscular <small style="font-weight:400;color:#6b7280;">(filtro opcional)</small></label>
                            <div style="position:relative;display:flex;align-items:center;">
                              <input
                                type="text"
                                id="tab_mg_search_${treino.id}"
                                placeholder="Opcional: clique para filtrar os grupos..."
                                autocomplete="off"
                                oninput="buscarGrupoMuscularEdicao('${treino.id}', this.value)"
                                onfocus="buscarGrupoMuscularEdicao('${treino.id}', this.value)"
                                style="padding-right:28px;width:100%;"
                              />
                              <button
                                type="button"
                                title="Limpar filtro de grupo muscular"
                                style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:2px 4px;"
                                onclick="limparFiltroGrupoMuscularEdicao('${treino.id}')"
                              >&times;</button>
                            </div>
                            <input type="hidden" id="tab_mg_id_${treino.id}" />
                            <div id="tab_mg_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                          </div>

                          <div class="form-group" style="position: relative;">
                            <label>Exercício</label>
                            <input
                              type="text"
                              id="tab_cat_search_${treino.id}"
                              placeholder="Digite para buscar exercício (grupo opcional)..."
                              autocomplete="off"
                              oninput="buscarCatalogoEdicao('${treino.id}', this.value)"
                              onfocus="buscarCatalogoEdicao('${treino.id}', this.value)"
                            />
                            <input type="hidden" id="tab_cat_id_${treino.id}" />
                            <div id="tab_cat_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                          </div>

                          <div class="workout-optional-grid full">
                            <div id="tab_equip_wrapper_${treino.id}" class="form-group" style="position:relative;">
                              <label>Equipamento <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                              <div id="tab_equip_tags_${treino.id}" class="tag-container"></div>
                              <input type="text" id="tab_equip_search_${treino.id}" placeholder="Digite para buscar equipamento..." autocomplete="off"
                                     oninput="buscarEquipamentoEdicao('${treino.id}', this.value)" onfocus="buscarEquipamentoEdicao('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_equip_id_${treino.id}" />
                              <input type="hidden" id="tab_equip_ids_${treino.id}" />
                              <div id="tab_equip_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>

                            <div id="tab_var_wrapper_${treino.id}" class="form-group" style="position:relative;">
                              <label>Execução <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                              <div id="tab_var_tags_${treino.id}" class="tag-container"></div>
                              <input type="text" id="tab_var_search_${treino.id}" placeholder="Digite para buscar execução..." autocomplete="off"
                                     oninput="buscarVariacaoEdicao('${treino.id}', this.value)" onfocus="buscarVariacaoEdicao('${treino.id}', this.value)" />
                              <div id="tab_var_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>

                            <div id="tab_grip_wrapper_${treino.id}" class="form-group" style="position:relative;">
                              <label>Pegada/Pisada <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                              <div id="tab_grip_tags_${treino.id}" class="tag-container"></div>
                              <input type="text" id="tab_grip_search_${treino.id}" placeholder="Digite para buscar pegada/pisada..." autocomplete="off"
                                     oninput="buscarPegadaPisadaEdicao('${treino.id}', this.value)" onfocus="buscarPegadaPisadaEdicao('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_grip_id_${treino.id}" />
                              <input type="hidden" id="tab_grip_ids_${treino.id}" />
                              <div id="tab_grip_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>

                            <div id="tab_method_wrapper_${treino.id}" class="form-group" style="position:relative;">
                              <label>Método <small style="font-weight:400;color:#6b7280;">(opcional)</small></label>
                              <div id="tab_method_tags_${treino.id}" class="tag-container"></div>
                              <input type="text" id="tab_method_search_${treino.id}" placeholder="Digite para buscar método..." autocomplete="off"
                                     oninput="buscarMetodoEdicao('${treino.id}', this.value)" onfocus="buscarMetodoEdicao('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_method_id_${treino.id}" />
                              <input type="hidden" id="tab_method_ids_${treino.id}" />
                              <div id="tab_method_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>
                          </div>

                          <div id="tab_meta_wrapper_${treino.id}" class="form-group full" style="display:block; margin-bottom:0;">
                            <label>Orienta&#231;&#245;es/observa&#231;&#245;es <small style="font-weight:400;color:#6b7280;">(edit&#225;vel)</small></label>
                            <textarea id="tab_desc_${treino.id}" rows="2" placeholder="Orienta&#231;&#245;es geradas pela IA..."></textarea>
                            <small id="tab_mg_${treino.id}" style="color:#6b7280;font-size:12px;"></small>
                          </div>

                          <div class="form-group full" style="margin-top:-2px; margin-bottom:0;">
                            <button type="button" class="btn btn-secondary" id="tab_ai_btn_${treino.id}" onclick="gerarDescricaoExercicioIAEdicao('${treino.id}')" disabled>Gerar descrição com IA</button>
                          </div>

                          <input type="hidden" id="tab_add_var_id_${treino.id}" />
                          <input type="hidden" id="tab_add_var_ids_${treino.id}" />

                          <div class="workout-metrics-grid full">
                          <div class="form-group">
                            <label>Séries</label>
                            <input type="number" min="0" id="tab_add_sets_${treino.id}" value="0" />
                          </div>
                          <div class="form-group">
                            <label>Repetições</label>
                            <input type="number" min="0" id="tab_add_reps_${treino.id}" value="0" />
                          </div>
                          <div class="form-group">
                            <label>Peso (kg)</label>
                            <input type="number" min="0" step="0.1" id="tab_add_weight_${treino.id}" value="0" />
                          </div>
                          <div class="form-group">
                            <label>Descanso (s)</label>
                            <input type="number" min="0" max="3600" step="5" id="tab_add_rest_${treino.id}" value="0" />
                          </div>
                          </div>
                        </div>

                        <!-- ── Bi-set na aba de edição ────────────────────── -->
                        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;">
                          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;color:#374151;">
                            <input type="checkbox" id="tab_biset_check_${treino.id}"
                                   onchange="toggleBisetAba('${treino.id}')"
                                   style="width:16px;height:16px;accent-color:#16a34a;cursor:pointer;" />
                            Combinar com outro exercício
                            <span style="background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:9999px;">BI-SET</span>
                          </label>
                        </div>

                        <div id="tab_biset_block_${treino.id}" style="display:none;margin-top:10px;padding:12px;background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;">
                          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                            <span style="background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:9999px;">BI-SET</span>
                            <span style="font-size:13px;color:#15803d;font-weight:500;">2º exercício</span>
                          </div>
                          <div class="workout-add-grid">
                            <div class="form-group" style="position:relative;">
                              <label>Exercício * <small style="color:#dc2626;">(obrigatório)</small></label>
                              <input type="text" id="tab_bs_cat_search_${treino.id}"
                                     placeholder="Digite para buscar o 2º exercício..."
                                     autocomplete="off"
                                     oninput="buscarCatalogoBisetAba('${treino.id}', this.value)"
                                     onfocus="buscarCatalogoBisetAba('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_bs_cat_id_${treino.id}" />
                              <div id="tab_bs_cat_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>
                            <div class="form-group" style="position:relative;">
                              <label>Execução <small style="color:#6b7280;">(opcional)</small></label>
                              <input type="text" id="tab_bs_var_search_${treino.id}"
                                     placeholder="Execução..."
                                     autocomplete="off"
                                     oninput="buscarVariacaoBisetAba('${treino.id}', this.value)"
                                     onfocus="buscarVariacaoBisetAba('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_bs_var_id_${treino.id}" />
                              <div id="tab_bs_var_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>
                          </div>
                          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:8px;">
                            <div class="form-group">
                              <label>Equipamento</label>
                              <input type="text" id="tab_bs_equip_search_${treino.id}" placeholder="Equipamento..."
                                     autocomplete="off"
                                     oninput="buscarEquipBisetAba('${treino.id}', this.value)"
                                     onfocus="buscarEquipBisetAba('${treino.id}', this.value)" />
                              <input type="hidden" id="tab_bs_equip_id_${treino.id}" />
                              <div id="tab_bs_equip_dropdown_${treino.id}" class="autocomplete-dropdown" style="display:none;"></div>
                            </div>
                            <div class="form-group">
                              <label>Repetições *</label>
                              <input type="number" min="1" id="tab_bs_reps_${treino.id}" placeholder="Ex: 12" />
                            </div>
                            <div class="form-group">
                              <label>Peso (kg)</label>
                              <input type="number" min="0" step="0.1" id="tab_bs_peso_${treino.id}" placeholder="Ex: 20" />
                            </div>
                            <div class="form-group">
                              <label>Descanso após (s)</label>
                              <input type="number" min="0" max="3600" step="5" id="tab_bs_descanso_${treino.id}" placeholder="Ex: 60" />
                            </div>
                            <input type="hidden" id="tab_bs_grip_id_${treino.id}" />
                            <input type="hidden" id="tab_bs_method_id_${treino.id}" />
                          </div>
                        </div>

                        <input type="hidden" id="tab_next_order_${treino.id}" value="${nextOrderIndex}" />

                        <button class="btn btn-secondary" onclick="adicionarExercicioTreinoNaAba('${treino.id}')">+ Adicionar Exercício</button>
                      </div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                      <button class="btn btn-primary" onclick="salvarTreinoNaAba('${treino.id}')">Salvar</button>
                      <button class="btn btn-danger" onclick="excluirTreinoNaAba('${treino.id}')">Excluir</button>
                    </div>
                  </div>
                </details>
              `;
            })
            .join("");
          setTimeout(initAllDndLists, 0);
          markTabLoaded("treinos"); // marcar APÓS render bem-sucedido
        } catch (error) {
          console.error("Erro ao carregar treinos:", error);
          document.getElementById("treinosLista").innerHTML =
            '<p style="color: #ef4444;">Erro ao carregar treinos</p>';
        }
      }

      async function salvarTreinoNaAba(workoutId) {
        try {
          const nome = document
            .getElementById(`tab_w_name_${workoutId}`)
            .value.trim();
          const payload = {
            name: nome,
            start_date:
              document.getElementById(`tab_w_start_${workoutId}`).value || null,
          };

          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro ao salvar treino");
          }

          // Atualizar o título no summary do accordion sem recarregar tudo
          const accordion = document.getElementById(`tw_accordion_${workoutId}`);
          const titleEl = accordion?.querySelector(".workout-summary-title");
          if (titleEl && nome) titleEl.textContent = nome;

          showAlert("treinosAlert", "Treino atualizado", "success");
          invalidateTab("treinos"); // próxima navegação forçará recarga
        } catch (error) {
          showAlert(
            "treinosAlert",
            error.message || "Erro ao salvar treino",
            "error",
          );
        }
      }

      async function excluirTreinoNaAba(workoutId) {
        const ok = await showConfirm("Deseja realmente excluir este treino?", {
          title: "Excluir treino",
          confirmLabel: "Excluir",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            },
          );

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || "Erro ao excluir treino");
          }

          showAlert("treinosAlert", "Treino excluído", "success");
          if (currentEditingStudentId) {
            await carregarDetalhesAlunoEditor(currentEditingStudentId);
          }
          await carregarTreinosAluno();
        } catch (error) {
          showAlert(
            "treinosAlert",
            error.message || "Erro ao excluir treino",
            "error",
          );
        }
      }

      async function salvarExercicioTreinoNaAba(workoutId, workoutExerciseId) {
        try {
          const payload = {
            target_sets: Number(
              document.getElementById(`tw_sets_${workoutExerciseId}`).value,
            ),
            target_reps: Number(
              document.getElementById(`tw_reps_${workoutExerciseId}`).value,
            ),
            target_weight:
              document.getElementById(`tw_weight_${workoutExerciseId}`)
                .value === ""
                ? null
                : Number(
                    document.getElementById(`tw_weight_${workoutExerciseId}`)
                      .value,
                  ),
            order_index: Number(
              document.getElementById(`tw_order_${workoutExerciseId}`)?.value ?? 0,
            ),
            rest_seconds:
              document.getElementById(`tw_rest_${workoutExerciseId}`).value ===
              ""
                ? null
                : Number(
                    document.getElementById(`tw_rest_${workoutExerciseId}`)
                      .value,
                  ),
            custom_description:
              document.getElementById(`tw_desc_${workoutExerciseId}`)?.value
                ?.trim() || null,
          };

          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/${workoutExerciseId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(payload),
            },
          );

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || "Erro ao salvar exercício");
          }

          // Não recarrega a lista inteira (mantém o accordion aberto)
          showAlert("treinosAlert", "Exercício atualizado", "success");
          invalidateTab("treinos"); // próxima navegação forçará recarga
        } catch (error) {
          showAlert(
            "treinosAlert",
            error.message || "Erro ao salvar exercício",
            "error",
          );
        }
      }

      async function excluirExercicioTreinoNaAba(workoutId, workoutExerciseId) {
        const ok = await showConfirm("Deseja excluir este exercício do treino?", {
          title: "Excluir exercício",
          confirmLabel: "Excluir",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/${workoutExerciseId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${authToken}`,
              },
            },
          );

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || "Erro ao excluir exercício");
          }

          // Remover o row do DOM diretamente (mantém accordion aberto)
          const row = document.querySelector(
            `[data-we-id="${workoutExerciseId}"][data-workout-id="${workoutId}"]`,
          );
          if (row) row.remove();

          showAlert("treinosAlert", "Exercício removido", "success");
          invalidateTab("treinos");
        } catch (error) {
          showAlert(
            "treinosAlert",
            error.message || "Erro ao excluir exercício",
            "error",
          );
        }
      }

      // Desagrupa um par de bi-set: remove biset_group_id de ambos, mantendo os exercícios
      async function desagruparBiset(workoutId, weIdA, weIdB) {
        if (!await showConfirm("Desagrupar o Bi-set? Os dois exercícios serão mantidos como exercícios individuais.", {
          title: "Desagrupar Bi-set",
          confirmLabel: "Desagrupar",
          variant: "safe",
        })) return;
        try {
          const patchBisetNull = async (weId) => {
            const res = await fetch(
              `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises/${weId}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({ biset_group_id: null }),
              },
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || `Erro ao desagrupar exercício ${weId}`);
            }
          };
          await patchBisetNull(weIdA);
          await patchBisetNull(weIdB);
          showAlert("treinosAlert", "Bi-set desagrupado. Os dois exercícios agora são individuais.", "success");
          invalidateTab("treinos");
          carregarTreinosAluno();
        } catch (error) {
          showAlert("treinosAlert", error.message || "Erro ao desagrupar bi-set", "error");
        }
      }

      const catalogoEdicaoBuscaTimeout = {};
      const variacaoEdicaoBuscaTimeout = {};
      const equipamentoEdicaoBuscaTimeout = {};
      const gripEdicaoBuscaTimeout = {};
      const methodEdicaoBuscaTimeout = {};
      const tabVarState = {};
      const tabEquipState = {};
      const tabGripState = {};
      const tabMethodState = {};

      function renderTabVarTags(workoutId) {
        const items = tabVarState[workoutId] || [];
        const el = document.getElementById(`tab_var_tags_${workoutId}`);
        if (el) el.innerHTML = items.map((item) =>
          `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeTabVarItem('${workoutId}','${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
        ).join("");
        const first = document.getElementById(`tab_add_var_id_${workoutId}`);
        if (first) first.value = items[0]?.id || "";
        const all = document.getElementById(`tab_add_var_ids_${workoutId}`);
        if (all) all.value = items.map((i) => i.id).join(",");
        updateIAButtonStateEdicao(workoutId);
      }

      function removeTabVarItem(workoutId, id) {
        tabVarState[workoutId] = (tabVarState[workoutId] || []).filter((i) => i.id !== id);
        renderTabVarTags(workoutId);
      }

      function renderTabEquipTags(workoutId) {
        const items = tabEquipState[workoutId] || [];
        const el = document.getElementById(`tab_equip_tags_${workoutId}`);
        if (el) el.innerHTML = items.map((item) =>
          `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeTabEquipItem('${workoutId}','${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
        ).join("");
        const first = document.getElementById(`tab_equip_id_${workoutId}`);
        if (first) first.value = items[0]?.id || "";
        const all = document.getElementById(`tab_equip_ids_${workoutId}`);
        if (all) all.value = items.map((i) => i.id).join(",");
        updateIAButtonStateEdicao(workoutId);
      }

      function removeTabEquipItem(workoutId, id) {
        tabEquipState[workoutId] = (tabEquipState[workoutId] || []).filter((i) => i.id !== id);
        renderTabEquipTags(workoutId);
      }

      function renderTabGripTags(workoutId) {
        const items = tabGripState[workoutId] || [];
        const el = document.getElementById(`tab_grip_tags_${workoutId}`);
        if (el) el.innerHTML = items.map((item) =>
          `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeTabGripItem('${workoutId}','${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
        ).join("");
        const first = document.getElementById(`tab_grip_id_${workoutId}`);
        if (first) first.value = items[0]?.id || "";
        const all = document.getElementById(`tab_grip_ids_${workoutId}`);
        if (all) all.value = items.map((i) => i.id).join(",");
      }

      function removeTabGripItem(workoutId, id) {
        tabGripState[workoutId] = (tabGripState[workoutId] || []).filter((i) => i.id !== id);
        renderTabGripTags(workoutId);
      }

      function renderTabMethodTags(workoutId) {
        const items = tabMethodState[workoutId] || [];
        const el = document.getElementById(`tab_method_tags_${workoutId}`);
        if (el) el.innerHTML = items.map((item) =>
          `<span class="tag-chip">${escapeHtml(item.name)}<button type="button" class="tag-remove" onclick="removeTabMethodItem('${workoutId}','${escapeHtml(item.id)}')" title="Remover">&times;</button></span>`
        ).join("");
        const first = document.getElementById(`tab_method_id_${workoutId}`);
        if (first) first.value = items[0]?.id || "";
        const all = document.getElementById(`tab_method_ids_${workoutId}`);
        if (all) all.value = items.map((i) => i.id).join(",");
      }

      function removeTabMethodItem(workoutId, id) {
        tabMethodState[workoutId] = (tabMethodState[workoutId] || []).filter((i) => i.id !== id);
        renderTabMethodTags(workoutId);
      }

      function updateIAButtonStateEdicao(workoutId) {
        const catalogId = document.getElementById(`tab_cat_id_${workoutId}`)?.value;
        const btn = document.getElementById(`tab_ai_btn_${workoutId}`);
        if (btn) btn.disabled = !catalogId;
      }

      async function buscarCatalogoEdicao(workoutId, termo) {
        if (catalogoEdicaoBuscaTimeout[workoutId]) clearTimeout(catalogoEdicaoBuscaTimeout[workoutId]);
        const dropdown = document.getElementById(`tab_cat_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        const state = getWorkoutSelectionState(workoutId);
        catalogoEdicaoBuscaTimeout[workoutId] = setTimeout(async () => {
          try {
            const params = new URLSearchParams();
            if (query) params.set("search", query);
            params.set("limit", "1000");
            if (state.groupId) params.set("muscle_group_id", state.groupId);
            const res = await fetch(
              `${getApiBaseUrl()}/api/exercise-catalog?${params.toString()}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) {
              dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum exercício encontrado.</div>';
              dropdown.style.display = "block";
              return;
            }
            dropdown.innerHTML = items.map(item => `
              <div class="autocomplete-item"
                   onclick="selecionarCatalogoEdicao('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.name).replace(/'/g, "\\'")}', '${escapeHtml(item.muscle_group_id || "")}', '${escapeHtml(item.muscle_group_name || "").replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                <strong>${escapeHtml(item.name)}</strong>
                ${item.notes ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(item.notes)}</div>` : ""}
              </div>
            `).join("");
            dropdown.style.display = "block";
          } catch (e) {
            dropdown.style.display = "none";
          }
        }, 250);
      }

      async function selecionarCatalogoEdicao(workoutId, catalogId, catalogName, groupId, groupName) {
        const catSearch = document.getElementById(`tab_cat_search_${workoutId}`);
        const catId = document.getElementById(`tab_cat_id_${workoutId}`);
        const catDropdown = document.getElementById(`tab_cat_dropdown_${workoutId}`);
        const mgSearch = document.getElementById(`tab_mg_search_${workoutId}`);
        const mgId = document.getElementById(`tab_mg_id_${workoutId}`);
        if (groupId && mgId) mgId.value = groupId;
        if (groupName && mgSearch) mgSearch.value = groupName;
        const state = getWorkoutSelectionState(workoutId);
        if (groupId) {
          state.groupId = groupId;
          state.groupName = groupName || state.groupName;
        }
        if (catSearch) catSearch.value = catalogName;
        if (catId) catId.value = catalogId;
        if (catDropdown) catDropdown.style.display = "none";
        tabVarState[workoutId] = [];
        tabEquipState[workoutId] = [];
        tabGripState[workoutId] = [];
        tabMethodState[workoutId] = [];
        renderTabVarTags(workoutId);
        renderTabEquipTags(workoutId);
        renderTabGripTags(workoutId);
        renderTabMethodTags(workoutId);
        const varSearch = document.getElementById(`tab_var_search_${workoutId}`);
        if (varSearch) varSearch.value = "";
        const equipSearch = document.getElementById(`tab_equip_search_${workoutId}`);
        if (equipSearch) equipSearch.value = "";
        const gripSearch = document.getElementById(`tab_grip_search_${workoutId}`);
        if (gripSearch) gripSearch.value = "";
        const methodSearch = document.getElementById(`tab_method_search_${workoutId}`);
        if (methodSearch) methodSearch.value = "";
        const equipWrapper = document.getElementById(`tab_equip_wrapper_${workoutId}`);
        if (equipWrapper) equipWrapper.style.display = "block";
        const varWrapper = document.getElementById(`tab_var_wrapper_${workoutId}`);
        if (varWrapper) varWrapper.style.display = "block";
        const gripWrapper = document.getElementById(`tab_grip_wrapper_${workoutId}`);
        if (gripWrapper) gripWrapper.style.display = "block";
        const methodWrapper = document.getElementById(`tab_method_wrapper_${workoutId}`);
        if (methodWrapper) methodWrapper.style.display = "block";
        const metaWrapper = document.getElementById(`tab_meta_wrapper_${workoutId}`);
        if (metaWrapper) metaWrapper.style.display = "block";
        updateIAButtonStateEdicao(workoutId);
      }

      async function buscarVariacaoEdicao(workoutId, termo) {
        if (variacaoEdicaoBuscaTimeout[workoutId]) clearTimeout(variacaoEdicaoBuscaTimeout[workoutId]);
        const dropdown = document.getElementById(`tab_var_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        variacaoEdicaoBuscaTimeout[workoutId] = setTimeout(async () => {
          try {
            const variationUrl = query
              ? `${getApiBaseUrl()}/api/exercise-variations?search=${encodeURIComponent(query)}&limit=1000`
              : `${getApiBaseUrl()}/api/exercise-variations?limit=1000`;
            const res = await fetch(
              variationUrl,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) {
              dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhuma execução encontrada.</div>';
              dropdown.style.display = "block";
              return;
            }
            dropdown.innerHTML = items.map(item => `
              <div class="autocomplete-item"
                   onclick="selecionarVariacaoEdicaoItem('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.name).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                <strong>${escapeHtml(item.name)}</strong>
              </div>
            `).join("");
            dropdown.style.display = "block";
          } catch (e) {
            dropdown.style.display = "none";
          }
        }, 250);
      }

      function selecionarVariacaoEdicaoItem(workoutId, variationId, variationName) {
        const varSearch = document.getElementById(`tab_var_search_${workoutId}`);
        if (varSearch) varSearch.value = "";
        const varDropdown = document.getElementById(`tab_var_dropdown_${workoutId}`);
        if (varDropdown) varDropdown.style.display = "none";
        if (!tabVarState[workoutId]) tabVarState[workoutId] = [];
        if (!tabVarState[workoutId].find((i) => i.id === variationId)) {
          tabVarState[workoutId].push({ id: variationId, name: variationName });
        }
        renderTabVarTags(workoutId);
      }

      async function buscarEquipamentoEdicao(workoutId, termo) {
        if (equipamentoEdicaoBuscaTimeout[workoutId]) clearTimeout(equipamentoEdicaoBuscaTimeout[workoutId]);
        const dropdown = document.getElementById(`tab_equip_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        equipamentoEdicaoBuscaTimeout[workoutId] = setTimeout(async () => {
          try {
            const equipmentUrl = query
              ? `${getApiBaseUrl()}/api/equipment-catalog?search=${encodeURIComponent(query)}&limit=1000`
              : `${getApiBaseUrl()}/api/equipment-catalog?limit=1000`;
            const res = await fetch(
              equipmentUrl,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.style.display = "none"; return; }
            dropdown.innerHTML = items.map(item => `
              <div class="autocomplete-item"
                   onclick="selecionarEquipamentoEdicaoItem('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.name).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.name)}
              </div>
            `).join("");
            dropdown.style.display = "block";
          } catch (e) {}
        }, 250);
      }

      function selecionarEquipamentoEdicaoItem(workoutId, equipId, equipName) {
        const search = document.getElementById(`tab_equip_search_${workoutId}`);
        if (search) search.value = "";
        const dropdown = document.getElementById(`tab_equip_dropdown_${workoutId}`);
        if (dropdown) dropdown.style.display = "none";
        if (!tabEquipState[workoutId]) tabEquipState[workoutId] = [];
        if (!tabEquipState[workoutId].find((i) => i.id === equipId)) {
          tabEquipState[workoutId].push({ id: equipId, name: equipName });
        }
        renderTabEquipTags(workoutId);
      }

      async function buscarPegadaPisadaEdicao(workoutId, termo) {
        if (gripEdicaoBuscaTimeout[workoutId]) clearTimeout(gripEdicaoBuscaTimeout[workoutId]);
        const dropdown = document.getElementById(`tab_grip_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        gripEdicaoBuscaTimeout[workoutId] = setTimeout(async () => {
          try {
            const gripUrl = query
              ? `${getApiBaseUrl()}/api/grip-footing-catalog?search=${encodeURIComponent(query)}&limit=1000`
              : `${getApiBaseUrl()}/api/grip-footing-catalog?limit=1000`;
            const res = await fetch(
              gripUrl,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.style.display = "none"; return; }
            dropdown.innerHTML = items.map(item => `
              <div class="autocomplete-item"
                   onclick="selecionarPegadaPisadaEdicaoItem('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.name).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.name)}
              </div>
            `).join("");
            dropdown.style.display = "block";
          } catch (e) {}
        }, 250);
      }

      function selecionarPegadaPisadaEdicaoItem(workoutId, gripId, gripName) {
        const search = document.getElementById(`tab_grip_search_${workoutId}`);
        if (search) search.value = "";
        const dropdown = document.getElementById(`tab_grip_dropdown_${workoutId}`);
        if (dropdown) dropdown.style.display = "none";
        if (!tabGripState[workoutId]) tabGripState[workoutId] = [];
        if (!tabGripState[workoutId].find((i) => i.id === gripId)) {
          tabGripState[workoutId].push({ id: gripId, name: gripName });
        }
        renderTabGripTags(workoutId);
      }

      async function buscarMetodoEdicao(workoutId, termo) {
        if (methodEdicaoBuscaTimeout[workoutId]) clearTimeout(methodEdicaoBuscaTimeout[workoutId]);
        const dropdown = document.getElementById(`tab_method_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        methodEdicaoBuscaTimeout[workoutId] = setTimeout(async () => {
          try {
            const methodUrl = query
              ? `${getApiBaseUrl()}/api/method-catalog?search=${encodeURIComponent(query)}&limit=1000`
              : `${getApiBaseUrl()}/api/method-catalog?limit=1000`;
            const res = await fetch(
              methodUrl,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.style.display = "none"; return; }
            dropdown.innerHTML = items.map(item => `
              <div class="autocomplete-item"
                   onclick="selecionarMetodoEdicaoItem('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.name).replace(/'/g, "\\'")}')"
                   onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                ${escapeHtml(item.name)}
              </div>
            `).join("");
            dropdown.style.display = "block";
          } catch (e) {}
        }, 250);
      }

      function selecionarMetodoEdicaoItem(workoutId, methodId, methodName) {
        const search = document.getElementById(`tab_method_search_${workoutId}`);
        if (search) search.value = "";
        const dropdown = document.getElementById(`tab_method_dropdown_${workoutId}`);
        if (dropdown) dropdown.style.display = "none";
        if (!tabMethodState[workoutId]) tabMethodState[workoutId] = [];
        if (!tabMethodState[workoutId].find((i) => i.id === methodId)) {
          tabMethodState[workoutId].push({ id: methodId, name: methodName });
        }
        renderTabMethodTags(workoutId);
      }

      // ── Bi-set na aba de edição de treino existente ──────────────────────────
      const tabBsBuscaTimeout = {};

      function toggleBisetAba(workoutId) {
        const checked = document.getElementById(`tab_biset_check_${workoutId}`)?.checked;
        const block   = document.getElementById(`tab_biset_block_${workoutId}`);
        if (!block) return;
        block.style.display = checked ? "block" : "none";
        if (!checked) {
          ["tab_bs_cat_search_","tab_bs_var_search_","tab_bs_equip_search_"].forEach(f => {
            const el = document.getElementById(`${f}${workoutId}`);
            if (el) el.value = "";
          });
          ["tab_bs_cat_id_","tab_bs_var_id_","tab_bs_equip_id_","tab_bs_grip_id_","tab_bs_method_id_"].forEach(f => {
            const el = document.getElementById(`${f}${workoutId}`);
            if (el) el.value = "";
          });
          ["tab_bs_reps_","tab_bs_peso_","tab_bs_descanso_"].forEach(f => {
            const el = document.getElementById(`${f}${workoutId}`);
            if (el) el.value = "";
          });
        }
      }

      function buscarCatalogoBisetAba(workoutId, termo) {
        const dropdown = document.getElementById(`tab_bs_cat_dropdown_${workoutId}`);
        if (!dropdown) return;
        clearTimeout(tabBsBuscaTimeout[`cat_${workoutId}`]);
        const query = (termo || "").trim();
        tabBsBuscaTimeout[`cat_${workoutId}`] = setTimeout(async () => {
          try {
            const params = new URLSearchParams();
            if (query) params.set("search", query);
            params.set("limit", "1000");
            const res = await fetch(`${getApiBaseUrl()}/api/exercise-catalog?${params.toString()}`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum exercício encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarCatalogoBisetAba('${escapeHtml(workoutId)}','${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 <strong>${escapeHtml(item.name)}</strong>
                 ${item.muscle_group_name ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">${escapeHtml(item.muscle_group_name)}</span>` : ""}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 300);
      }
      function selecionarCatalogoBisetAba(workoutId, id, name) {
        const search = document.getElementById(`tab_bs_cat_search_${workoutId}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`tab_bs_cat_id_${workoutId}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`tab_bs_cat_dropdown_${workoutId}`);
        if (dd) dd.style.display = "none";
      }

      function buscarVariacaoBisetAba(workoutId, termo) {
        const dropdown = document.getElementById(`tab_bs_var_dropdown_${workoutId}`);
        if (!dropdown) return;
        clearTimeout(tabBsBuscaTimeout[`var_${workoutId}`]);
        const query = (termo || "").trim();
        tabBsBuscaTimeout[`var_${workoutId}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/exercise-variations?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhuma execução encontrada.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarVariacaoBisetAba('${escapeHtml(workoutId)}','${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 300);
      }
      function selecionarVariacaoBisetAba(workoutId, id, name) {
        const search = document.getElementById(`tab_bs_var_search_${workoutId}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`tab_bs_var_id_${workoutId}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`tab_bs_var_dropdown_${workoutId}`);
        if (dd) dd.style.display = "none";
      }

      function buscarEquipBisetAba(workoutId, termo) {
        const dropdown = document.getElementById(`tab_bs_equip_dropdown_${workoutId}`);
        if (!dropdown) return;
        clearTimeout(tabBsBuscaTimeout[`equip_${workoutId}`]);
        const query = (termo || "").trim();
        tabBsBuscaTimeout[`equip_${workoutId}`] = setTimeout(async () => {
          try {
            const res = await fetch(`${getApiBaseUrl()}/api/equipment-catalog?search=${encodeURIComponent(query)}&limit=100`,
              { headers: { Authorization: `Bearer ${authToken}` } });
            if (!res.ok) return;
            const items = await res.json();
            if (!items.length) { dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhum equipamento encontrado.</div>'; dropdown.style.display = "block"; return; }
            dropdown.innerHTML = items.map(item =>
              `<div class="autocomplete-item"
                    onclick="selecionarEquipBisetAba('${escapeHtml(workoutId)}','${escapeHtml(item.id)}','${escapeHtml(item.name).replace(/'/g,"\\'")}')"
                    onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
                 ${escapeHtml(item.name)}
               </div>`
            ).join("");
            dropdown.style.display = "block";
          } catch(e) { dropdown.style.display = "none"; }
        }, 250);
      }
      function selecionarEquipBisetAba(workoutId, id, name) {
        const search = document.getElementById(`tab_bs_equip_search_${workoutId}`);
        if (search) search.value = name;
        const hidden = document.getElementById(`tab_bs_equip_id_${workoutId}`);
        if (hidden) hidden.value = id;
        const dd = document.getElementById(`tab_bs_equip_dropdown_${workoutId}`);
        if (dd) dd.style.display = "none";
      }

      async function gerarDescricaoExercicioIAEdicao(workoutId) {
        const catalogId = document.getElementById(`tab_cat_id_${workoutId}`)?.value;
        if (!catalogId) return;
        const varItems = tabVarState[workoutId] || [];
        const equipItems = tabEquipState[workoutId] || [];
        const gripItems = tabGripState[workoutId] || [];
        const methodItems = tabMethodState[workoutId] || [];
        const descArea = document.getElementById(`tab_desc_${workoutId}`);
        const mgSmall = document.getElementById(`tab_mg_${workoutId}`);
        if (!descArea) return;
        descArea.value = "";
        descArea.placeholder = "Gerando descrição com IA...";
        if (mgSmall) mgSmall.textContent = "";
        try {
          const res = await fetch(
            `${getApiBaseUrl()}/api/exercise-combos/generate-description`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({
                exercise_catalog_id: catalogId,
                exercise_variation_id: varItems[0]?.id || null,
                equipment_id: equipItems[0]?.id || null,
                grip_footing_id: gripItems[0]?.id || null,
                method_id: methodItems[0]?.id || null,
              }),
            },
          );
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Erro ${res.status}`);
          }
          const result = await res.json();
          descArea.value = result.description || "";
          descArea.placeholder = "Descrição gerada pela IA...";
          if (mgSmall) mgSmall.textContent = result.muscle_group_name ? `Grupo muscular: ${result.muscle_group_name}` : "";
        } catch (e) {
          descArea.placeholder = e?.message || "Erro ao gerar descrição.";
        }
      }

      async function adicionarExercicioTreinoNaAba(workoutId) {
        const variationIds = (document.getElementById(`tab_add_var_ids_${workoutId}`)?.value || "").split(",").filter(Boolean);
        const catalogId = document.getElementById(`tab_cat_id_${workoutId}`)?.value;
        const equipIds = (document.getElementById(`tab_equip_ids_${workoutId}`)?.value || "").split(",").filter(Boolean);
        const gripIds = (document.getElementById(`tab_grip_ids_${workoutId}`)?.value || "").split(",").filter(Boolean);
        const methodIds = (document.getElementById(`tab_method_ids_${workoutId}`)?.value || "").split(",").filter(Boolean);
        const targetSets = Number(
          document.getElementById(`tab_add_sets_${workoutId}`)?.value || 0,
        );
        const targetReps = Number(
          document.getElementById(`tab_add_reps_${workoutId}`)?.value || 0,
        );
        const orderIndex = Number(
          document.getElementById(`tab_next_order_${workoutId}`)?.value || 0,
        );

        if (!catalogId) {
          showAlert(
            "treinosAlert",
            "Selecione um exercício.",
            "error",
          );
          return;
        }

        if (!targetSets || !targetReps || targetSets < 1 || targetReps < 1) {
          showAlert(
            "treinosAlert",
            "Informe séries e repetições válidas.",
            "error",
          );
          return;
        }

        const weightRaw = document.getElementById(`tab_add_weight_${workoutId}`)?.value;
        const restRaw = document.getElementById(`tab_add_rest_${workoutId}`)?.value;
        const customDesc = document.getElementById(`tab_desc_${workoutId}`)?.value?.trim();

        // ── Bi-set na aba de edição ──
        const isBiset     = document.getElementById(`tab_biset_check_${workoutId}`)?.checked;
        const bsCatalogId = document.getElementById(`tab_bs_cat_id_${workoutId}`)?.value;
        const bsVariacaoId= document.getElementById(`tab_bs_var_id_${workoutId}`)?.value;
        const bsEquipId   = document.getElementById(`tab_bs_equip_id_${workoutId}`)?.value;
        const bsGripId    = document.getElementById(`tab_bs_grip_id_${workoutId}`)?.value;
        const bsMethodId  = document.getElementById(`tab_bs_method_id_${workoutId}`)?.value;
        const bsReps      = document.getElementById(`tab_bs_reps_${workoutId}`)?.value;
        const bsPeso      = document.getElementById(`tab_bs_peso_${workoutId}`)?.value;
        const bsDescanso  = document.getElementById(`tab_bs_descanso_${workoutId}`)?.value;

        if (isBiset && !bsCatalogId) {
          showAlert("treinosAlert", "Bi-set marcado — selecione o 2º exercício.", "error");
          return;
        }
        if (isBiset && (!bsReps || Number(bsReps) < 1)) {
          showAlert("treinosAlert", "Preencha as repetições do 2º exercício do Bi-set.", "error");
          return;
        }

        try {
          let localOrder = Number.isFinite(orderIndex) ? orderIndex : 0;
          const bisetGroupId = isBiset ? crypto.randomUUID() : null;
          const variationLoop = variationIds.length ? variationIds : [null];
          const equipLoop = equipIds.length ? equipIds : [null];
          const gripLoop = gripIds.length ? gripIds : [null];
          const methodLoop = methodIds.length ? methodIds : [null];
          for (const variationId of variationLoop) {
            for (const equipId of equipLoop) {
              for (const gripId of gripLoop) {
                for (const methodId of methodLoop) {
                  const payload = {
                    ...(variationId ? { exercise_variation_id: variationId } : {}),
                    ...(catalogId ? { exercise_catalog_id: catalogId } : {}),
                    ...(equipId ? { equipment_id: equipId } : {}),
                    ...(gripId ? { grip_footing_id: gripId } : {}),
                    ...(methodId ? { method_id: methodId } : {}),
                    target_sets: targetSets,
                    target_reps: targetReps,
                    ...(weightRaw !== "" && weightRaw != null ? { target_weight: Number(weightRaw) } : {}),
                    order_index: localOrder,
                    ...(isBiset ? {} : (restRaw !== "" && restRaw != null ? { rest_seconds: Number(restRaw) } : {})),
                    custom_description: customDesc || null,
                    ...(bisetGroupId ? { biset_group_id: bisetGroupId } : {}),
                  };
                  localOrder += 1;
                  const response = await fetch(
                    `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                      },
                      body: JSON.stringify(payload),
                    },
                  );

                  if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.message || "Erro ao adicionar exercício");
                  }

                  // 2º exercício do bi-set
                  if (isBiset && bsCatalogId) {
                    const bsPayload = {
                      ...(bsVariacaoId ? { exercise_variation_id: bsVariacaoId } : {}),
                      exercise_catalog_id: bsCatalogId,
                      ...(bsEquipId ? { equipment_id: bsEquipId } : {}),
                      ...(bsGripId ? { grip_footing_id: bsGripId } : {}),
                      ...(bsMethodId ? { method_id: bsMethodId } : {}),
                      target_sets: targetSets,
                      target_reps: Number(bsReps),
                      ...(bsPeso !== "" && bsPeso != null ? { target_weight: Number(bsPeso) } : {}),
                      order_index: localOrder,
                      ...(bsDescanso !== "" && bsDescanso != null ? { rest_seconds: Number(bsDescanso) } : {}),
                      custom_description: null,
                      biset_group_id: bisetGroupId,
                    };
                    localOrder += 1;
                    const bsResponse = await fetch(
                      `${getApiBaseUrl()}/api/workouts/${workoutId}/exercises`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                        body: JSON.stringify(bsPayload),
                      },
                    );
                    if (!bsResponse.ok) {
                      const err = await bsResponse.json().catch(() => ({}));
                      throw new Error(err.message || "Erro ao adicionar 2º exercício do Bi-set");
                    }
                  }
                }
              }
            }
          }

          // Reset cascade fields
          const catSearch = document.getElementById(`tab_cat_search_${workoutId}`);
          const catId = document.getElementById(`tab_cat_id_${workoutId}`);
          const varId = document.getElementById(`tab_add_var_id_${workoutId}`);
          const varIds = document.getElementById(`tab_add_var_ids_${workoutId}`);
          const varSearch = document.getElementById(`tab_var_search_${workoutId}`);
          const equipSearch = document.getElementById(`tab_equip_search_${workoutId}`);
          const gripSearch = document.getElementById(`tab_grip_search_${workoutId}`);
          const methodSearch = document.getElementById(`tab_method_search_${workoutId}`);
          const equipHidden = document.getElementById(`tab_equip_id_${workoutId}`);
          const equipIdsHidden = document.getElementById(`tab_equip_ids_${workoutId}`);
          const gripHidden = document.getElementById(`tab_grip_id_${workoutId}`);
          const gripIdsHidden = document.getElementById(`tab_grip_ids_${workoutId}`);
          const methodHidden = document.getElementById(`tab_method_id_${workoutId}`);
          const methodIdsHidden = document.getElementById(`tab_method_ids_${workoutId}`);
          const equipWrapper = document.getElementById(`tab_equip_wrapper_${workoutId}`);
          const varWrapper = document.getElementById(`tab_var_wrapper_${workoutId}`);
          const gripWrapper = document.getElementById(`tab_grip_wrapper_${workoutId}`);
          const methodWrapper = document.getElementById(`tab_method_wrapper_${workoutId}`);
          const metaWrapper = document.getElementById(`tab_meta_wrapper_${workoutId}`);
          if (catSearch) catSearch.value = "";
          if (catId) catId.value = "";
          if (varId) varId.value = "";
          if (varIds) varIds.value = "";
          if (varSearch) varSearch.value = "";
          if (equipSearch) equipSearch.value = "";
          if (gripSearch) gripSearch.value = "";
          if (methodSearch) methodSearch.value = "";
          if (equipHidden) equipHidden.value = "";
          if (equipIdsHidden) equipIdsHidden.value = "";
          if (gripHidden) gripHidden.value = "";
          if (gripIdsHidden) gripIdsHidden.value = "";
          if (methodHidden) methodHidden.value = "";
          if (methodIdsHidden) methodIdsHidden.value = "";
          tabVarState[workoutId] = [];
          tabEquipState[workoutId] = [];
          tabGripState[workoutId] = [];
          tabMethodState[workoutId] = [];
          renderTabVarTags(workoutId);
          renderTabEquipTags(workoutId);
          renderTabGripTags(workoutId);
          renderTabMethodTags(workoutId);
          if (equipWrapper) equipWrapper.style.display = "block";
          if (varWrapper) varWrapper.style.display = "block";
          if (gripWrapper) gripWrapper.style.display = "block";
          if (methodWrapper) methodWrapper.style.display = "block";
          if (metaWrapper) metaWrapper.style.display = "block";

          // Reset campos do bi-set
          const bisetCheck = document.getElementById(`tab_biset_check_${workoutId}`);
          if (bisetCheck) { bisetCheck.checked = false; toggleBisetAba(workoutId); }

          // Limpar campos numéricos e orientações que não eram resetados
          const setsInput   = document.getElementById(`tab_add_sets_${workoutId}`);
          const repsInput   = document.getElementById(`tab_add_reps_${workoutId}`);
          const weightInput = document.getElementById(`tab_add_weight_${workoutId}`);
          const restInput   = document.getElementById(`tab_add_rest_${workoutId}`);
          const descInput   = document.getElementById(`tab_desc_${workoutId}`);
          const mgSearch    = document.getElementById(`tab_mg_search_${workoutId}`);
          const mgId        = document.getElementById(`tab_mg_id_${workoutId}`);
          const mgDropdown  = document.getElementById(`tab_mg_dropdown_${workoutId}`);
          const mgSmall     = document.getElementById(`tab_mg_${workoutId}`);
          const aiBtn       = document.getElementById(`tab_ai_btn_${workoutId}`);
          if (setsInput)   setsInput.value   = "";
          if (repsInput)   repsInput.value   = "";
          if (weightInput) weightInput.value = "";
          if (restInput)   restInput.value   = "";
          if (descInput)   descInput.value   = "";
          if (mgSearch)    { mgSearch.value  = ""; }
          if (mgId)        { mgId.value      = ""; }
          if (mgDropdown)  { mgDropdown.style.display = "none"; }
          if (mgSmall)     { mgSmall.textContent = ""; }
          if (aiBtn)       { aiBtn.disabled  = true; }

          // Resetar estado do grupo muscular
          if (typeof tabWorkoutSelectionState !== "undefined" && tabWorkoutSelectionState[workoutId]) {
            tabWorkoutSelectionState[workoutId].groupId   = "";
            tabWorkoutSelectionState[workoutId].groupName = "";
          }

          const nextOrderInput = document.getElementById(`tab_next_order_${workoutId}`);
          if (nextOrderInput) {
            nextOrderInput.value = String(localOrder);
          }

          showAlert(
            "treinosAlert",
            "Exercício adicionado ao treino",
            "success",
          );

          // Injetar o novo exercício diretamente no DOM do accordion aberto,
          // sem recarregar toda a lista (o que fecharia o accordion).
          const listContainer = document.getElementById(`tw_list_${workoutId}`);
          if (listContainer) {
            // Remover mensagem "sem exercícios" se existir (dentro ou irmã do container)
            // IMPORTANTE: usar seletor específico para não remover o título do primeiro exercício
            const emptyMsgInside = listContainer.querySelector("p:not(.exercise-title)");
            if (emptyMsgInside) emptyMsgInside.remove();
            const emptyMsgSibling = document.getElementById(`tw_empty_${workoutId}`);
            if (emptyMsgSibling) emptyMsgSibling.remove();

            // Buscar os dados do último exercício adicionado para montar o HTML
            const weRes = await fetch(`${getApiBaseUrl()}/api/workouts/${workoutId}/exercises`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            if (weRes.ok) {
              const exercises = await weRes.json();
              const newest = [...exercises].sort((a, b) => (b.order_index ?? 0) - (a.order_index ?? 0))[0];
              if (newest) {
                const weId = newest.workout_exercise_id;
                const newRow = document.createElement("div");
                newRow.className = "exercise-row";
                newRow.draggable = true;
                newRow.setAttribute("data-we-id", weId);
                newRow.setAttribute("data-workout-id", workoutId);
                newRow.setAttribute("data-order", String(newest.order_index ?? 0));
                newRow.innerHTML = `
                  <p class="exercise-title"><span class="drag-handle" title="Arrastar para reordenar">&#9776;</span>&#127947; ${escapeHtml(newest.name || "Exercício")}</p>
                  <p style="margin:4px 0; font-size:12px; color:#6b7280;">Descrição padrão: ${escapeHtml(newest.description_default || newest.description || "-")}</p>
                  <div class="exercise-fields-grid">
                    <div class="exercise-field">
                      <label>Séries</label>
                      <input type="number" min="1" id="tw_sets_${weId}" value="${escapeHtml(String(newest.target_sets || ""))}" />
                    </div>
                    <div class="exercise-field">
                      <label>Repetições</label>
                      <input type="number" min="1" id="tw_reps_${weId}" value="${escapeHtml(String(newest.target_reps || ""))}" />
                    </div>
                    <div class="exercise-field">
                      <label>Peso (kg)</label>
                      <input type="number" min="0" step="0.1" id="tw_weight_${weId}" value="${escapeHtml(newest.target_weight == null ? "" : String(newest.target_weight))}" />
                    </div>
                    <input type="hidden" id="tw_order_${weId}" value="${escapeHtml(String(newest.order_index || 0))}" />
                    <div class="exercise-field">
                      <label>Descanso (s)</label>
                      <input type="number" min="0" max="3600" step="5" id="tw_rest_${weId}" value="${escapeHtml(newest.rest_seconds == null ? "" : String(newest.rest_seconds))}" placeholder="Ex: 60" />
                    </div>
                  </div>
                  <div class="form-group" style="margin-top:8px;">
                    <label>Orientações/observações</label>
                    <textarea id="tw_desc_${weId}" rows="2" placeholder="Se vazio, usa a descrição padrão">${escapeHtml(newest.custom_description || "")}</textarea>
                  </div>
                  <div class="exercise-actions">
                    <button class="btn btn-secondary" onclick="salvarExercicioTreinoNaAba('${workoutId}','${weId}')">Salvar exercício</button>
                    <button class="btn btn-danger" onclick="excluirExercicioTreinoNaAba('${workoutId}','${weId}')">Excluir exercício</button>
                  </div>`;
                listContainer.appendChild(newRow);
                // Reinicializar drag-and-drop para o novo item
                setTimeout(() => initDndList(`tw_list_${workoutId}`), 0);
              }
            }
          }
        } catch (error) {
          showAlert(
            "treinosAlert",
            error.message || "Erro ao adicionar exercício",
            "error",
          );
        }
      }

      const tabComboTreeState = {
        loaded: false,
        rows: [],
        loading: null,
      };
      const tabWorkoutSelectionState = {};

      function normalizeComboSearch(input) {
        return String(input || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
      }

      function getWorkoutSelectionState(workoutId) {
        if (!tabWorkoutSelectionState[workoutId]) {
          tabWorkoutSelectionState[workoutId] = {
            groupId: "",
            groupName: "",
            exerciseId: "",
            exerciseName: "",
          };
        }
        return tabWorkoutSelectionState[workoutId];
      }

      async function carregarComboTreeEdicao() {
        if (tabComboTreeState.loaded) return tabComboTreeState.rows;
        if (tabComboTreeState.loading) return tabComboTreeState.loading;

        tabComboTreeState.loading = (async () => {
          const response = await fetch(
            `${getApiBaseUrl()}/api/exercise-combos/tree?limit=5000`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );

          if (response.status === 401) {
            handleUnauthorized();
            return [];
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const rows = (await response.json()) || [];
          tabComboTreeState.rows = rows;
          tabComboTreeState.loaded = true;
          return rows;
        })();

        try {
          return await tabComboTreeState.loading;
        } finally {
          tabComboTreeState.loading = null;
        }
      }

      function getComboRowsForWorkout(workoutId, field) {
        const state = getWorkoutSelectionState(workoutId);
        const rows = tabComboTreeState.rows || [];
        return rows.filter((row) => {
          if (field !== "group" && state.groupId && row.muscle_group_id !== state.groupId) {
            return false;
          }
          if (field !== "exercise" && state.exerciseId && row.exercise_catalog_id !== state.exerciseId) {
            return false;
          }
          return true;
        });
      }

      function renderComboDropdown(dropdown, items, renderItem) {
        if (!dropdown) return;
        if (!items.length) {
          dropdown.innerHTML = '<div style="padding:10px;color:#6b7280;">Nenhuma opção disponível.</div>';
          dropdown.style.display = "block";
          return;
        }

        dropdown.innerHTML = items.map(renderItem).join("");
        dropdown.style.display = "block";
      }

      function uniqueComboOptions(rows, getId, getLabel, extra = {}) {
        const seen = new Map();
        for (const row of rows) {
          const id = getId(row);
          const label = getLabel(row);
          if (!id || !label || seen.has(id)) continue;
          seen.set(id, { id, label, row, ...extra });
        }
        return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      }

      function resetComboFields(workoutId, fromField) {
        const clearInput = (id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        };
        const clearHidden = (id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        };
        const hideDropdown = (id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = "none";
        };

        if (fromField === "group") {
          clearInput(`tab_cat_search_${workoutId}`);
          clearHidden(`tab_cat_id_${workoutId}`);
          clearInput(`tab_var_search_${workoutId}`);
          clearInput(`tab_equip_search_${workoutId}`);
          clearInput(`tab_grip_search_${workoutId}`);
          clearInput(`tab_method_search_${workoutId}`);
          clearHidden(`tab_equip_id_${workoutId}`);
          clearHidden(`tab_equip_ids_${workoutId}`);
          clearHidden(`tab_grip_id_${workoutId}`);
          clearHidden(`tab_grip_ids_${workoutId}`);
          clearHidden(`tab_method_id_${workoutId}`);
          clearHidden(`tab_method_ids_${workoutId}`);
          tabVarState[workoutId] = [];
          tabEquipState[workoutId] = [];
          tabGripState[workoutId] = [];
          tabMethodState[workoutId] = [];
        }

        if (fromField === "exercise") {
          clearInput(`tab_var_search_${workoutId}`);
          clearInput(`tab_equip_search_${workoutId}`);
          clearInput(`tab_grip_search_${workoutId}`);
          clearInput(`tab_method_search_${workoutId}`);
          clearHidden(`tab_equip_id_${workoutId}`);
          clearHidden(`tab_equip_ids_${workoutId}`);
          clearHidden(`tab_grip_id_${workoutId}`);
          clearHidden(`tab_grip_ids_${workoutId}`);
          clearHidden(`tab_method_id_${workoutId}`);
          clearHidden(`tab_method_ids_${workoutId}`);
          tabVarState[workoutId] = [];
          tabEquipState[workoutId] = [];
          tabGripState[workoutId] = [];
          tabMethodState[workoutId] = [];
        }

        if (fromField === "variation") {
          clearInput(`tab_equip_search_${workoutId}`);
          clearInput(`tab_grip_search_${workoutId}`);
          clearInput(`tab_method_search_${workoutId}`);
          clearHidden(`tab_equip_id_${workoutId}`);
          clearHidden(`tab_equip_ids_${workoutId}`);
          clearHidden(`tab_grip_id_${workoutId}`);
          clearHidden(`tab_grip_ids_${workoutId}`);
          clearHidden(`tab_method_id_${workoutId}`);
          clearHidden(`tab_method_ids_${workoutId}`);
          tabEquipState[workoutId] = [];
          tabGripState[workoutId] = [];
          tabMethodState[workoutId] = [];
        }

        if (fromField === "equipment") {
          clearInput(`tab_grip_search_${workoutId}`);
          clearInput(`tab_method_search_${workoutId}`);
          clearHidden(`tab_grip_id_${workoutId}`);
          clearHidden(`tab_grip_ids_${workoutId}`);
          clearHidden(`tab_method_id_${workoutId}`);
          clearHidden(`tab_method_ids_${workoutId}`);
          tabGripState[workoutId] = [];
          tabMethodState[workoutId] = [];
        }

        if (fromField === "grip") {
          clearInput(`tab_method_search_${workoutId}`);
          clearHidden(`tab_method_id_${workoutId}`);
          clearHidden(`tab_method_ids_${workoutId}`);
          tabMethodState[workoutId] = [];
        }

        hideDropdown(`tab_cat_dropdown_${workoutId}`);
        hideDropdown(`tab_var_dropdown_${workoutId}`);
        hideDropdown(`tab_equip_dropdown_${workoutId}`);
        hideDropdown(`tab_grip_dropdown_${workoutId}`);
        hideDropdown(`tab_method_dropdown_${workoutId}`);

        renderTabVarTags(workoutId);
        renderTabEquipTags(workoutId);
        renderTabGripTags(workoutId);
        renderTabMethodTags(workoutId);
        updateIAButtonStateEdicao(workoutId);
      }

      async function buscarGrupoMuscularEdicao(workoutId, termo) {
        const dropdown = document.getElementById(`tab_mg_dropdown_${workoutId}`);
        if (!dropdown) return;
        const query = normalizeComboSearch(termo || "");
        try {
          const params = new URLSearchParams();
          if (query) params.set("search", query);
          params.set("limit", "1000");
          const response = await fetch(
            `${getApiBaseUrl()}/api/muscle-groups?${params.toString()}`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          if (!response.ok) return;
          const items = await response.json();
          const options = (Array.isArray(items) ? items : [])
            .map((item) => ({ id: item.id, label: item.name }))
            .filter((item) => !query || normalizeComboSearch(item.label).includes(query));

          renderComboDropdown(dropdown, options, (item) => `
            <div class="autocomplete-item"
                 onclick="selecionarGrupoMuscularEdicaoItem('${workoutId}', '${escapeHtml(item.id)}', '${escapeHtml(item.label).replace(/'/g, "\\'")}')"
                 onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">
              <strong>${escapeHtml(item.label)}</strong>
            </div>
          `);
        } catch (error) {
          dropdown.style.display = "none";
        }
      }

      function selecionarGrupoMuscularEdicaoItem(workoutId, groupId, groupName) {
        const search = document.getElementById(`tab_mg_search_${workoutId}`);
        const hidden = document.getElementById(`tab_mg_id_${workoutId}`);
        const dropdown = document.getElementById(`tab_mg_dropdown_${workoutId}`);
        if (search) search.value = groupName;
        if (hidden) hidden.value = groupId;
        if (dropdown) dropdown.style.display = "none";
        const state = getWorkoutSelectionState(workoutId);
        state.groupId = groupId;
        state.groupName = groupName;
        state.exerciseId = "";
        state.exerciseName = "";
        resetComboFields(workoutId, "group");
      }

      function limparFiltroGrupoMuscularEdicao(workoutId) {
        const search = document.getElementById(`tab_mg_search_${workoutId}`);
        const hidden = document.getElementById(`tab_mg_id_${workoutId}`);
        const dropdown = document.getElementById(`tab_mg_dropdown_${workoutId}`);
        if (search) { search.value = ""; }
        if (hidden) { hidden.value = ""; }
        if (dropdown) { dropdown.style.display = "none"; }

        const state = getWorkoutSelectionState(workoutId);
        state.groupId = "";
        state.groupName = "";
        state.exerciseId = "";
        state.exerciseName = "";

        resetComboFields(workoutId, "group");
        // Reabrir dropdown de exercício sem filtro de grupo
        buscarCatalogoEdicao(workoutId, document.getElementById(`tab_cat_search_${workoutId}`)?.value || "");
      }

      async function verificarStatusWhatsApp() {
        const headerStatus = document.getElementById("headerWhatsAppStatus");
        if (!headerStatus || !authToken || isAdminSession) {
          return;
        }

        try {
          const response = await fetch(
            `${getApiBaseUrl()}/api/personal/connection/status`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              handleUnauthorized();
              return;
            }
            throw new Error(`Erro HTTP ${response.status}`);
          }

          const data = await response.json();

          const isConnected = data.state === "open";
          const statusClass = isConnected ? "connected" : "disconnected";
          const statusText = isConnected ? "Conectado" : "Desconectado";

          // Update header indicator
          headerStatus.className = `whatsapp-status-indicator ${statusClass}`;
          headerStatus.innerHTML = `
            <span class="status-dot ${statusClass}"></span>
            <span>Bot: ${statusText}</span>
          `;

          // Show/hide buttons based on connection status
          const connectBtn = document.getElementById("connectBtn");
          const disconnectBtn = document.getElementById("disconnectBtn");
          if (connectBtn && disconnectBtn) {
            if (isConnected) {
              connectBtn.style.display = "none";
              disconnectBtn.style.display = "block";
              document
                .getElementById("qrCodeContainer")
                ?.classList.add("hidden");
            } else {
              connectBtn.style.display = "block";
              disconnectBtn.style.display = "none";
            }
          }
        } catch (error) {
          headerStatus.className = "whatsapp-status-indicator disconnected";
          headerStatus.innerHTML = `
            <span class="status-dot disconnected"></span>
            <span>Bot: indisponível</span>
          `;
        }
      }

      // Auto-refresh WhatsApp status every 10 seconds
      let statusInterval;
      function startStatusMonitoring() {
        verificarStatusWhatsApp();
        if (statusInterval) clearInterval(statusInterval);
        statusInterval = setInterval(verificarStatusWhatsApp, 30000); // 30s (era 10s)
      }

      function stopStatusMonitoring() {
        if (statusInterval) {
          clearInterval(statusInterval);
          statusInterval = null;
        }
      }

      async function gerarQRCode() {
        try {
          const apiUrl =
            window.location.hostname === "localhost"
              ? "http://localhost:3333"
              : window.location.origin;

          // Check connection status first
          const statusResp = await fetch(
            `${apiUrl}/api/personal/connection/status`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
          const statusData = await statusResp.json();

          if (statusData.state === "open") {
            const container = document.getElementById("qrCodeContainer");
            container.classList.remove("hidden");
            container.innerHTML = `
              <div style="padding: 20px; background: rgba(115, 213, 55, 0.2); border-radius: 8px; margin-top: 15px;">
                <h3 style="color: #024d3a; margin-bottom: 10px;">&#9989; WhatsApp Já Conectado</h3>
                <p style="color: #047857;">Seu WhatsApp já está conectado e funcionando.</p>
                <p style="color: #047857; margin-top: 8px; font-size: 14px;">Se quiser reconectar, clique em "Desconectar" primeiro.</p>
              </div>
            `;
            return;
          }

          const response = await fetch(
            `${apiUrl}/api/personal/connection/qrcode`,
            {
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );
          const data = await response.json();

          const container = document.getElementById("qrCodeContainer");
          container.classList.remove("hidden");

          const normalizeQrImage = (value) => {
            if (typeof value !== "string") return null;
            const trimmed = value.trim();
            if (!trimmed) return null;
            if (trimmed.startsWith("data:image/")) return trimmed;
            if (/^[A-Za-z0-9+/=\n\r]+$/.test(trimmed) && trimmed.length > 100) {
              return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
            }
            return null;
          };

          const qrImage =
            normalizeQrImage(data.base64) ||
            normalizeQrImage(data.qrcode) ||
            normalizeQrImage(data.code);

          if (qrImage) {
            container.innerHTML = `
              <div style="margin-top: 20px;">
                <h3>Escaneie o QR Code com seu WhatsApp</h3>
                <img src="${qrImage}" alt="QR Code">
                <p style="color: #6b7280;">Abra o WhatsApp > Aparelhos conectados > Conectar aparelho</p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 10px;">O QR Code expira em alguns segundos. Atualize se necessário.</p>
              </div>
            `;

            // Auto-refresh status after showing QR code
            setTimeout(() => verificarStatusWhatsApp(), 3000);
          } else if (data.pairingCode || data.code) {
            const pairingCode = data.pairingCode || data.code;
            container.innerHTML = `
              <div style="padding: 20px; background: #eff6ff; border-radius: 8px; margin-top: 15px;">
                <h3 style="color: #1e40af; margin-bottom: 10px;">Use o Código de Pareamento</h3>
                <p style="color: #1e3a8a; font-size: 28px; letter-spacing: 2px; font-weight: 700; margin: 8px 0;">${pairingCode}</p>
                <p style="color: #1e40af;">No WhatsApp, vá em Aparelhos conectados e informe este código.</p>
              </div>
            `;
          } else {
            container.innerHTML =
              '<p style="color: #ef4444;">Erro ao gerar QR Code. Tente novamente.</p>';
          }
        } catch (error) {
          const container = document.getElementById("qrCodeContainer");
          container.classList.remove("hidden");
          container.innerHTML =
            '<p style="color: #ef4444;">Erro ao conectar com a Evolution API. Verifique a configuração.</p>';
        }
      }

      async function desconectarWhatsApp() {
        const ok = await showConfirm("Deseja desconectar o WhatsApp? O bot ficará offline até uma nova conexão.", {
          title: "Desconectar WhatsApp",
          confirmLabel: "Desconectar",
          variant: "danger",
        });
        if (!ok) return;

        try {
          const apiUrl =
            window.location.hostname === "localhost"
              ? "http://localhost:3333"
              : window.location.origin;

          const response = await fetch(
            `${apiUrl}/api/personal/connection/logout`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${authToken}` },
            },
          );

          if (response.ok) {
            showToast("WhatsApp desconectado com sucesso!", "success");
            verificarStatusWhatsApp();
          } else {
            showToast("Erro ao desconectar. Tente novamente.", "error");
          }
        } catch (error) {
          showToast("Erro ao desconectar WhatsApp.", "error");
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // SISTEMA DE NOTIFICAÇÕES CENTRALIZADO
      // ═══════════════════════════════════════════════════════════════════

      const TOAST_ICONS = {
        success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        error:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        info:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        warn:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      };

      /**
       * Exibe um toast centralizado no topo da tela.
       * @param {string} message - Texto da mensagem
       * @param {"success"|"error"|"info"|"warn"} type - Tipo da notificação
       * @param {number} [duration=4000] - Tempo em ms antes de fechar (0 = não fecha)
       */
      function showToast(message, type, duration) {
        const safeType = ["success", "error", "info", "warn"].includes(type) ? type : "info";
        const ms = duration !== undefined ? duration : (safeType === "error" ? 5000 : 4000);

        const container = document.getElementById("toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast toast-${safeType}`;
        toast.style.setProperty("--toast-duration", `${ms}ms`);
        toast.setAttribute("role", "status");
        toast.innerHTML = `
          <span class="toast-icon">${TOAST_ICONS[safeType]}</span>
          <span class="toast-text">${escapeHtml(message)}</span>
          <button class="toast-close" aria-label="Fechar" onclick="this.parentElement._closeToast()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;

        let timer = null;
        toast._closeToast = function () {
          if (timer) clearTimeout(timer);
          toast.classList.add("toast-out");
          toast.addEventListener("animationend", () => toast.remove(), { once: true });
        };

        container.appendChild(toast);

        if (ms > 0) {
          timer = setTimeout(() => toast._closeToast(), ms);
        }
      }

      /**
       * Compatibilidade retroativa: redireciona showAlert para showToast.
       * O elementId é ignorado — o toast é sempre centralizado.
       */
      function showAlert(elementId, message, type) {
        const toastType = type === "success" ? "success" : type === "error" ? "error" : "info";
        showToast(message, toastType);
      }

      // ── Modal de confirmação (substitui confirm() nativo) ──────────────────

      let _confirmResolve = null;

      /**
       * Exibe um modal de confirmação centralizado.
       * @param {string} message - Mensagem de confirmação
       * @param {object} [options]
       * @param {string} [options.title] - Título do modal
       * @param {string} [options.confirmLabel] - Label do botão de confirmar
       * @param {string} [options.cancelLabel] - Label do botão de cancelar
       * @param {"danger"|"safe"} [options.variant] - Estilo do botão confirmar
       * @returns {Promise<boolean>} true se confirmado, false se cancelado
       */
      function showConfirm(message, options) {
        const opts = options || {};
        const title        = opts.title        || "Confirmar ação";
        const confirmLabel = opts.confirmLabel || "Confirmar";
        const cancelLabel  = opts.cancelLabel  || "Cancelar";
        const variant      = opts.variant === "safe" ? "safe" : "danger";

        return new Promise(function(resolve) {
          // Cancela qualquer confirm anterior pendente
          if (_confirmResolve) _confirmResolve(false);
          _confirmResolve = resolve;

          const modal    = document.getElementById("confirmModal");
          const titleEl  = document.getElementById("confirmModalTitle");
          const msgEl    = document.getElementById("confirmModalMessage");
          const iconWrap = document.getElementById("confirmModalIconWrap");
          const confirmBtn = document.getElementById("confirmModalConfirm");
          const cancelBtn  = document.getElementById("confirmModalCancel");

          if (!modal) { resolve(false); return; }

          titleEl.textContent  = title;
          msgEl.textContent    = message;
          confirmBtn.textContent = confirmLabel;
          cancelBtn.textContent  = cancelLabel;

          // Ícone
          if (variant === "danger") {
            iconWrap.className = "confirm-modal-icon-wrap confirm-modal-icon-danger";
            iconWrap.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
            confirmBtn.className = "confirm-modal-btn confirm-modal-btn-confirm";
          } else {
            iconWrap.className = "confirm-modal-icon-wrap confirm-modal-icon-warn";
            iconWrap.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
            confirmBtn.className = "confirm-modal-btn confirm-modal-btn-confirm safe";
          }

          function handleConfirm() {
            close(true);
          }
          function handleCancel() {
            close(false);
          }
          function handleBackdrop(e) {
            if (e.target === modal) close(false);
          }
          function handleKey(e) {
            if (e.key === "Escape") close(false);
            if (e.key === "Enter")  close(true);
          }

          function close(result) {
            modal.classList.remove("open");
            confirmBtn.removeEventListener("click", handleConfirm);
            cancelBtn.removeEventListener("click",  handleCancel);
            modal.removeEventListener("click", handleBackdrop);
            document.removeEventListener("keydown", handleKey);
            _confirmResolve = null;
            resolve(result);
          }

          confirmBtn.addEventListener("click", handleConfirm);
          cancelBtn.addEventListener("click",  handleCancel);
          modal.addEventListener("click", handleBackdrop);
          document.addEventListener("keydown", handleKey);

          modal.classList.add("open");
          // Foco no botão de cancelar por segurança
          setTimeout(() => cancelBtn.focus(), 50);
        });
      }

      function showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
          el.textContent = message;
          el.classList.remove("hidden");
        }
      }

      // ============================================
      // FUNÇÕES DE CONFIGURAÇÃO
      // ============================================

      async function carregarConfiguracoes() {
        try {
          // Carregar dados do personal
          if (personalData) {
            document.getElementById("configNome").textContent =
              personalData.name || "-";
            document.getElementById("configEmail").textContent =
              personalData.email || "-";
          }
        } catch (error) {
          console.error("Erro ao carregar configurações:", error);
        }
      }
