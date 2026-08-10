/**
 * 네이버 부동산 매물 스냅샷 렌더러.
 *
 * data/articles/{complexNo}.json 을 읽어 거래유형(매매/전세/월세)별로
 *   ① 평형별 가격 요약  ② 평형 × 0.5억 가격대 매트릭스  ③ 매물 원본 목록
 * 을 그린다. 스냅샷은 scripts/scrape.mjs 로 갱신한다.
 *
 * 사용:
 *   <link rel="stylesheet" href="assets/articles.css">
 *   <script src="assets/articles.js"></script>
 *   <script>AptArticles.mount('#articles', {
 *     complexNo: '3098',
 *     pyeongAlias: { 59: '24평', 84: '33평', 114: '43평' }   // 선택: 단지에서 통용되는 평형 표기
 *   })</script>
 */
window.AptArticles = (() => {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /** 만원 → "8.5억" / 5000만원 미만은 "3,000만" */
  const eok = (m) =>
    m >= 10000
      ? (m / 10000).toFixed(1).replace(/\.0$/, '') + '억'
      : m.toLocaleString('ko-KR') + '만';

  const ymd = (s) =>
    /^\d{8}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : s || '';

  /**
   * 평형 표기. 공급면적 반올림값은 단지에서 실제로 부르는 이름과 1평씩 어긋나는 일이 잦아서
   * (예: 공급 81.4㎡ → 계산상 25평이지만 분양 표기는 24평),
   * pyeongAlias로 전용면적 → 표기명을 지정하면 그쪽을 우선한다.
   */
  const pyeongLabel = (a, alias) => alias?.[a.exclusiveM2] ?? `${a.pyeong}평`;

  function scrapedText(iso) {
    const d = new Date(iso);
    const date = d.toLocaleString('ko-KR', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const h = Math.floor((Date.now() - d.getTime()) / 3600000);
    const rel = h < 1 ? '방금' : h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
    return `${date} (${rel})`;
  }

  /* ── 평형별 가격 요약 ── */
  function areaTable(g, monthlyByArea, alias) {
    const isRent = g.tradeType === '월세';
    const rows = g.areas
      .map((a) => {
        const rent = monthlyByArea?.get(a.exclusiveM2);
        const py = pyeongLabel(a, alias);
        return `
      <tr>
        <td>전용 ${a.exclusiveM2}㎡<span class="na-pyeong">${a.supplyM2 ? `공급 ${a.supplyM2}㎡ · ${py}` : py}</span></td>
        <td>${a.count}</td>
        <td>${eok(a.min)}</td>
        <td>${eok(a.median)}</td>
        <td>${eok(a.max)}</td>
        ${isRent ? `<td>${rent ? (rent.min === rent.max ? `${rent.min}만` : `${rent.min}~${rent.max}만`) : '—'}</td>` : ''}
      </tr>`;
      })
      .join('');

    return `
    <div class="na-scroll">
      <table class="na">
        <thead><tr>
          <th>평형</th><th>매물</th>
          <th>최저${isRent ? ' 보증금' : ''}</th><th>중앙값</th><th>최고${isRent ? ' 보증금' : ''}</th>
          ${isRent ? '<th>월세</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /* ── 평형 × 가격대 매트릭스 ── */
  function heatTable(g, alias) {
    const maxCell = Math.max(1, ...g.matrix.flat());
    // 밴드 라벨은 스냅샷에도 있지만, 억 미만을 "5,000만"으로 쓰는 렌더러 포맷으로 통일한다
    const head = g.priceBands.map((b) => `<th>${eok(b.lo)}</th>`).join('');

    const body = g.areas
      .map((a, r) => {
        const cells = g.matrix[r]
          .map((v) => {
            if (!v) return '<td><span class="na-zero">·</span></td>';
            // 건수가 많을수록 진하게 — 거래유형 accent 색을 알파로 깐다
            const alpha = (0.14 + 0.5 * (v / maxCell)).toFixed(3);
            return `<td><span class="na-cell" style="background:color-mix(in srgb, var(--na-accent) ${Math.round(
              alpha * 100
            )}%, transparent)">${v}</span></td>`;
          })
          .join('');
        return `<tr><td>전용 ${a.exclusiveM2}㎡<span class="na-pyeong">${pyeongLabel(a, alias)}</span></td>${cells}<td><b>${g.rowTotals[r]}</b></td></tr>`;
      })
      .join('');

    const sums = g.colTotals.map((t) => `<td>${t || '·'}</td>`).join('');

    return `
    <div class="na-scroll">
      <table class="na heat">
        <thead><tr><th class="corner">평형 ＼ ${g.tradeType === '월세' ? '보증금' : '가격'}</th>${head}<th>계</th></tr></thead>
        <tbody>
          ${body}
          <tr class="na-sum"><td>계</td>${sums}<td>${g.total}</td></tr>
        </tbody>
      </table>
    </div>`;
  }

  /* ── 매물 원본 목록 ── */
  function listTable(g, articles) {
    const rows = articles
      .slice()
      .sort((a, b) => a.price - b.price)
      .map(
        (a) => `
      <tr>
        <td class="price">${eok(a.price)}${a.rent ? ` / ${a.rent}만` : ''}</td>
        <td>전용 ${a.exclusiveM2}㎡</td>
        <td>${esc(a.building)}</td>
        <td>${esc(a.floor)}</td>
        <td>${esc(a.direction)}</td>
        <td>${ymd(a.confirmYmd)}</td>
        <td class="feat">${esc(a.feature)}</td>
      </tr>`
      )
      .join('');

    return `
    <details class="na-list">
      <summary>${g.tradeType} 매물 ${articles.length}건 자세히 보기</summary>
      <div class="na-scroll">
        <table class="na rows">
          <thead><tr>
            <th>${g.tradeType === '월세' ? '보증금/월세' : '가격'}</th><th>전용</th><th>동</th>
            <th>층</th><th>향</th><th>확인일</th><th class="feat">특징</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
  }

  function groupHtml(g, articles, alias) {
    const mine = articles.filter((a) => a.tradeType === g.tradeType);

    // 월세는 보증금으로 집계하므로 월세액 범위를 평형별로 따로 계산해 덧붙인다
    let monthlyByArea = null;
    if (g.tradeType === '월세') {
      monthlyByArea = new Map();
      for (const a of mine) {
        const k = Math.round(a.exclusiveM2);
        const cur = monthlyByArea.get(k) ?? { min: Infinity, max: -Infinity };
        cur.min = Math.min(cur.min, a.rent);
        cur.max = Math.max(cur.max, a.rent);
        monthlyByArea.set(k, cur);
      }
    }

    const range = g.minPrice === g.maxPrice ? eok(g.minPrice) : `${eok(g.minPrice)} ~ ${eok(g.maxPrice)}`;
    return `
    <div class="na-group" data-trade="${g.tradeType}" data-panel="${g.tradeType}">
      <div class="na-h">평형별 가격 <span class="sub">${g.total}건 · ${range}${g.tradeType === '월세' ? ' (보증금 기준)' : ''}</span></div>
      ${areaTable(g, monthlyByArea, alias)}
      <div class="na-h">가격대 분포 <span class="sub">0.5억 단위 · 셀은 매물 건수</span></div>
      ${heatTable(g, alias)}
      ${listTable(g, mine)}
    </div>`;
  }

  function render(el, snap, { pyeongAlias } = {}) {
    const groups = snap.byTradeType || [];
    if (!groups.length) {
      el.innerHTML = `<div class="na-state"><b>등록된 매물이 없습니다</b>수집 시점(${scrapedText(
        snap.scrapedAt
      )}) 기준으로 네이버 부동산에 올라온 매물이 없습니다.</div>`;
      return;
    }

    const d = snap.detail || {};
    const meta = [
      d.totalHouseHold ? `<b>${d.totalHouseHold.toLocaleString('ko-KR')}</b>세대` : '',
      d.totalDong ? `<b>${d.totalDong}</b>개 동` : '',
      d.useApproveYmd ? `<b>${ymd(d.useApproveYmd)}</b> 사용승인` : '',
      d.lowFloor && d.highFloor ? `<b>${d.lowFloor}~${d.highFloor}</b>층` : '',
      d.parkingPerHousehold ? `세대당 주차 <b>${d.parkingPerHousehold}</b>대` : '',
      d.floorAreaRatio ? `용적률 <b>${d.floorAreaRatio}%</b>` : '',
      d.buildingCoverageRatio ? `건폐율 <b>${d.buildingCoverageRatio}%</b>` : '',
    ].filter(Boolean);

    el.innerHTML = `
      <div class="na-meta">
        <span>수집 ${scrapedText(snap.scrapedAt)}</span>
        <span>전체 <b>${snap.totalCount}</b>건</span>
        ${meta.map((m) => `<span>${m}</span>`).join('')}
      </div>
      <div class="na-tabs" role="tablist">
        ${groups
          .map(
            (g, i) =>
              `<button type="button" role="tab" data-trade="${g.tradeType}" aria-selected="${
                i === 0
              }" style="--na-accent:${
                { 매매: '#a8563c', 전세: '#2f5d4f', 월세: '#c08a2e' }[g.tradeType] || '#2f5d4f'
              }">${g.tradeType}<span class="c">${g.total}</span></button>`
          )
          .join('')}
      </div>
      ${groups.map((g) => groupHtml(g, snap.articles || [], pyeongAlias)).join('')}`;

    const panels = [...el.querySelectorAll('[data-panel]')];
    const tabs = [...el.querySelectorAll('.na-tabs button')];
    const select = (trade) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.trade === trade)));
      panels.forEach((p) => (p.hidden = p.dataset.panel !== trade));
    };
    tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.trade)));
    select(groups[0].tradeType);
  }

  async function mount(selector, { complexNo, base = '', pyeongAlias } = {}) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.innerHTML = '<div class="na-state">매물 정보를 불러오는 중…</div>';

    try {
      const res = await fetch(`${base}data/articles/${complexNo}.json`);
      if (!res.ok) throw new Error(String(res.status));
      const snap = await res.json();
      render(el, snap, { pyeongAlias });
      return snap;
    } catch (e) {
      el.innerHTML = `<div class="na-state"><b>매물 정보를 불러오지 못했습니다</b>
        브라우저에서 파일을 직접 연 경우(<code>file://</code>)에는 읽을 수 없습니다.
        <code>npm run serve</code> 로 띄우거나 GitHub Pages 주소로 열어주세요.<br>
        스냅샷이 아직 없다면 <code>npm run scrape</code> 로 수집하세요.</div>`;
    }
  }

  return { mount, render };
})();
