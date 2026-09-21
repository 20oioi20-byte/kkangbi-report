@echo off
setlocal

rem 이 폴더(local-only) 기준으로 저장소 루트로 이동
cd /d "%~dp0.."

echo ============================================
echo  깡비서 리포트 - 사내 PC 전용 로컬 서버
echo  127.0.0.1(이 PC 안에서만) 로만 열립니다.
echo  같은 사무실 네트워크의 다른 PC에서는 접속이 안 됩니다.
echo ============================================
echo.
echo  브라우저에서 아래 주소로 접속하세요:
echo    http://127.0.0.1:8890/admin.html
echo    http://127.0.0.1:8890/upload.html
echo    http://127.0.0.1:8890/m.html
echo.
echo  끄려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo ============================================
echo.

python -m http.server 8890 --bind 127.0.0.1

pause
