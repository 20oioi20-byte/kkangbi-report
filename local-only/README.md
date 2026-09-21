# 사내 PC 전용 로컬 실행 (이 브랜치 전용)

이 폴더는 `local-office-only` 브랜치에만 있는 **추가 파일**입니다. `main`(배포용 코드)은
전혀 건드리지 않았습니다 — 나중에 도메인을 다시 연결하면 `main`을 그대로 재배포하면 됩니다.

## 왜 필요한가
배포 도메인(Vercel)을 지워서 외부 접속은 막혔지만, `admin.html` 등은 그냥 정적 파일이라
"열어서 쓰려면" 어떤 방식으로든 웹서버로 서빙해야 합니다. 이 스크립트는 그 서버를
**127.0.0.1(루프백)에만 묶어서** 띄웁니다 — 이 PC 밖에서는(같은 사무실 네트워크 포함)
절대 접속되지 않습니다.

## 데이터/AI 기능
프론트엔드는 그대로 인터넷의 Supabase(Edge Function + DB)를 호출합니다. 즉:
- 데이터는 지금까지와 같은 Supabase DB에 그대로 누적 저장됩니다.
- AI 기능(스마트업로드 등)도 그대로 동작합니다 — API 키는 전부 Supabase Function Secrets에만
  있고 이 저장소/이 PC에는 없습니다.
- 로컬에서 여는 건 "화면(HTML/CSS/JS)"뿐이고, 그 화면이 여전히 인터넷 너머 Supabase와 통신합니다.
  (인터넷 연결이 안 되면 로그인·데이터 조회·AI 기능 모두 안 됩니다.)

## 사용법
1. `local-only\run-local.bat` 더블클릭 (또는 PowerShell에서 `local-only\run-local.bat`)
2. 브라우저에서 접속:
   - `http://127.0.0.1:8890/admin.html`
   - `http://127.0.0.1:8890/upload.html`
   - `http://127.0.0.1:8890/m.html`
3. 끌 때는 서버 창을 닫거나 `Ctrl+C`

## 비밀번호/키 관련
- `app.js`에 있는 Supabase 주소·anon key는 원래 공개돼도 되는 값입니다(Edge Function 호출용일
  뿐, 이 값만으로 DB에 직접 접근할 수 없음 — 실제 인증은 센터/워크스페이스 비밀번호로 개별 처리).
- 그 외 실제 비밀 값(GEMINI_API_KEY, DB 비밀번호 등)은 이 저장소 어디에도 없고, 전부 Supabase
  Function Secrets에만 있습니다. 앞으로도 이 폴더에 `.env` 등 새 비밀 파일을 추가하게 되면
  반드시 `.gitignore`에 등록하고 git에 올리지 않습니다.
