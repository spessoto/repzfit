# Script de reversao - Configuracao Gemini API
# Remove a implementacao complexa e mantem apenas .env

Write-Host "Iniciando reversao da configuracao Gemini..." -ForegroundColor Cyan

# 1. Backup dos arquivos que serao modificados
Write-Host "`nCriando backups..." -ForegroundColor Yellow
Copy-Item "src\routes\api\personal.ts" "src\routes\api\personal.ts.backup" -ErrorAction SilentlyContinue
Copy-Item "public\index.html" "public\index.html.backup" -ErrorAction SilentlyContinue
Copy-Item ".env.example" ".env.example.backup" -ErrorAction SilentlyContinue
Write-Host "Backups criados" -ForegroundColor Green

# 2. Remover endpoint do personal.ts
Write-Host "`nModificando src\routes\api\personal.ts..." -ForegroundColor Yellow
$personalContent = Get-Content "src\routes\api\personal.ts" -Raw -Encoding UTF8
$pattern = '(?s)\s+app\.patch\("/personal/config"[^\}]*\}\);'
$personalContent = $personalContent -replace $pattern, ''
Set-Content "src\routes\api\personal.ts" $personalContent -NoNewline -Encoding UTF8
Write-Host "Endpoint removido" -ForegroundColor Green

# 3. Modificar index.html
Write-Host "`nModificando public\index.html..." -ForegroundColor Yellow
$htmlContent = Get-Content "public\index.html" -Raw -Encoding UTF8

# Remover botao de configuracoes
$pattern1 = '\s+<button class="tab" onclick="switchTab\(' + "'configuracoes'" + '\)">[^<]*</button>'
$htmlContent = $htmlContent -replace $pattern1, ''

# Remover aba de configuracoes completa
$pattern2 = '(?s)\s+<!-- Configurações Tab -->.*?</div>\s+</div>\s+(?=\s+<script>)'
$htmlContent = $htmlContent -replace $pattern2, '    </div>'

# Remover verificacao no switchTab
$pattern3 = '\s+if \(tab === "configuracoes"\) \{\s+carregarConfiguracoes\(\);\s+\}'
$htmlContent = $htmlContent -replace $pattern3, ''

# Remover funcoes de configuracao
$pattern4 = '(?s)\s+// ============================================\s+// FUNÇÕES DE CONFIGURAÇÃO.*?(?=\s+</script>)'
$htmlContent = $htmlContent -replace $pattern4, ''

Set-Content "public\index.html" $htmlContent -NoNewline -Encoding UTF8
Write-Host "Interface removida" -ForegroundColor Green

# 4. Adicionar GEMINI_API_KEY ao .env.example
Write-Host "`nAtualizando .env.example..." -ForegroundColor Yellow
$envExample = Get-Content ".env.example" -Raw -Encoding UTF8
if ($envExample -notmatch "GEMINI_API_KEY") {
    Add-Content ".env.example" "`nGEMINI_API_KEY=your_gemini_api_key_here" -Encoding UTF8
    Write-Host "GEMINI_API_KEY adicionado" -ForegroundColor Green
} else {
    Write-Host "GEMINI_API_KEY ja existe no .env.example" -ForegroundColor Yellow
}

# 5. Deletar arquivos
Write-Host "`nRemovendo arquivos desnecessarios..." -ForegroundColor Yellow
$filesToDelete = @(
    "supabase\migrations\202605260004_add_gemini_api_key.sql",
    "scripts\add-gemini-key-column.ts",
    "MIGRATION-GEMINI-API.md"
)

foreach ($file in $filesToDelete) {
    if (Test-Path $file) {
        Remove-Item $file -Force
        Write-Host "  Removido: $file" -ForegroundColor Green
    } else {
        Write-Host "  Nao encontrado: $file" -ForegroundColor Yellow
    }
}

Write-Host "`nReversao concluida com sucesso!" -ForegroundColor Green
Write-Host "`nProximos passos:" -ForegroundColor Cyan
Write-Host "  1. Revise as mudancas com: git diff" -ForegroundColor White
Write-Host "  2. Commit: git add ." -ForegroundColor White
Write-Host "  3. Commit: git commit -m 'refactor: usar .env para Gemini API'" -ForegroundColor White
Write-Host "  4. Deploy: vercel --prod" -ForegroundColor White
Write-Host "`nBackups salvos com extensao .backup" -ForegroundColor Cyan