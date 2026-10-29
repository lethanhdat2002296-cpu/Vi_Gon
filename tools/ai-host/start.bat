@echo off
REM Bấm đúp để chạy cổng gác AI Ví Gọn (cần Ollama + Node.js + Tailscale đã cài)
cd /d "%~dp0"
echo Dang mo Tailscale Funnel cho cong 8787...
tailscale funnel --bg 8787
echo Dang chay cong gac AI (de cua so nay mo)...
node server.js
pause
