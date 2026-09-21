@echo off
setlocal

cd /d "%~dp0.."

echo ============================================
echo  Kkangbi Report - office PC only (local)
echo  Bound to 127.0.0.1 only.
echo  NOT reachable from other PCs on the network.
echo ============================================
echo.
echo  Open in your browser:
echo    http://127.0.0.1:8890/admin.html
echo    http://127.0.0.1:8890/upload.html
echo    http://127.0.0.1:8890/m.html
echo.
echo  To stop: close this window or press Ctrl+C
echo ============================================
echo.

python -m http.server 8890 --bind 127.0.0.1

pause
