# --- Переходим в проект ---
$projectPath = "C:\Users\nika1\axiom-world-console"
if (-Not (Test-Path $projectPath)) {
    Write-Error "Папка проекта не найдена: $projectPath"
    exit
}
cd $projectPath
Write-Host "Текущая папка проекта: $PWD"


# --- Считываем WORLD_GATE_KEY ---
$keyFile = "$env:USERPROFILE\.wma\world_gate_key"
if (-Not (Test-Path $keyFile)) {
    Write-Error "Файл world_gate_key не найден: $keyFile"
    exit
}

$WORLD_GATE_KEY = Get-Content $keyFile -Raw
Write-Host "WORLD_GATE_KEY загружен."

# --- URL API ---
param(
    [string]$API_URL = "https://world-model-agent-ui.fly.dev/api"
)

Write-Host "Используем API: $API_URL"

# --- Пример запроса к API через PowerShell ---
# Это заменяет curl / bash скрипт
try {
    $response = Invoke-RestMethod -Uri $API_URL -Method Post -Headers @{ "Authorization" = "Bearer $WORLD_GATE_KEY" } -Body @{ action = "manual_diag" } 
    Write-Host "Ответ API:"
    Write-Host ($response | ConvertTo-Json -Depth 5)
} catch {
    Write-Error "Ошибка при запросе к API: $_"
}

# --- Очистка переменной среды ---
Remove-Item Env:WORLD_GATE_KEY -ErrorAction SilentlyContinue
Write-Host "WORLD_GATE_KEY удалён из окружения."

