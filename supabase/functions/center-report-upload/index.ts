// Supabase Edge Function: center-report-upload
// 배포: supabase functions deploy center-report-upload
// 환경변수(Function Secrets): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 기본 제공됨

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
// mammoth: esm.sh가 서빙하는 타입 선언이 바뀌면서 "has no default export" 타입에러가 발생할 수 있어
// default import 대신 네임스페이스로 불러와 안전하게 처리 (런타임 동작은 동일, 배포시 타입체크만 회피)
import * as mammothNs from 'https://esm.sh/mammoth@1.6.0';
const mammoth: any = (mammothNs as any).default ?? mammothNs;
// Gmail SMTP(앱 비밀번호)로 알림 메일을 보내기 위해 SMTP 프로토콜을 직접 구현한다(줄바꿈 파싱용으로만 표준 스트림 유틸 사용).
// 2026-08-10: 원래 denomailer 라이브러리를 썼으나, 그 라이브러리의 quoted-printable 인코더가
// "=EC=9D=B4"처럼 대문자여야 할 16진수를 "=ec=9d=b4"로(소문자로) 인코딩하는 버그가 있어서
// 일부 수신 메일함(KT 사내메일 등 엄격한 파서)에서 디코딩에 실패해 한글이 코드 그대로 노출되는 문제가 있었다.
// 그 버그를 우회할 수 없어(외부 URL 모듈이라 직접 수정 불가) 의존성 자체를 제거하고,
// 대소문자 구분 이슈가 없는 Base64 인코딩으로 직접 SMTP 메시지를 구성해서 보낸다.
import { TextLineStream } from 'https://deno.land/std@0.208.0/streams/text_line_stream.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!  // service_role -> RLS 우회, 서버에서만 사용
);

// Gemini API - 무료 티어(Flash, 일 1,500회) 사용. Supabase Function Secret으로 등록.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function hashPassword(pw: string): Promise<string> {
  const data = new TextEncoder().encode((pw || '').trim());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyWorkspacePassword(password: string): Promise<boolean> {
  const { data } = await supabase.from('workspace_config').select('password_hash').eq('id', true).maybeSingle();
  if (!data) return false;
  return (await hashPassword(password)) === data.password_hash;
}

// 2026-07-22: 예전엔 report.깡비서.kr(커스텀 도메인)에서 온 요청이면 Origin/Referer 헤더만 보고
// 비밀번호 없이 워크스페이스 권한을 인정해주는 자동 로그인 경로가 있었다. 그런데 이 두 헤더는
// 실제 브라우저를 거치지 않는 요청(curl, 스크립트 등)에서는 호출하는 쪽이 원하는 값으로 자유롭게
// 지정할 수 있어서 인증 수단으로 쓸 수 없었다(위조하면 비밀번호 없이 관리자 권한 우회 가능).
// 그래서 이 경로를 완전히 제거하고, 항상 실제 비밀번호 대조만 하도록 정리했다.
async function isWorkspaceAuthorized(req: Request, password: string): Promise<boolean> {
  return await verifyWorkspacePassword(password || '');
}

// TO/목표값 설정은 워크스페이스 관리자뿐 아니라, 해당 센터 본인 토큰으로도 저장 가능하게 한다.
// (센터 담당자가 자기 센터 탭에서 직접 관리하는 것을 지원)
async function isCenterOrWorkspaceAuthorized(req: Request, centerCode: string, token: string, password: string): Promise<boolean> {
  if (await isWorkspaceAuthorized(req, password)) return true;
  if (!token || !centerCode) return false;
  const { data } = await supabase
    .from('center_config')
    .select('center_code')
    .eq('upload_token', token)
    .eq('center_code', centerCode)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

// ============================================
// AI 보조기능 (엑셀 양식 매핑 제안 / 이슈 요약) - 서강MOT API 단일 Provider, 모델 고정(GPT5.5)
// 실패(크레딧 소진 등)해도 다른 Provider로 전환하지 않는다 - 프론트엔드가 "AI 사용 불가, 직접 입력해달라" 안내를 띄운다.
// ============================================
const SOGANG_MOT_MODEL = 'gpt-5.5'; // 모델 선택 기능 없음 - 항상 이 모델로만 호출

class AiUnavailableError extends Error {
  constructor(reason: string) {
    super('AI_UNAVAILABLE: ' + reason);
    this.name = 'AiUnavailableError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label + '_TIMEOUT')), ms)),
  ]);
}

// 서강MOT API 호출 (유일한 Provider). ⚠️ 실제 스펙 확인 후 필요시 이 함수만 수정.
async function callSogangMOT(systemPrompt: string, userPrompt: string): Promise<string> {
  // 다른 kkangbi 프로젝트(깡자동 브리핑 등)에서 이미 쓰던 MOT_GATEWAY_URL/KEY를 그대로 재사용한다.
  // (SOGANG_MOT_API_URL/KEY로도 동일한 값이 등록돼 있었지만, 이름을 하나로 통일하기 위해 기존 것을 채택)
  const apiUrl = Deno.env.get('MOT_GATEWAY_URL');
  const apiKey = Deno.env.get('MOT_GATEWAY_KEY');
  if (!apiUrl || !apiKey) throw new AiUnavailableError('MOT Gateway가 설정되지 않았습니다(MOT_GATEWAY_URL/KEY 누락)');

  let res: Response;
  try {
    res = await withTimeout(
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: SOGANG_MOT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
        }),
      }),
      20000,
      'SOGANG_MOT'
    );
  } catch (e) {
    throw new AiUnavailableError('서강MOT API 응답 없음 (' + (e as Error).message + ')');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isCredit = res.status === 402 || res.status === 403 || /credit|quota|insufficient/i.test(body);
    const reason = isCredit ? '크레딧 소진(또는 권한 부족)' : 'HTTP ' + res.status;
    // 임시 진단용: MOT_GATEWAY_URL 자체가 Supabase 대시보드에서 마스킹되어 원본을 볼 수 없으므로,
    // 실제 요청 URL을 Supabase Function 로그(관리자만 열람 가능)에만 남긴다 — 화면(사용자 노출)에는 절대 안 찍음.
    console.error('[callSogangMOT] 요청 실패 - URL:', apiUrl, '- status:', res.status);
    throw new AiUnavailableError(reason + ' - ' + body.slice(0, 200));
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AiUnavailableError('서강MOT API 응답이 비어 있습니다');
  return text;
}

async function logAiCall(centerCode: string | null | undefined, actionName: string, ok: boolean, error: string | null) {
  try {
    await supabase.from('ai_call_log').insert({
      center_code: centerCode || null,
      action: actionName,
      provider: 'sogang-mot',
      failover: false,
      error,
    });
  } catch (_e) { /* 로그 실패는 무시 - 본 기능에 영향 없음 */ }
}

