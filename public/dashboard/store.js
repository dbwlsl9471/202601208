/*
 * 대시보드 저장소 연결부 (Next.js 서버용). app.js는 window.DashboardStore만 쓴다.
 *   load()         GET /api/data → 저장된 문서. 아직 저장된 적이 없으면 dashboard-data.json(초기 데이터)
 *   canEdit()      관리자로 로그인했고 저장소가 설정돼 있으면 true
 *   who()          저장 기록에 남길 이름(ADMIN_NAME)
 *   save(db)       PUT /api/data. 실패하면 {code, message}를 던진다(not_granted, conflict …)
 *   subscribe(fn)  1분마다 버전을 확인해 다른 화면에서 저장했으면 fn(db)
 *   prefs          당사·경쟁사 선택은 이 브라우저(localStorage)에 저장
 */
(function () {
  'use strict';
  const PREF_KEY = 'pension-dashboard-prefs-v1';
  const err = (code, message) => Object.assign(new Error(message), { code });
  let currentVer = 0;
  let sessionP = null;
  const session = () => (sessionP = sessionP || fetch('/api/session', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ admin: false })));

  async function fetchDoc() {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error('저장된 데이터를 읽지 못했습니다(' + res.status + ')');
    const j = await res.json();
    if (j.doc) return { ver: j.ver, doc: j.doc };
    const seed = await fetch('/dashboard/dashboard-data.json', { cache: 'no-store' });
    if (!seed.ok) throw new Error('초기 데이터 파일을 읽지 못했습니다(' + seed.status + ')');
    return { ver: 0, doc: await seed.json() };
  }

  window.DashboardStore = {
    name: 'nextjs',
    offline: false,
    readOnlyNote: '보기 전용입니다. 데이터 업로드·삭제는 관리자 로그인 후 할 수 있습니다.',

    async load() {
      const { ver, doc } = await fetchDoc();
      currentVer = ver;
      const s = await session();
      if (s.admin && !s.canSave) this.readOnlyNote = '저장소(Supabase)가 설정되지 않아 저장할 수 없습니다. README의 배포 방법을 확인해 주세요.';
      return doc;
    },
    async canEdit() { return Boolean((await session()).canSave); },
    async who() { return (await session()).name || null; },

    async save(doc) {
      const res = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc, baseVer: currentVer }),
      });
      let j = {};
      try { j = await res.json(); } catch (e) { /* 본문 없음 */ }
      if (!res.ok) {
        const code = res.status === 401 || res.status === 403 ? 'not_granted' : j.code || 'failed';
        if (code === 'conflict') refresh();
        throw err(code, j.message || '저장하지 못했습니다(' + res.status + ')');
      }
      currentVer = j.ver;
      return doc;
    },

    subscribe(fn) {
      listeners.push(fn);
      if (!timer) timer = setInterval(() => { if (document.visibilityState === 'visible') check(); }, 60000);
      return () => { listeners = listeners.filter((f) => f !== fn); };
    },

    prefs: {
      async load() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { return null; } },
      async save(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* 저장 못 해도 화면은 동작 */ } },
    },
  };

  let listeners = [], timer = null;
  async function check() {
    try {
      const m = await (await fetch('/api/data?meta=1', { cache: 'no-store' })).json();
      if (m.ver && m.ver !== currentVer) refresh();
    } catch (e) { /* 다음 확인 때 다시 */ }
  }
  async function refresh() {
    try {
      const { ver, doc } = await fetchDoc();
      if (ver === currentVer) return;
      currentVer = ver;
      listeners.forEach((f) => f(doc));
    } catch (e) { /* 다음 확인 때 다시 */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && listeners.length) check(); });
})();
