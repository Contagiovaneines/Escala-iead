@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale o Node.js e tente novamente.
  pause
  exit /b 1
)
start "Escala - Servidor" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"