function extractJson(text: string): any {
  const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error('AI_RESPONSE_NOT_JSON');
  return JSON.parse(match[0]);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  try {
    // ---------- 토큰 검증 ----------
    if (action === 'verify' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      const { data, error } = await supabase
        .from('center_config')
        .select('center_code, center_name, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (error || !data || !data.is_active) {
        await logAccess(null, 'token_invalid', null, ip);
        return json({ valid: false }, 200);
      }
      return json({ valid: true, center_name: data.center_name }, 200);
    }

    // ---------- 파일 업로드 ----------
    if (action === 'upload' && req.method === 'POST') {
      const formData = await req.formData();
      const token = formData.get('token') as string;
      const reportDate = formData.get('report_date') as string;
      const file = formData.get('file') as File;

      // 1) 토큰 -> center_code 검증 (여기서 실제 격리가 이루어짐)
      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, center_name, is_active, field_mapping')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        await logAccess(null, 'token_invalid', file?.name, ip);
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }

      const centerCode = center.center_code;

      // 2) Storage 업로드 (센터코드 폴더로 물리적 분리, 파일명은 ASCII로 안전 변환)
      const safeFileName = sanitizeFileName(file.name);
      const filePath = `${centerCode}/${reportDate}/${Date.now()}_${safeFileName}`;
      const fileBuffer = await file.arrayBuffer();

      const { error: uploadErr } = await supabase.storage
        .from('center-daily-reports')
        .upload(filePath, fileBuffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (uploadErr) {
        return json({ success: false, error: '파일 저장 실패: ' + uploadErr.message }, 500);
      }

      // 3) 실적 테이블에 pending 레코드 생성
      const { error: dbErr } = await supabase
        .from('center_daily_performance')
        .upsert({
          center_code: centerCode,
          report_date: reportDate,
          raw_file_url: filePath,
          raw_file_name: file.name,
          parsed_status: 'pending',
        }, { onConflict: 'center_code,report_date' });

      if (dbErr) {
        return json({ success: false, error: 'DB 기록 실패: ' + dbErr.message }, 500);
      }

      // 4) 로그 기록
      await logAccess(centerCode, 'upload', file.name, ip);

      // 5) 자동 파싱 (Gemini API, 무료 티어) - 실패해도 업로드 자체는 성공 처리
      try {
        await parseAndStore({ centerCode, reportDate, file, fileBuffer, fieldMapping: center.field_mapping });
      } catch (parseError) {
        await supabase
          .from('center_daily_performance')
          .update({ parsed_status: 'needs_review', parsed_note: String(parseError) })
          .eq('center_code', centerCode)
          .eq('report_date', reportDate);
      }

      return json({ success: true }, 200);
    }

    // ---------- 센터별 누적 현황 조회 ----------
    if (action === 'history' && req.method === 'GET') {
      const token = url.searchParams.get('token');

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, center_name, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }

      const { data: rows, error: rowsErr } = await supabase
        .from('center_daily_performance')
        .select('report_date, parsed_status, attendance_data, performance_data, raw_file_name')
        .eq('center_code', center.center_code)
        .order('report_date', { ascending: false })
        .limit(30);

      if (rowsErr) {
        return json({ success: false, error: '조회 실패: ' + rowsErr.message }, 500);
      }

      return json({ success: true, center_name: center.center_name, rows }, 200);
    }

    // ---------- 관리자: 전체 센터 실적 조회 (인증 없음 - URL 비공개로 운용) ----------
    if (action === 'admin-overview' && req.method === 'GET') {
      const centerFilter = url.searchParams.get('center'); // 지정 시 해당 센터 실적만 반환 (워크스페이스 미인증 상태에서 사용)

      let query = supabase
        .from('center_daily_performance')
        .select('center_code, report_date, parsed_status, parsed_note, attendance_data, performance_data, raw_file_name, created_at')
        .order('report_date', { ascending: false });
      if (centerFilter) {
        // 특정 센터 화면(대시보드 등)은 그 센터 최근 300건이면 충분
        query = query.eq('center_code', centerFilter).limit(300);
      } else {
        // 전체현황(워크스페이스)은 여러 센터가 한 요청을 나눠 쓰는데, 고정 300건 캡을 그대로 두면
        // 센터 수가 늘어날수록 일부 센터의 "이번달/누적" 계산에 필요한 오래된 행이 다른 센터의
        // 더 최근 행에 밀려 누락되면서, 센터별 대시보드에 나오는 값과 전체현황 값이 달라지는 문제가 있었다.
        // 행 개수로 자르는 대신 "올해 1월 1일 이후"로 기간을 제한해서, 센터가 몇 개든 연초 누적 계산에
        // 필요한 데이터가 절대 누락되지 않도록 한다.
        const yearStart = new Date().getFullYear() + '-01-01';
        query = query.gte('report_date', yearStart);
      }

      const { data: rows, error: rowsErr } = await query;

      if (rowsErr) {
        return json({ success: false, error: '조회 실패: ' + rowsErr.message }, 500);
      }

      const { data: centers, error: centersErr } = await supabase
        .from('center_config')
        .select('center_code, center_name, is_active, sort_order')
        .order('sort_order', { ascending: true });

      if (centersErr) {
        return json({ success: false, error: '센터목록 조회 실패: ' + centersErr.message }, 500);
      }

      return json({ success: true, centers, rows }, 200);
    }

    // ---------- 직접입력용 컬럼 순서(row_schema) 조회 ----------
    if (action === 'schema' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      const { data, error } = await supabase
        .from('center_config')
        .select('center_code, center_name, row_schema, category_schema, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (error || !data || !data.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      return jsonCached({ success: true, center_name: data.center_name, row_schema: data.row_schema || [], category_schema: data.category_schema || [] }, 200);
    }

    // ---------- 직접입력(붙여넣기) 저장: AI 호출 없이 위치 기준 즉시 저장 ----------
    if (action === 'manual-entry' && req.method === 'POST') {
      const body = await req.json();
      const { token, report_date, values } = body; // values: { key: value, ... } (프론트에서 이미 매핑 완료)

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        await logAccess(null, 'token_invalid', 'manual-entry', ip);
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }

      const newAttendance: Record<string, unknown> = {};
      const newPerformance: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(values as Record<string, { value: unknown; group: string }>)) {
        if (entry.group === 'attendance') newAttendance[key] = entry.value;
        else newPerformance[key] = entry.value;
      }

      // 같은 날짜에 다른 입력폼(예: 업무유형별 인입현황)이 이미 저장한 값이 있으면
      // 덮어쓰지 않고 병합한다 (신규 필드는 추가, 동일 필드는 최신 값으로 갱신)
      const { data: existing } = await supabase
        .from('center_daily_performance')
        .select('attendance_data, performance_data')
        .eq('center_code', center.center_code)
        .eq('report_date', report_date)
        .maybeSingle();

      const attendance = Object.assign({}, existing?.attendance_data || {}, newAttendance);
      const performance = Object.assign({}, existing?.performance_data || {}, newPerformance);

      const { error: upsertErr } = await supabase
        .from('center_daily_performance')
        .upsert({
          center_code: center.center_code,
          report_date,
          attendance_data: attendance,
          performance_data: performance,
          parsed_status: 'success', // 직접입력이므로 검토 불필요
          parsed_note: '직접입력',
        }, { onConflict: 'center_code,report_date' });

      if (upsertErr) {
        return json({ success: false, error: '저장 실패: ' + upsertErr.message }, 500);
      }

      await logAccess(center.center_code, 'manual-entry', report_date, ip);
      return json({ success: true }, 200);
    }

    // ---------- 여러 날짜 직접입력 일괄 저장 (LG전자 엑셀 자동추출 등 다건 반영용) ----------
    // entries: [{ report_date: 'YYYY-MM-DD', values: { key: { value, group }, ... } }, ...]
    if (action === 'manual-entry-bulk' && req.method === 'POST') {
      const body = await req.json();
      const { token, entries } = body;

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        await logAccess(null, 'token_invalid', 'manual-entry-bulk', ip);
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        return json({ success: false, error: '저장할 날짜 데이터가 없습니다.' }, 400);
      }

      const dates = entries.map((e: { report_date: string }) => e.report_date);
      const { data: existingRows } = await supabase
        .from('center_daily_performance')
        .select('report_date, attendance_data, performance_data')
        .eq('center_code', center.center_code)
        .in('report_date', dates);
      const existingMap: Record<string, { attendance_data: Record<string, unknown>; performance_data: Record<string, unknown> }> = {};
      (existingRows || []).forEach((r) => { existingMap[r.report_date] = r; });

      const upsertRows = entries.map((e: { report_date: string; values: Record<string, { value: unknown; group: string }> }) => {
        const newAttendance: Record<string, unknown> = {};
        const newPerformance: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(e.values)) {
          if (entry.group === 'attendance') newAttendance[key] = entry.value;
          else newPerformance[key] = entry.value;
        }
        const existing = existingMap[e.report_date];
        return {
          center_code: center.center_code,
          report_date: e.report_date,
          attendance_data: Object.assign({}, existing?.attendance_data || {}, newAttendance),
          performance_data: Object.assign({}, existing?.performance_data || {}, newPerformance),
          parsed_status: 'success',
          parsed_note: '엑셀 자동추출 일괄반영',
        };
      });

      const { error: upsertErr } = await supabase
        .from('center_daily_performance')
        .upsert(upsertRows, { onConflict: 'center_code,report_date' });

      if (upsertErr) {
        return json({ success: false, error: '저장 실패: ' + upsertErr.message }, 500);
      }

      await logAccess(center.center_code, 'manual-entry-bulk', `${entries.length}건`, ip);
      return json({ success: true, count: upsertRows.length }, 200);
    }

    // ---------- 이슈/히스토리 조회 ----------
    if (action === 'issues-list' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }

      const { data: issues, error: issuesErr } = await supabase
        .from('center_issues')
        .select('id, issue_date, title, content, created_at, reviewed')
        .eq('center_code', center.center_code)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (issuesErr) {
        return json({ success: false, error: '조회 실패: ' + issuesErr.message }, 500);
      }
      return json({ success: true, issues }, 200);
    }

    // ---------- 전체 센터 이슈/히스토리 통합 조회 (워크스페이스 관리자 전용 - 전체현황 피드/사이드바 신호등용) ----------
    if (action === 'list-all-issues' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      if (!(await isWorkspaceAuthorized(req, workspacePw))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { data: issues, error: issuesErr } = await supabase
        .from('center_issues')
        .select('id, center_code, issue_date, title, content, created_at, reviewed')
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (issuesErr) return json({ success: false, error: issuesErr.message }, 500);
      return json({ success: true, issues }, 200);
    }

    // ---------- 이슈/히스토리 "확인함" 처리 (워크스페이스 관리자 전용) ----------
    if (action === 'issues-mark-reviewed' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, id, reviewed } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      if (!id) return json({ success: false, error: 'id는 필수입니다.' }, 400);
      const { error } = await supabase.from('center_issues').update({ reviewed: reviewed !== false }).eq('id', id);
      if (error) return json({ success: false, error: '처리 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 이슈/히스토리 등록 ----------
    if (action === 'issues-create' && req.method === 'POST') {
      const body = await req.json();
      const { token, issue_date, title, content } = body;

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      if (!issue_date || !title) {
        return json({ success: false, error: '날짜와 제목은 필수입니다.' }, 400);
      }

      const { error: insertErr } = await supabase
        .from('center_issues')
        .insert({ center_code: center.center_code, issue_date, title, content: content || null });

      if (insertErr) {
        return json({ success: false, error: '저장 실패: ' + insertErr.message }, 500);
      }
      return json({ success: true }, 200);
    }

    // ---------- 이슈/히스토리 수정 ----------
    if (action === 'issues-update' && req.method === 'POST') {
      const body = await req.json();
      const { token, id, issue_date, title, content } = body;

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      if (!id || !issue_date || !title) {
        return json({ success: false, error: '필수 항목이 누락되었습니다.' }, 400);
      }

      const { error: updateErr } = await supabase
        .from('center_issues')
        .update({ issue_date, title, content: content || null })
        .eq('id', id)
        .eq('center_code', center.center_code); // 다른 센터 이슈는 수정 못하도록 이중 확인

      if (updateErr) {
        return json({ success: false, error: '수정 실패: ' + updateErr.message }, 500);
      }
      return json({ success: true }, 200);
    }

    // ---------- 이슈/히스토리 삭제 ----------
    // ---------- 지정 날짜(들)의 일자별 실적 삭제 ----------
    // ---------- 월별 TO(관리자/상담사) 설정 조회 (읽기 전용, 인증 불필요) ----------
    if (action === 'list-monthly-to' && req.method === 'GET') {
      const centerFilter = url.searchParams.get('center_code');
      let q = supabase.from('center_monthly_settings').select('*').order('year_month', { ascending: false });
      if (centerFilter) q = q.eq('center_code', centerFilter);
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return jsonCached({ success: true, settings: data }, 200);
    }

    // ---------- 월별 TO 설정 저장(월별 upsert) ----------
    if (action === 'save-monthly-to' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, year_month, to_manager, to_counselor } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다. 워크스페이스 비밀번호 또는 해당 센터 접속이 필요합니다.' }, 403);
      }
      if (!center_code || !year_month) return json({ success: false, error: '센터와 연월은 필수입니다.' }, 400);

      const { error } = await supabase.from('center_monthly_settings').upsert({
        center_code, year_month, to_manager: to_manager || 0, to_counselor: to_counselor || 0, updated_at: new Date().toISOString(),
      }, { onConflict: 'center_code,year_month' });
      if (error) return json({ success: false, error: '저장 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 월별 TO 설정 일괄 저장 (연도별 1~12월 그리드에서 사용) ----------
    // entries: [{ year_month: 'YYYY-MM', to_manager, to_counselor }, ...]
    if (action === 'save-monthly-to-bulk' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, entries } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다. 워크스페이스 비밀번호 또는 해당 센터 접속이 필요합니다.' }, 403);
      }
      if (!center_code || !Array.isArray(entries) || entries.length === 0) {
        return json({ success: false, error: '센터와 저장할 월 목록은 필수입니다.' }, 400);
      }
      const rows = entries.map((e: { year_month: string; to_manager: number; to_counselor: number }) => ({
        center_code, year_month: e.year_month, to_manager: e.to_manager || 0, to_counselor: e.to_counselor || 0,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('center_monthly_settings').upsert(rows, { onConflict: 'center_code,year_month' });
      if (error) return json({ success: false, error: '저장 실패: ' + error.message }, 500);
      return json({ success: true, count: rows.length }, 200);
    }
    if (action === 'delete-monthly-to' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id } = body;
      const { data: target } = await supabase.from('center_monthly_settings').select('center_code').eq('id', id).maybeSingle();
      if (!target) return json({ success: false, error: '대상을 찾을 수 없습니다.' }, 404);
      if (!(await isCenterOrWorkspaceAuthorized(req, target.center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { error } = await supabase.from('center_monthly_settings').delete().eq('id', id);
      if (error) return json({ success: false, error: '삭제 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 핵심지표(목표치) 설정 조회 (읽기 전용, 인증 불필요) ----------
    if (action === 'list-kpi-settings' && req.method === 'GET') {
      const centerFilter = url.searchParams.get('center_code');
      let q = supabase.from('center_kpi_settings').select('*').order('sort_order', { ascending: true });
      if (centerFilter) q = q.eq('center_code', centerFilter);
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return jsonCached({ success: true, settings: data }, 200);
    }

    // ---------- 핵심지표 설정 저장(추가/수정) ----------
    if (action === 'save-kpi-setting' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id, center_code, metric_key, metric_label, target_value, sort_order } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다. 워크스페이스 비밀번호 또는 해당 센터 접속이 필요합니다.' }, 403);
      }
      if (!center_code || !metric_key || !metric_label) return json({ success: false, error: '센터, 지표키, 라벨은 필수입니다.' }, 400);

      const payload = {
        center_code, metric_key, metric_label,
        target_value: (target_value === '' || target_value === undefined || target_value === null) ? null : Number(target_value),
        sort_order: sort_order || 0,
      };
      let error;
      if (id) {
        ({ error } = await supabase.from('center_kpi_settings').update(payload).eq('id', id));
      } else {
        ({ error } = await supabase.from('center_kpi_settings').insert(payload));
      }
      if (error) return json({ success: false, error: '저장 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 핵심지표 설정 삭제 ----------
    if (action === 'delete-kpi-setting' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id } = body;
      const { data: target } = await supabase.from('center_kpi_settings').select('center_code, metric_key').eq('id', id).maybeSingle();
      if (!target) return json({ success: false, error: '대상을 찾을 수 없습니다.' }, 404);
      if (!(await isCenterOrWorkspaceAuthorized(req, target.center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { error } = await supabase.from('center_kpi_settings').delete().eq('id', id);
      if (error) return json({ success: false, error: '삭제 실패: ' + error.message }, 500);
      // 해당 지표의 월별 목표치(연도별 그리드 오버라이드)도 함께 정리한다
      await supabase.from('center_kpi_monthly_targets').delete().eq('center_code', target.center_code).eq('metric_key', target.metric_key);
      return json({ success: true }, 200);
    }

    // ---------- 핵심지표 월별 목표치 조회 (읽기 전용, 인증 불필요) ----------
    // "TO 및 목표값설정" 화면의 연도별 1~12월 그리드에서 사용
    if (action === 'list-kpi-monthly-targets' && req.method === 'GET') {
      const centerFilter = url.searchParams.get('center_code');
      let q = supabase.from('center_kpi_monthly_targets').select('*');
      if (centerFilter) q = q.eq('center_code', centerFilter);
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return jsonCached({ success: true, targets: data }, 200);
    }

    // ---------- 핵심지표 월별 목표치 일괄 저장 ----------
    // entries: [{ metric_key, year_month: 'YYYY-MM', target_value }, ...]
    if (action === 'save-kpi-monthly-targets-bulk' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, entries } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다. 워크스페이스 비밀번호 또는 해당 센터 접속이 필요합니다.' }, 403);
      }
      if (!center_code || !Array.isArray(entries) || entries.length === 0) {
        return json({ success: false, error: '센터와 저장할 목표치 목록은 필수입니다.' }, 400);
      }
      const rows = entries.map((e: { metric_key: string; year_month: string; target_value: number }) => ({
        center_code, metric_key: e.metric_key, year_month: e.year_month, target_value: e.target_value,
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertErr } = await supabase.from('center_kpi_monthly_targets').upsert(rows, { onConflict: 'center_code,metric_key,year_month' });
      if (upsertErr) return json({ success: false, error: '저장 실패: ' + upsertErr.message }, 500);
      return json({ success: true, count: rows.length }, 200);
    }

    if (action === 'delete-dates' && req.method === 'POST') {
      const body = await req.json();
      const { token, dates } = body;
      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      if (!Array.isArray(dates) || dates.length === 0) {
        return json({ success: false, error: '삭제할 날짜가 지정되지 않았습니다.' }, 400);
      }

      const { error: delErr } = await supabase
        .from('center_daily_performance')
        .delete()
        .eq('center_code', center.center_code)
        .in('report_date', dates);

      if (delErr) return json({ success: false, error: '삭제 실패: ' + delErr.message }, 500);
      return json({ success: true, deleted: dates.length }, 200);
    }

    // ---------- issues-delete ----------
    if (action === 'issues-delete' && req.method === 'POST') {
      const body = await req.json();
      const { token, id } = body;

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();

      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }

      const { error: delErr } = await supabase
        .from('center_issues')
        .delete()
        .eq('id', id)
        .eq('center_code', center.center_code); // 다른 센터 이슈는 삭제 못하도록 이중 확인

      if (delErr) {
        return json({ success: false, error: '삭제 실패: ' + delErr.message }, 500);
      }
      return json({ success: true }, 200);
    }

    // ---------- 센터 비밀번호 검증 (성공 시 해당 센터 토큰 반환) ----------
    if (action === 'verify-center-password' && req.method === 'POST') {
      const body = await req.json();
      const { center_code, password } = body;
      const { data: center } = await supabase.from('center_config').select('center_name, password_hash, upload_token').eq('center_code', center_code).maybeSingle();
      if (!center) return json({ success: false, error: '존재하지 않는 센터입니다.' }, 404);
      const valid = (await hashPassword(password || '')) === center.password_hash;
      if (!valid) return json({ success: true, valid: false }, 200);
      return json({ success: true, valid: true, center_name: center.center_name, upload_token: center.upload_token }, 200);
    }

    // ---------- 워크스페이스 비밀번호 검증 (성공 시 전체 센터 토큰 반환) ----------
    // 2026-07-22: 이전엔 이 위에 "신규 도메인(report.깡비서.kr) 접속 시 비밀번호 없이 자동 열람" 기능이
    // 있었으나, Origin/Referer 헤더는 브라우저를 거치지 않는 요청에서는 호출하는 쪽이 자유롭게 지정할 수
    // 있어 인증 수단으로 쓸 수 없었다(위조 시 비밀번호 없이 전체 센터의 업로드 토큰을 받아갈 수 있었음).
    // 그래서 domain-auto-unlock 액션을 완전히 무력화하고, 언제나 valid:false만 반환하도록 정리했다.
    // 프론트엔드(app.js)는 이미 valid:false를 정상 케이스로 처리하도록 짜여 있어 별도 수정이 필요 없다.
    if (action === 'domain-auto-unlock' && req.method === 'POST') {
      return json({ success: true, valid: false }, 200);
    }

    if (action === 'verify-workspace-password' && req.method === 'POST') {
      const body = await req.json();
      const valid = await verifyWorkspacePassword(body.password || '');
      if (!valid) return json({ success: true, valid: false }, 200);
      const { data: centers } = await supabase.from('center_config').select('center_code, center_name, upload_token').order('sort_order', { ascending: true });
      return json({ success: true, valid: true, centers }, 200);
    }

    // ---------- 센터 비밀번호 변경 ----------
    if (action === 'change-center-password' && req.method === 'POST') {
      const body = await req.json();
      const { center_code, current_password, new_password, workspace_password } = body;
      if (!new_password || !/^\d{6}$/.test(new_password)) {
        return json({ success: false, error: '새 비밀번호는 숫자 6자리여야 합니다.' }, 400);
      }
      let authorized = false;
      if (workspace_password) authorized = await isWorkspaceAuthorized(req, workspace_password);
      if (!authorized) {
        const { data: center } = await supabase.from('center_config').select('password_hash').eq('center_code', center_code).maybeSingle();
        if (center && (await hashPassword(current_password || '')) === center.password_hash) authorized = true;
      }
      if (!authorized) return json({ success: false, error: '기존 비밀번호(또는 워크스페이스 비밀번호)가 일치하지 않습니다.' }, 403);

      const newHash = await hashPassword(new_password);
      const { error } = await supabase.from('center_config').update({ password_hash: newHash }).eq('center_code', center_code);
      if (error) return json({ success: false, error: '변경 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 워크스페이스 비밀번호 변경 ----------
    if (action === 'change-workspace-password' && req.method === 'POST') {
      const body = await req.json();
      const { current_password, new_password } = body;
      if (!new_password || !/^\d{6}$/.test(new_password)) {
        return json({ success: false, error: '새 비밀번호는 숫자 6자리여야 합니다.' }, 400);
      }
      const ok = await verifyWorkspacePassword(current_password || '');
      if (!ok) return json({ success: false, error: '기존 워크스페이스 비밀번호가 일치하지 않습니다.' }, 403);

      const newHash = await hashPassword(new_password);
      const { error } = await supabase.from('workspace_config').update({ password_hash: newHash }).eq('id', true);
      if (error) return json({ success: false, error: '변경 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 센터 관리: 목록(비밀번호 없이 이름/코드/순서만, 토큰은 노출하지 않음) ----------
    if (action === 'centers-manage-list' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('center_config')
        .select('center_code, center_name, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) return json({ success: false, error: error.message }, 500);
      return jsonCached({ success: true, centers: data }, 200);
    }

    // ---------- 센터 추가 (워크스페이스 비밀번호 필요) ----------
    if (action === 'center-create' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, center_code, center_name } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '워크스페이스 비밀번호가 일치하지 않습니다.' }, 403);
      }
      if (!center_code || !center_name) return json({ success: false, error: '센터 코드와 이름은 필수입니다.' }, 400);

      const { data: maxRow } = await supabase.from('center_config').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const nextOrder = maxRow ? (maxRow.sort_order || 0) + 1 : 1;
      const defaultHash = await hashPassword('000000');

      const { error } = await supabase.from('center_config').insert({
        center_code, center_name, password_hash: defaultHash, sort_order: nextOrder, is_active: true,
      });
      if (error) return json({ success: false, error: '추가 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 센터 수정 (이름/활성상태, 워크스페이스 비밀번호 필요) ----------
    if (action === 'center-update' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, center_code, center_name, is_active } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '워크스페이스 비밀번호가 일치하지 않습니다.' }, 403);
      }
      const update: Record<string, unknown> = {};
      if (center_name !== undefined) update.center_name = center_name;
      if (is_active !== undefined) update.is_active = is_active;

      const { error } = await supabase.from('center_config').update(update).eq('center_code', center_code);
      if (error) return json({ success: false, error: '수정 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 센터 삭제 (워크스페이스 비밀번호 필요) ----------
    if (action === 'center-delete' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, center_code } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '워크스페이스 비밀번호가 일치하지 않습니다.' }, 403);
      }
      const { error } = await supabase.from('center_config').delete().eq('center_code', center_code);
      if (error) return json({ success: false, error: '삭제 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 센터 순서 일괄변경 (워크스페이스 비밀번호 필요) ----------
    if (action === 'center-reorder' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, orders } = body; // orders: [{center_code, sort_order}, ...]
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '워크스페이스 비밀번호가 일치하지 않습니다.' }, 403);
      }
      for (const o of orders || []) {
        await supabase.from('center_config').update({ sort_order: o.sort_order }).eq('center_code', o.center_code);
      }
      return json({ success: true }, 200);
    }

    // ---------- 업로드 자료함: 파일 저장 (데이터입력 시 첨부한 원본 파일을 누적 보관) ----------
    if (action === 'archive-upload-file' && req.method === 'POST') {
      const body = await req.json();
      const { token, file_name, file_type, file_base64 } = body;

      const { data: center, error: centerErr } = await supabase
        .from('center_config')
        .select('center_code, is_active')
        .eq('upload_token', token)
        .maybeSingle();
      if (centerErr || !center || !center.is_active) {
        return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
      }
      if (!file_name || !file_base64) {
        return json({ success: false, error: '파일명과 파일 내용은 필수입니다.' }, 400);
      }

      const bytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
      const safeName = sanitizeFileName(file_name);
      const storagePath = `${center.center_code}/${Date.now()}_${safeName}`;
      const ext = safeName.includes('.') ? safeName.split('.').pop()!.toLowerCase() : '';

      const { error: upErr } = await supabase.storage.from('uploaded-files').upload(storagePath, bytes, {
        contentType: guessMime(ext) === 'application/octet-stream' ? (
          ext === 'xlsx' || ext === 'xlsm' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
          ext === 'hwpx' ? 'application/haansofthwp' : 'application/octet-stream'
        ) : guessMime(ext),
        upsert: false,
      });
      if (upErr) return json({ success: false, error: '파일 저장 실패: ' + upErr.message }, 500);

      const { error: logErr } = await supabase.from('uploaded_files_log').insert({
        center_code: center.center_code,
        file_name: file_name, // 원본 파일명(한글 포함) 그대로 표시용으로 저장
        storage_path: storagePath,
        file_type: file_type || null,
        file_size: bytes.length,
      });
      if (logErr) return json({ success: false, error: '기록 저장 실패: ' + logErr.message }, 500);

      return json({ success: true }, 200);
    }

    // ---------- 업로드 자료함: 목록 조회 ----------
    // 워크스페이스 비밀번호(전체 조회) 또는 센터 토큰(해당 센터만 조회) 중 하나로 인증
    if (action === 'archive-list-files' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      const token = url.searchParams.get('token') || '';
      const centerFilter = url.searchParams.get('center_code');
      const search = (url.searchParams.get('search') || '').trim();

      let allowedCenter: string | null = null;
      const isWorkspace = await isWorkspaceAuthorized(req, workspacePw);
      if (!isWorkspace) {
        if (!token) return json({ success: false, error: '권한이 없습니다.' }, 403);
        const { data: center } = await supabase.from('center_config').select('center_code').eq('upload_token', token).maybeSingle();
        if (!center) return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
        allowedCenter = center.center_code;
      }

      let q = supabase.from('uploaded_files_log').select('*').order('uploaded_at', { ascending: false }).limit(300);
      if (allowedCenter) q = q.eq('center_code', allowedCenter);
      else if (centerFilter) q = q.eq('center_code', centerFilter);
      if (search) q = q.ilike('file_name', `%${search}%`);

      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, files: data }, 200);
    }

    // ---------- 업로드 자료함: 다운로드 URL 발급 ----------
    if (action === 'archive-file-url' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id } = body;

      const { data: fileRow, error: fileErr } = await supabase.from('uploaded_files_log').select('*').eq('id', id).maybeSingle();
      if (fileErr || !fileRow) return json({ success: false, error: '파일을 찾을 수 없습니다.' }, 404);

      if (!(await isCenterOrWorkspaceAuthorized(req, fileRow.center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }

      const { data: signed, error: signErr } = await supabase.storage.from('uploaded-files').createSignedUrl(fileRow.storage_path, 120, {
        download: fileRow.file_name,
      });
      if (signErr || !signed) return json({ success: false, error: '다운로드 URL 생성 실패: ' + (signErr?.message || '') }, 500);
      return json({ success: true, url: signed.signedUrl, file_name: fileRow.file_name }, 200);
    }

    // ---------- 업로드 자료함: 파일 삭제 (Storage 원본 + 로그 레코드 함께 삭제) ----------
    if (action === 'archive-delete-file' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id } = body;

      const { data: fileRow, error: fileErr } = await supabase.from('uploaded_files_log').select('*').eq('id', id).maybeSingle();
      if (fileErr || !fileRow) return json({ success: false, error: '파일을 찾을 수 없습니다.' }, 404);

      if (!(await isCenterOrWorkspaceAuthorized(req, fileRow.center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }

      const { error: rmErr } = await supabase.storage.from('uploaded-files').remove([fileRow.storage_path]);
      if (rmErr) return json({ success: false, error: '파일 삭제 실패: ' + rmErr.message }, 500);

      const { error: delErr } = await supabase.from('uploaded_files_log').delete().eq('id', id);
      if (delErr) return json({ success: false, error: '기록 삭제 실패: ' + delErr.message }, 500);

      return json({ success: true }, 200);
    }

    // ---------- 업로드 자료함: 선택 항목 일괄 삭제 ----------
    if (action === 'archive-delete-files-bulk' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, ids } = body;
      if (!Array.isArray(ids) || ids.length === 0) return json({ success: false, error: '삭제할 파일이 지정되지 않았습니다.' }, 400);

      const { data: fileRows, error: fileErr } = await supabase.from('uploaded_files_log').select('*').in('id', ids);
      if (fileErr || !fileRows || fileRows.length === 0) return json({ success: false, error: '파일을 찾을 수 없습니다.' }, 404);

      // 여러 센터 파일이 섞여 있을 수 있으므로, 각 센터별로 권한을 확인한다
      const centerCodes = Array.from(new Set(fileRows.map((f) => f.center_code)));
      for (const cc of centerCodes) {
        if (!(await isCenterOrWorkspaceAuthorized(req, cc, token || '', workspace_password || ''))) {
          return json({ success: false, error: cc + ' 센터 파일에 대한 권한이 없습니다.' }, 403);
        }
      }

      const paths = fileRows.map((f) => f.storage_path);
      const { error: rmErr } = await supabase.storage.from('uploaded-files').remove(paths);
      if (rmErr) return json({ success: false, error: '파일 삭제 실패: ' + rmErr.message }, 500);

      const { error: delErr } = await supabase.from('uploaded_files_log').delete().in('id', ids);
      if (delErr) return json({ success: false, error: '기록 삭제 실패: ' + delErr.message }, 500);

      return json({ success: true, count: fileRows.length }, 200);
    }

    // ============================================
    // 센터별 데이터 업로드 모니터링 + 담당자 이메일 알림
    // ============================================

    // ---------- 센터별 최근 업로드 시각 조회 (사이드바 신호등용, 읽기 전용) ----------
    // 2026-08-28: "최근 업로드"를 DB에 쓰여진 시각(created_at)이 아니라, 실제 실적 날짜(report_date)
    // 기준으로 바꿨다. 엑셀 자동추출로 한 달치를 한 번에 일괄반영하는 센터(예: LG전자통합)는
    // 그 한 번의 반영 이후로 며칠이 지났든 모든 날짜 행의 created_at이 그 반영 시각에 고정돼 있어서,
    // 실제로는 최신 날짜까지 실적이 다 들어있는데도 사이드바엔 "그 반영일로부터 N일 전"으로
    // (오래전 업로드처럼) 잘못 표시되는 문제가 있었다. 오늘 이전 날짜만 보고, 그중 가장 최근 report_date를
    // 기준으로 판단하면 "실제로 며칠치까지 실적이 채워져 있는지"를 정확히 반영한다.
    if (action === 'list-last-upload' && req.method === 'GET') {
      const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('center_daily_performance')
        .select('center_code, report_date')
        .lte('report_date', todayStr)
        .order('report_date', { ascending: false });
      if (error) return json({ success: false, error: error.message }, 500);
      const lastByCenter: Record<string, string> = {};
      for (const row of data || []) {
        if (!lastByCenter[row.center_code]) lastByCenter[row.center_code] = row.report_date;
      }
      return json({ success: true, lastUpload: lastByCenter }, 200);
    }

    // ---------- 센터별 담당자 연락처 조회 ----------
    if (action === 'list-contacts' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      const token = url.searchParams.get('token') || '';
      const centerFilter = url.searchParams.get('center_code');

      let allowedCenter: string | null = null;
      if (!(await isWorkspaceAuthorized(req, workspacePw))) {
        if (!token) return json({ success: false, error: '권한이 없습니다.' }, 403);
        const { data: center } = await supabase.from('center_config').select('center_code').eq('upload_token', token).maybeSingle();
        if (!center) return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
        allowedCenter = center.center_code;
      }
      let q = supabase.from('center_contacts').select('*').order('created_at', { ascending: true });
      if (allowedCenter) q = q.eq('center_code', allowedCenter);
      else if (centerFilter) q = q.eq('center_code', centerFilter);
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, contacts: data }, 200);
    }

    // ---------- 담당자 연락처 추가/수정 ----------
    if (action === 'save-contact' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id, center_code, name, email, is_active } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      if (!center_code || !email) return json({ success: false, error: '센터와 이메일은 필수입니다.' }, 400);

      if (id) {
        const { error } = await supabase.from('center_contacts').update({ name, email, is_active: is_active !== false }).eq('id', id);
        if (error) return json({ success: false, error: '수정 실패: ' + error.message }, 500);
      } else {
        const { error } = await supabase.from('center_contacts').insert({ center_code, name, email, is_active: is_active !== false });
        if (error) return json({ success: false, error: '등록 실패: ' + error.message }, 500);
      }
      return json({ success: true }, 200);
    }

    // ---------- 담당자 연락처 삭제 ----------
    if (action === 'delete-contact' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, id } = body;
      const { data: contact } = await supabase.from('center_contacts').select('center_code').eq('id', id).maybeSingle();
      if (!contact) return json({ success: false, error: '대상을 찾을 수 없습니다.' }, 404);
      if (!(await isCenterOrWorkspaceAuthorized(req, contact.center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { error } = await supabase.from('center_contacts').delete().eq('id', id);
      if (error) return json({ success: false, error: '삭제 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ============================================
    // 관리자-센터 쪽지(질문/답변) — 워크스페이스 관리자가 센터별로 메모를 보내고,
    // 센터장이 확인 후 답변을 남기는 1:1 스레드. center_messages 테이블 사용.
    // ============================================

    // ---------- 특정 센터의 쪽지 스레드 조회 (관리자: workspace_password + center_code / 센터: token) ----------
    if (action === 'messages-list' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      const token = url.searchParams.get('token') || '';
      let centerCode = url.searchParams.get('center_code') || '';

      if (await isWorkspaceAuthorized(req, workspacePw)) {
        if (!centerCode) return json({ success: false, error: 'center_code는 필수입니다.' }, 400);
      } else {
        if (!token) return json({ success: false, error: '권한이 없습니다.' }, 403);
        const { data: center } = await supabase.from('center_config').select('center_code').eq('upload_token', token).eq('is_active', true).maybeSingle();
        if (!center) return json({ success: false, error: '유효하지 않은 토큰입니다.' }, 403);
        centerCode = center.center_code;
      }

      const { data: messages, error } = await supabase
        .from('center_messages')
        .select('id, center_code, sender, message, created_at, read_by_admin, read_by_center')
        .eq('center_code', centerCode)
        .order('created_at', { ascending: true });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, messages }, 200);
    }

    // ---------- 전체 센터 쪽지 요약(센터별 최근 메시지 + 관리자 미확인 개수) - 사이드바 신호등/전체현황 피드용 ----------
    if (action === 'list-all-messages-summary' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      if (!(await isWorkspaceAuthorized(req, workspacePw))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { data, error } = await supabase
        .from('center_messages')
        .select('center_code, sender, message, created_at, read_by_admin')
        .order('created_at', { ascending: false });
      if (error) return json({ success: false, error: error.message }, 500);
      const summary: Record<string, { lastMessage: string; lastAt: string; lastSender: string; unreadByAdmin: number }> = {};
      for (const row of data || []) {
        if (!summary[row.center_code]) {
          summary[row.center_code] = { lastMessage: row.message, lastAt: row.created_at, lastSender: row.sender, unreadByAdmin: 0 };
        }
        if (row.sender === 'center' && !row.read_by_admin) summary[row.center_code].unreadByAdmin++;
      }
      return json({ success: true, summary }, 200);
    }

    // ---------- 쪽지 보내기(관리자: workspace_password / 센터: token) ----------
    if (action === 'messages-send' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, message } = body;
      if (!center_code || !message || !String(message).trim()) {
        return json({ success: false, error: '센터와 내용은 필수입니다.' }, 400);
      }

      let sender: 'admin' | 'center';
      if (await isWorkspaceAuthorized(req, workspace_password || '')) {
        sender = 'admin';
      } else {
        const { data: center } = await supabase.from('center_config').select('center_code').eq('upload_token', token || '').eq('center_code', center_code).eq('is_active', true).maybeSingle();
        if (!center) return json({ success: false, error: '권한이 없습니다.' }, 403);
        sender = 'center';
      }

      const { error } = await supabase.from('center_messages').insert({
        center_code,
        sender,
        message: String(message).trim(),
        read_by_admin: sender === 'admin',
        read_by_center: sender === 'center',
      });
      if (error) return json({ success: false, error: '전송 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 쪽지 읽음 처리(상대방이 보낸 메시지를 내가 읽었음으로 표시) ----------
    if (action === 'messages-mark-read' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code } = body;
      if (!center_code) return json({ success: false, error: 'center_code는 필수입니다.' }, 400);

      if (await isWorkspaceAuthorized(req, workspace_password || '')) {
        const { error } = await supabase.from('center_messages').update({ read_by_admin: true }).eq('center_code', center_code).eq('sender', 'center');
        if (error) return json({ success: false, error: error.message }, 500);
      } else {
        const { data: center } = await supabase.from('center_config').select('center_code').eq('upload_token', token || '').eq('center_code', center_code).eq('is_active', true).maybeSingle();
        if (!center) return json({ success: false, error: '권한이 없습니다.' }, 403);
        const { error } = await supabase.from('center_messages').update({ read_by_center: true }).eq('center_code', center_code).eq('sender', 'admin');
        if (error) return json({ success: false, error: error.message }, 500);
      }
      return json({ success: true }, 200);
    }

    // ---------- 알림 발송 설정 조회 (읽기 전용, 인증 불필요 - 발송 문구는 민감정보 아님) ----------
    // center_code를 지정하면, 전역 기본값 위에 해당 센터의 오버라이드(있는 컬럼만)를 덮어써서 반환한다.
    // 문구(제목/본문)뿐 아니라 "며칠째 발송할지" 기준일수도 센터별로 다르게 줄 수 있다.
    // (진짜 전역 공통인 건 발송정지/발송시각/반복발송 여부·주기뿐)
    if (action === 'get-notification-settings' && req.method === 'GET') {
      const { data, error } = await supabase.from('notification_settings').select('*').eq('id', true).maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);

      const centerCode = url.searchParams.get('center_code');
      let settings = data;
      if (centerCode && data) {
        const { data: ov } = await supabase.from('center_notification_settings').select('*').eq('center_code', centerCode).maybeSingle();
        settings = {
          ...data,
          warn_subject: ov?.warn_subject ?? data.warn_subject,
          warn_body: ov?.warn_body ?? data.warn_body,
          issue_subject: ov?.issue_subject ?? data.issue_subject,
          issue_body: ov?.issue_body ?? data.issue_body,
          warn_send_on_day: ov?.warn_send_on_day ?? data.warn_send_on_day,
          issue_send_on_day: ov?.issue_send_on_day ?? data.issue_send_on_day,
          has_center_override: !!ov,
        };
      }
      return jsonCached({ success: true, settings }, 200);
    }

    // ---------- 알림 발송 설정 저장 (워크스페이스 관리자 전용) ----------
    // 운영설정(발송정지/발송시각/반복발송/반복주기)만 전역 notification_settings에 저장하고,
    // 메일 문구(제목/본문) + 발송 기준일수(며칠째)는 요청에 담긴 center_code 기준으로
    // center_notification_settings에 센터별로 저장한다.
    // - 2026-08-24: 발송 기준일수는 원래 전역에만 저장돼서, 화면상 센터별 문구 영역 안에 같이
    //   있는데도 실제로는 한 센터에서 바꾸면 전체 센터에 다 적용되는 문제가 있었다. 문구와 동일한
    //   센터별 오버라이드 방식으로 옮겼다.
    if (action === 'save-notification-settings' && req.method === 'POST') {
      const body = await req.json();
      const {
        workspace_password, center_code,
        warn_subject, warn_body, issue_subject, issue_body,
        warn_send_on_day, issue_send_on_day,
        ...globalSettings
      } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      if (!center_code) return json({ success: false, error: '센터를 선택해 주세요.' }, 400);

      const { error: globalErr } = await supabase.from('notification_settings').update({ ...globalSettings, updated_at: new Date().toISOString() }).eq('id', true);
      if (globalErr) return json({ success: false, error: '저장 실패: ' + globalErr.message }, 500);

      const { error: centerErr } = await supabase.from('center_notification_settings').upsert({
        center_code, warn_subject, warn_body, issue_subject, issue_body,
        warn_send_on_day: warn_send_on_day || null, issue_send_on_day: issue_send_on_day || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'center_code' });
      if (centerErr) return json({ success: false, error: '문구 저장 실패: ' + centerErr.message }, 500);

      return json({ success: true }, 200);
    }

    // ---------- 센터 전용 문구 초기화(전역 기본값으로 되돌리기) ----------
    if (action === 'reset-center-notification-override' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, center_code } = body;
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      if (!center_code) return json({ success: false, error: '센터를 선택해 주세요.' }, 400);
      const { error } = await supabase.from('center_notification_settings').delete().eq('center_code', center_code);
      if (error) return json({ success: false, error: '초기화 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    // ---------- 발송 이력 조회 ----------
    if (action === 'list-notification-log' && req.method === 'GET') {
      const workspacePw = url.searchParams.get('workspace_password') || '';
      if (!(await isWorkspaceAuthorized(req, workspacePw))) return json({ success: false, error: '권한이 없습니다.' }, 403);
      const { data, error } = await supabase.from('notification_log').select('*').order('sent_at', { ascending: false }).limit(200);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, logs: data }, 200);
    }

    // ---------- 매시 정각 크론이 호출: 업로드 지연 센터를 감지해 이메일 발송 ----------
    if (action === 'check-and-notify') {
      const { data: settings } = await supabase.from('notification_settings').select('*').eq('id', true).maybeSingle();
      if (!settings) return json({ success: false, error: '알림 설정이 없습니다.' }, 500);
      if (settings.is_paused) return json({ success: true, skipped: 'paused' }, 200);

      // 발송 목표 시각(HH:00)과 현재 시각(UTC+9, 매시 정각 실행 기준)이 일치할 때만 발송한다
      const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const nowHour = String(nowKst.getUTCHours()).padStart(2, '0') + ':00';
      const targetHour = (settings.send_time || '09:00').slice(0, 2) + ':00';
      if (nowHour !== targetHour) return json({ success: true, skipped: 'not-send-time', nowHour, targetHour }, 200);

      const result = await runNotificationCheck(settings, false);
      return json({ success: true, ...result }, 200);
    }

    // ---------- 관리자가 "즉시 발송" 버튼을 눌렀을 때: 시간 게이트를 건너뛰고 지금 바로 검사·발송 ----------
    if (action === 'send-notification-now' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, center_code } = body; // center_code 지정 시 해당 센터만, 없으면 전체 센터 대상
      if (!(await isWorkspaceAuthorized(req, workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { data: settings } = await supabase.from('notification_settings').select('*').eq('id', true).maybeSingle();
      if (!settings) return json({ success: false, error: '알림 설정이 없습니다.' }, 500);
      if (settings.is_paused) return json({ success: false, error: '발송이 일시정지 상태입니다. 먼저 발송정지를 해제해 주세요.' }, 400);

      // 즉시발송은 반복발송/중복방지 로직도 건너뛰어, 대상 조건(경과일)에 맞는 센터에는 항상 발송한다
      const result = await runNotificationCheck(settings, true, center_code || null);
      return json({ success: true, ...result }, 200);
    }

    // ============================================
    // AI 보조기능: 엑셀 양식 변경 매핑 제안 / 이슈 히스토리 요약 (서강MOT API 단일 Provider)
    // ============================================

    // ---------- 엑셀 헤더 텍스트를 보고 새 헤더 키워드 매핑을 AI가 제안 ----------
    if (action === 'ai-suggest-xlsx-mapping' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, header_text, field_defs } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }

      const systemPrompt =
        '너는 콜센터 실적 엑셀 양식의 헤더를 분석해서 표준 필드로 매핑하는 도우미다. ' +
        '입력으로 엑셀 헤더 텍스트(여러 행)와, 시스템이 원래 찾던 필드별 기대 키워드 목록을 받는다. ' +
        '헤더 텍스트를 보고 각 필드에 실제로 해당하는 헤더 텍스트 조각(키워드)을 1~3개씩 제안해라. ' +
        '반드시 다음 JSON 형식으로만 답하라(설명, 마크다운 코드블록 금지): ' +
        '{"diagnosis": "무엇이 바뀐 것으로 보이는지 2~3문장 한국어 설명", ' +
        '"suggested_mapping": [{"field_key": "필드키", "suggested_tokens": ["키워드1","키워드2"]}, ...]}';
      const userPrompt =
        '=== 엑셀 헤더 텍스트 ===\n' + header_text + '\n\n' +
        '=== 기존 필드 정의(기대 키워드) ===\n' + JSON.stringify(field_defs, null, 2);

      try {
        const text = await callSogangMOT(systemPrompt, userPrompt);
        await logAiCall(center_code, action, true, null);
        const parsed = extractJson(text);
        return json({ success: true, diagnosis: parsed.diagnosis || '', suggested_mapping: parsed.suggested_mapping || [] }, 200);
      } catch (e) {
        await logAiCall(center_code, action, false, (e as Error).message);
        return json({ success: false, error: (e as Error).message }, 503);
      }
    }

    // ---------- 승인된 엑셀 헤더 매핑 저장/조회 ----------
    if (action === 'save-xlsx-field-override' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, override } = body;
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { error } = await supabase.from('center_xlsx_field_override').upsert({
        center_code, override, updated_at: new Date().toISOString(),
      }, { onConflict: 'center_code' });
      if (error) return json({ success: false, error: '저장 실패: ' + error.message }, 500);
      return json({ success: true }, 200);
    }

    if (action === 'get-xlsx-field-override' && req.method === 'GET') {
      const center_code = url.searchParams.get('center_code') || '';
      const token = url.searchParams.get('token') || '';
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token, ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      const { data, error } = await supabase
        .from('center_xlsx_field_override')
        .select('override')
        .eq('center_code', center_code)
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      return jsonCached({ success: true, override: data?.override || null }, 200);
    }

    // ---------- 이슈/히스토리 요약 ----------
    if (action === 'ai-summarize-issues' && req.method === 'POST') {
      const body = await req.json();
      const { workspace_password, token, center_code, issues } = body; // issues: [{date,title,content}]
      if (!(await isCenterOrWorkspaceAuthorized(req, center_code, token || '', workspace_password || ''))) {
        return json({ success: false, error: '권한이 없습니다.' }, 403);
      }
      if (!Array.isArray(issues) || issues.length === 0) {
        return json({ success: false, error: '요약할 이슈가 없습니다.' }, 400);
      }

      const systemPrompt =
        '너는 콜센터 총괄 PM을 돕는 보조원이다. 이슈/히스토리 기록을 읽고 ' +
        '(1) 반복되는 패턴 (2) 아직 해결되지 않은 것으로 보이는 건 (3) 특이사항을 ' +
        '한국어로 간결하게 요약한다. 불릿 3~5개 이내로, 기록에 실제로 있는 내용만 근거로 작성하고 ' +
        '추측이나 과장을 하지 않는다. 마크다운 기호(*, #) 없이 줄바꿈으로만 구분한 평문으로 답하라.';
      const userPrompt = '이슈/히스토리 기록 (' + issues.length + '건, 최신순):\n' +
        issues.map((i: any) => '- [' + i.date + '] ' + i.title + (i.content ? ': ' + i.content : '')).join('\n');

      try {
        const text = await callSogangMOT(systemPrompt, userPrompt);
        await logAiCall(center_code, action, true, null);
        return json({ success: true, summary: text.trim() }, 200);
      } catch (e) {
        await logAiCall(center_code, action, false, (e as Error).message);
        return json({ success: false, error: (e as Error).message }, 503);
      }
    }

    return json({ success: false, error: 'invalid action' }, 400);
  } catch (e) {
    return json({ success: false, error: String(e) }, 500);
  }
});

// ============================================
// 업로드 지연 센터 감지 + 이메일 발송 (매시 크론 / "즉시 발송" 버튼 공용 로직)
// ============================================
// 2026-08-10: 예전엔 "같은 주제(실적 미업로드)"를 주의(4일째)/경고(8일째) 두 단계로 나눠 보냈는데,
// 이제는 서로 다른 두 가지 주제를 각각 단일 단계로 보내도록 재구성했다.
//   - type 'perf' : 실적(center_daily_performance) 미업로드 경과일 기준
//   - type 'issue': 이슈/히스토리(center_issues) 미등록 경과일 기준
// notification_log.level에는 그대로 'warn'(실적) / 'issue'(이슈)로 구분해 기록한다
// (기존 'warn' 값과 통계 연속성을 위해 실적 쪽 이름은 그대로 두고, 'danger'였던 자리를 'issue'로 교체).
async function runNotificationCheck(settings: any, forceSend: boolean, centerCodeFilter: string | null = null) {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);

  let centerQuery = supabase.from('center_config').select('center_code, center_name').eq('is_active', true);
  if (centerCodeFilter) centerQuery = centerQuery.eq('center_code', centerCodeFilter);
  const { data: centers } = await centerQuery;

  // 센터별 문구 오버라이드(있으면 전역 문구 대신 이걸 사용)
  let overrideQuery = supabase.from('center_notification_settings').select('*');
  if (centerCodeFilter) overrideQuery = overrideQuery.eq('center_code', centerCodeFilter);
  const { data: overrideRows } = await overrideQuery;
  const overrideByCenter: Record<string, any> = {};
  for (const row of overrideRows || []) overrideByCenter[row.center_code] = row;

  // 2026-08-28: list-last-upload와 동일한 이유로 created_at 대신 report_date/issue_date를 쓴다 -
  // 한 달치를 한 번에 일괄반영하는 센터는 created_at이 그 반영 시각에 고정돼 있어서, 실제로는 최신
  // 날짜까지 다 등록돼 있는데도 "N일째 미업로드" 알림이 잘못 나갈 수 있었다.
  const { data: lastPerfRows } = await supabase.from('center_daily_performance').select('center_code, report_date').lte('report_date', todayStr).order('report_date', { ascending: false });
  const lastPerfByCenter: Record<string, string> = {};
  for (const row of lastPerfRows || []) { if (!lastPerfByCenter[row.center_code]) lastPerfByCenter[row.center_code] = row.report_date; }

  const { data: lastIssueRows } = await supabase.from('center_issues').select('center_code, issue_date').lte('issue_date', todayStr).order('issue_date', { ascending: false });
  const lastIssueByCenter: Record<string, string> = {};
  for (const row of lastIssueRows || []) { if (!lastIssueByCenter[row.center_code]) lastIssueByCenter[row.center_code] = row.issue_date; }

  const results: Array<Record<string, unknown>> = [];
  for (const center of centers || []) {
    const ov = overrideByCenter[center.center_code];
    await checkAndSendOne({
      center, type: 'warn', lastAt: lastPerfByCenter[center.center_code],
      sendOnDay: ov?.warn_send_on_day || settings.warn_send_on_day || 4,
      subjectTpl: ov?.warn_subject || settings.warn_subject, bodyTpl: ov?.warn_body || settings.warn_body,
      settings, forceSend, results,
    });
    await checkAndSendOne({
      center, type: 'issue', lastAt: lastIssueByCenter[center.center_code],
      sendOnDay: ov?.issue_send_on_day || settings.issue_send_on_day || 4,
      subjectTpl: ov?.issue_subject || settings.issue_subject, bodyTpl: ov?.issue_body || settings.issue_body,
      settings, forceSend, results,
    });
  }

  return { date: todayStr, results };
}

// runNotificationCheck의 각 유형(실적/이슈)별 판정·중복방지·발송·로그 기록을 공통 처리하는 헬퍼.
async function checkAndSendOne(opts: {
  center: { center_code: string; center_name: string };
  type: 'warn' | 'issue';
  lastAt: string | undefined;
  sendOnDay: number;
  subjectTpl: string;
  bodyTpl: string;
  settings: any;
  forceSend: boolean;
  results: Array<Record<string, unknown>>;
}) {
  const { center, type, lastAt, sendOnDay, subjectTpl, bodyTpl, settings, forceSend, results } = opts;
  const daysSince = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000) : 999;
  if (daysSince < sendOnDay) return;

  // "즉시 발송" 버튼(forceSend)은 관리자가 지금 바로 확인하려는 의도이므로 반복발송/중복방지 검사를 건너뛴다.
  if (!forceSend) {
    if (!settings.repeat_enabled) {
      const { data: prevLog } = await supabase.from('notification_log').select('id').eq('center_code', center.center_code).eq('level', type).limit(1);
      if (prevLog && prevLog.length > 0) return;
    } else {
      const { data: recentLog } = await supabase.from('notification_log').select('sent_at').eq('center_code', center.center_code).eq('level', type).order('sent_at', { ascending: false }).limit(1);
      if (recentLog && recentLog.length > 0) {
        const lastSentDays = Math.floor((Date.now() - new Date(recentLog[0].sent_at).getTime()) / 86400000);
        if (lastSentDays < (settings.repeat_interval_days || 1)) return;
      }
    }
  }

  const { data: contacts } = await supabase.from('center_contacts').select('email').eq('center_code', center.center_code).eq('is_active', true);
  const emails = (contacts || []).map((c) => c.email);
  if (emails.length === 0) { results.push({ center: center.center_code, center_name: center.center_name, level: type, daysSince, skipped: 'no-contacts' }); return; }

  const siteLink = 'https://report.xn--2l0b841ao7b.kr/admin.html';
  const subject = (subjectTpl || '').replaceAll('{center_name}', center.center_name).replaceAll('{days}', String(daysSince));
  const textBody = (bodyTpl || '').replaceAll('{center_name}', center.center_name).replaceAll('{days}', String(daysSince)).replaceAll('{site_link}', siteLink);

  const sendResult = await sendNotificationEmail(emails, subject, textBody);
  await supabase.from('notification_log').insert({
    center_code: center.center_code, level: type, days_since: daysSince, recipients: emails, is_manual: forceSend,
    send_ok: sendResult.ok, send_error: sendResult.reason || null,
  });
  results.push({ center: center.center_code, center_name: center.center_name, level: type, daysSince, emails, sendOk: sendResult.ok, sendError: sendResult.reason || null });
}

// ============================================
// 파싱: 파일 형식별 텍스트 추출 → Gemini API로 표준 필드 매핑
// ============================================

async function parseAndStore(opts: {
  centerCode: string;
  reportDate: string;
  file: File;
  fileBuffer: ArrayBuffer;
  fieldMapping: Record<string, string> | null;
}) {
  const { centerCode, reportDate, file, fileBuffer, fieldMapping } = opts;
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  let geminiResult: Record<string, unknown>;

  if (ext === 'xlsx' || ext === 'xls') {
    // 엑셀 -> 텍스트(CSV) 추출 후 Gemini로 필드 매핑 (파일 자체를 보내지 않음 -> 토큰 절약)
    const wb = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
    const sheetText = wb.SheetNames
      .map((name) => XLSX.utils.sheet_to_csv(wb.Sheets[name]))
      .join('\n');
    geminiResult = await callGeminiText(sheetText, fieldMapping);
  } else if (ext === 'docx') {
    const { value: text } = await mammoth.extractRawText({ arrayBuffer: fileBuffer });
    geminiResult = await callGeminiText(text, fieldMapping);
  } else if (ext === 'txt' || ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(fileBuffer);
    geminiResult = await callGeminiText(text, fieldMapping);
  } else if (ext === 'pdf' || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    // PDF/이미지는 Gemini Vision에 파일 그대로 전달
    geminiResult = await callGeminiFile(fileBuffer, file.type || guessMime(ext), fieldMapping);
  } else {
    throw new Error(`지원하지 않는 파일 형식: ${ext}`);
  }

  const days = Array.isArray((geminiResult as any).days) ? (geminiResult as any).days : [];

  if (days.length === 0) {
    await supabase.from('center_daily_performance').upsert({
      center_code: centerCode,
      report_date: reportDate,
      parsed_status: 'needs_review',
      parsed_note: (geminiResult as any).note || '날짜별 데이터를 추출하지 못했습니다.',
    }, { onConflict: 'center_code,report_date' });
    return;
  }

  // 날짜별로 각각 upsert (매일 재업로드되는 월누적 파일 -> 기존 데이터는 최신 값으로 덮어씀)
  for (const day of days) {
    if (!day.date) continue;
    const hasData = Boolean(day.attendance || day.performance);
    await supabase.from('center_daily_performance').upsert({
      center_code: centerCode,
      report_date: day.date,
      attendance_data: day.attendance ?? null,
      performance_data: day.performance ?? null,
      parsed_status: hasData ? 'success' : 'needs_review',
      parsed_note: day.note || null,
      raw_file_name: file.name,
    }, { onConflict: 'center_code,report_date' });
  }
}

function buildPrompt(fieldMapping: Record<string, string> | null): string {
  const mappingHint = fieldMapping
    ? `다음 항목명 매핑을 참고하여 표준 필드명으로 변환하라: ${JSON.stringify(fieldMapping)}`
    : '문서에 등장하는 항목명을 최대한 그대로(팀명, 지표명 포함) 표준 key로 사용하라.';

  return `당신은 콜센터 일일 실적/근태 보고서에서 데이터를 추출하는 도우미다.
이 문서는 월 누적 표이며, 날짜별로 한 행씩 데이터가 쌓여 있다 (예: 6/1, 6/2, ... 6/30).

${mappingHint}

중요:
- "합계", "평균", "1주/2주/3주" 등 주간·월간 요약 행은 절대 추출하지 말고, 실제 개별 날짜 행만 추출한다.
- 값이 비어있는 날짜(공휴일 등)는 건너뛴다.
- 팀별 근태 인원, 부문별(장기사고/제휴상담 등) 콜 지표를 각각 구분되는 key로 담는다.
- 개인 이름, 주민등록번호 등 개인식별정보는 절대 추출하지 않는다.
- 연도가 문서에 없으면 이번 업로드의 보고월 기준으로 추정해 YYYY-MM-DD 형식으로 채운다.
- 설명 없이 아래 JSON 스키마로만 응답한다:
{
  "days": [
    {
      "date": "2026-06-01",
      "attendance": { "1팀": 9, "2팀": 11, "3팀": 14, "총원": 34 },
      "performance": { "장기사고_인입호": 1458, "장기사고_응답호": 1454, "장기사고_응답율": 99.9, "제휴상담_인입호": 8272, "제휴상담_응답율": 99.7 },
      "note": ""
    }
  ]
}`;
}

async function callGeminiText(text: string, fieldMapping: Record<string, string> | null) {
  const prompt = buildPrompt(fieldMapping) + `\n\n문서 내용:\n${text.slice(0, 60000)}`;
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  return extractGeminiJson(await res.json());
}

async function callGeminiFile(fileBuffer: ArrayBuffer, mimeType: string, fieldMapping: Record<string, string> | null) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
  const prompt = buildPrompt(fieldMapping);
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  return extractGeminiJson(await res.json());
}

function extractGeminiJson(data: any): Record<string, unknown> {
  // API 자체가 오류를 반환한 경우 (키 문제, 요청 형식 오류 등) 원인을 note에 남김
  if (data?.error) {
    return { note: `Gemini API 오류: ${data.error.message || JSON.stringify(data.error)}` };
  }
  try {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    return JSON.parse(text);
  } catch {
    return { note: 'Gemini 응답을 JSON으로 파싱하지 못했습니다.' };
  }
}

function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  // 한글/공백/괄호 등은 제거하고 영문·숫자만 남김. 비어버리면 'file'로 대체
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40) || 'file';
  return ext ? `${base}.${ext}` : base;
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

async function logAccess(centerCode: string | null, action: string, fileName: string | null | undefined, ip: string) {
  await supabase.from('upload_access_log').insert({
    center_code: centerCode,
    action,
    file_name: fileName || null,
    ip_address: ip,
  });
}

// RFC 2047 "encoded-word" 인코딩 - 헤더(제목/발신자명 등)에 한글이 섞여 있을 때 사용.
// Base64는 대소문자가 둘 다 의미 있는 고정 알파벳이라(quoted-printable의 "=XX" 16진수처럼
// 대/소문자를 헷갈릴 여지가 없음) 수신 서버가 무엇이든 안전하게 디코딩된다.
function encodeHeaderWord(text: string): string {
  // deno-lint-ignore no-control-regex
  if (!/[^\x00-\x7f]/.test(text)) return text; // ASCII뿐이면 인코딩 불필요
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

// 본문(UTF-8)을 RFC 2045 규격대로 76자마다 줄바꿈된 Base64로 인코딩.
function encodeBodyBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  const b64 = btoa(binary);
  return (b64.match(/.{1,76}/g) ?? [b64]).join('\r\n');
}

// Gmail SMTP(앱 비밀번호)로 알림 이메일을 발송한다. SMTP 프로토콜을 직접 구현(자세한 배경은 상단 import 옆 주석 참고).
// GMAIL_USER(발신 Gmail 주소) / GMAIL_APP_PASSWORD(구글 계정 앱 비밀번호)가 설정돼 있지 않으면 발송을 건너뛰고 false를 반환한다.
async function sendNotificationEmail(toEmails: string[], subject: string, textBody: string): Promise<{ ok: boolean; reason?: string }> {
  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailAppPassword = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!gmailUser) return { ok: false, reason: 'GMAIL_USER 시크릿이 설정되지 않았습니다.' };
  if (!gmailAppPassword) return { ok: false, reason: 'GMAIL_APP_PASSWORD 시크릿이 설정되지 않았습니다.' };
  if (toEmails.length === 0) return { ok: false, reason: '수신자 이메일이 없습니다.' };

  const conn = await Deno.connectTls({ hostname: 'smtp.gmail.com', port: 465 });
  const encoder = new TextEncoder();
  const lineReader = conn.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .getReader();

  // SMTP 다중라인 응답("250-SIZE ..." 처럼 이어지다 마지막 줄만 "250 ...")을 전부 모아 반환.
  async function readResponse(): Promise<string> {
    const collected: string[] = [];
    while (true) {
      const { value, done } = await lineReader.read();
      if (done || value === undefined) throw new Error('서버 연결이 조기 종료되었습니다.');
      collected.push(value);
      if (/^\d{3} /.test(value)) return collected.join('\n');
    }
  }
  async function writeAll(data: Uint8Array) {
    let offset = 0;
    while (offset < data.length) {
      offset += await conn.write(data.subarray(offset));
    }
  }
  async function sendCmd(line: string): Promise<string> {
    await writeAll(encoder.encode(line + '\r\n'));
    return readResponse();
  }
  function assertOk(res: string, code: string, step: string) {
    if (!res.startsWith(code)) throw new Error(step + ' 실패: ' + res.split('\n')[0]);
  }

  try {
    assertOk(await readResponse(), '220', 'SMTP 접속');
    assertOk(await sendCmd('EHLO smtp.gmail.com'), '250', 'EHLO');
    assertOk(await sendCmd('AUTH LOGIN'), '334', 'AUTH LOGIN');
    assertOk(await sendCmd(btoa(gmailUser)), '334', '사용자 인증');
    // 흔한 원인: 앱 비밀번호가 아닌 일반 로그인 비밀번호를 넣었거나, 2단계 인증이 꺼져 있는 경우
    assertOk(await sendCmd(btoa(gmailAppPassword)), '235', '비밀번호 인증');

    assertOk(await sendCmd(`MAIL FROM:<${gmailUser}>`), '250', 'MAIL FROM');
    for (const to of toEmails) {
      assertOk(await sendCmd(`RCPT TO:<${to}>`), '250', 'RCPT TO(' + to + ')');
    }
    assertOk(await sendCmd('DATA'), '354', 'DATA');

    const headerLines = [
      `From: ${encodeHeaderWord('깡비서 실적관리')} <${gmailUser}>`,
      `To: ${toEmails.map((e) => `<${e}>`).join(', ')}`,
      `Subject: ${encodeHeaderWord(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ];
    // SMTP DATA 종료는 본문 맨 앞의 '.'을 이스케이프해야 하지만(dot-stuffing), Base64 알파벳에는
    // '.'이 없어 본문에서는 해당될 일이 없다.
    const message = headerLines.join('\r\n') + '\r\n\r\n' + encodeBodyBase64(textBody) + '\r\n.\r\n';
    await writeAll(encoder.encode(message));
    assertOk(await readResponse(), '250', '메일 전송');

    await sendCmd('QUIT').catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'Gmail SMTP 오류: ' + (e as Error).message };
  } finally {
    try { lineReader.releaseLock(); } catch (_e) { /* 무시 */ }
    try { conn.close(); } catch (_e) { /* 종료 실패는 무시 */ }
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

// 자주 안 바뀌는 조회성 GET(설정값·스키마 등)에만 사용하는 짧은 캐시 응답.
// 브라우저가 짧은 시간(기본 20초) 안에 같은 요청을 다시 보내면 네트워크 왕복 없이 바로 재사용하도록 해
// 센터 전환/탭 이동을 반복할 때 체감 버퍼링을 줄인다. 실적/근태처럼 실시간성이 중요한 데이터에는 쓰지 않는다.
function jsonCached(body: unknown, status: number, maxAgeSec = 20) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `private, max-age=${maxAgeSec}` },
  });
}
