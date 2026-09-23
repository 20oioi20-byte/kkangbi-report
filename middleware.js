// 회사 VPN에 연결된 상태로 이 사이트에 접속하는 걸 막기 위한 안전장치.
// 2026-09-23에 회사 VPN 연결 중 관측된 실제 아웃바운드 IP(KT, 서울) 기준으로 차단한다.
// 한계: 이건 "실제 화면 접근"만 막을 뿐, 접속을 시도했다는 흔적(DNS/방화벽 로그) 자체를
// 지우지는 못한다 — 그건 서버 쪽에서 통제할 수 있는 부분이 아니다.
// 회사 VPN 게이트웨이가 다른 IP를 쓰게 되면 이 목록을 갱신해야 한다.
const BLOCKED_IPS = new Set([
  '222.109.154.188',
]);

export const config = {
  matcher: ['/', '/admin.html', '/upload.html', '/m.html'],
};

export default function middleware(request) {
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const ip = request.headers.get('x-real-ip') || forwardedFor.split(',')[0].trim();

  if (BLOCKED_IPS.has(ip)) {
    return new Response(null, { status: 404 });
  }
  // 그 외 IP는 평소처럼 통과 (반환값 없음 = 정상 라우팅 계속)
}
