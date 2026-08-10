#!/usr/bin/env node
/**
 * 네이버 부동산(new.land.naver.com) 단지 매물 스냅샷 수집기.
 *
 * 단지 페이지 HTML에서 JWT(유효 3시간)와 쿠키를 부트스트랩한 뒤 언오피셜 JSON API를 호출한다.
 * Bearer 토큰만 보내면 429가 떨어지므로 부트스트랩 응답의 쿠키를 반드시 동반해야 한다.
 * 개인용 on-demand 소량 조회 전용 — 배치/대량 크롤링 금지.
 *
 * 사용법:
 *   node scripts/scrape.mjs --search "SK북한산시티"   단지 검색 → complexNo 확인
 *   node scripts/scrape.mjs --complex 12345           특정 단지만 수집
 *   node scripts/scrape.mjs                           apartments.json 전 단지 수집
 *
 * 출력: data/articles/{complexNo}.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APARTMENTS_JSON = join(ROOT, 'data', 'apartments.json');
const ARTICLES_DIR = join(ROOT, 'data', 'articles');

const BASE_URL = 'https://new.land.naver.com';
const BOOTSTRAP_PATH = '/complexes/22853'; // 아무 단지 페이지 (토큰 추출용)
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

const MAX_PAGES = 30;          // 단지당 최대 페이지(≈600건) — 폭주 방지
const PAGE_DELAY_MS = 400;     // 페이지 간 간격 — 과속 차단 방지
const COMPLEX_DELAY_MS = 1500; // 단지 간 간격
const BAND_UNIT = 5000;        // 가격대 구간 단위(만원) = 0.5억
const M2_PER_PYEONG = 3.305785;

/* ── 토큰/쿠키 부트스트랩 ─────────────────────────────────────────── */

let token = null;
let cookieHeader = '';
let tokenExpireAt = 0;

async function bootstrap() {
  const res = await fetch(BASE_URL + BOOTSTRAP_PATH, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
  });
  const html = await res.text();
  const m = html.match(JWT_PATTERN);
  if (!m) throw new Error('네이버 부동산 토큰 추출 실패 (봇 차단 또는 페이지 구조 변경)');

  token = m[0];
  tokenExpireAt = parseJwtExp(token);
  cookieHeader = res.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .join('; ');

  const leftMin = Math.round((tokenExpireAt - Date.now()) / 60000);
  console.log(`  토큰 발급 완료 (만료까지 ${leftMin}분)`);
}

function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    if (payload.exp > 0) return payload.exp * 1000;
  } catch {
    /* 무시 — 기본 만료시간 적용 */
  }
  return Date.now() + 2 * 60 * 60 * 1000;
}

async function ensureToken() {
  if (token && Date.now() < tokenExpireAt - 5 * 60 * 1000) return;
  await bootstrap();
}

/* ── API 호출 ─────────────────────────────────────────────────────── */

async function apiGet(path, retried = false) {
  await ensureToken();
  const res = await fetch(BASE_URL + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookieHeader,
      Referer: BASE_URL + BOOTSTRAP_PATH,
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });

  // 401/429 → 토큰 만료·차단 가능성. 재부트스트랩 후 1회만 재시도.
  if ((res.status === 401 || res.status === 429) && !retried) {
    console.warn(`  네이버 API ${res.status} 응답 — 토큰 재발급 후 재시도`);
    token = null;
    await sleep(2000);
    return apiGet(path, true);
  }
  if (!res.ok) throw new Error(`네이버 API ${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

const searchComplexes = (keyword) =>
  apiGet(`/api/search?keyword=${encodeURIComponent(keyword)}`).then((r) => r.complexes ?? []);

const getComplexDetail = (complexNo) =>
  apiGet(`/api/complexes/${complexNo}?sameAddressGroup=false`).then((r) => r.complexDetail ?? {});

/**
 * 단지 매물 목록 1페이지. tradeType 빈값 = 매매/전세/월세 전체.
 * sameAddressGroup=true: 같은 물건을 여러 중개사가 올린 '동일매물'을 하나로 묶는다
 * (네이버 웹 기본값). false로 두면 중복 매물이 각각 잡혀 건수가 부풀려진다.
 */
const getComplexArticles = (complexNo, page) =>
  apiGet(
    `/api/articles/complex/${complexNo}` +
      `?realEstateType=APT&tradeType=&priceType=RETAIL` +
      `&showArticle=false&sameAddressGroup=true&order=rank&page=${page}`
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readPrev(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null; // 파일이 없거나 깨졌으면 새로 쓴다
  }
}

/** 수집 시각을 뺀 나머지가 같은지. 같으면 파일을 건드리지 않아 불필요한 커밋을 막는다. */
const sameContent = (a, b) =>
  !!a && !!b && JSON.stringify({ ...a, scrapedAt: null }) === JSON.stringify({ ...b, scrapedAt: null });

/* ── 파싱 ─────────────────────────────────────────────────────────── */

/** "12억 5,000" → 125000(만원), "8억" → 80000, "5,000" → 5000. 실패 시 null. */
function parsePriceManwon(s) {
  if (!s) return null;
  const t = String(s).replace(/[,\s]/g, '').trim();
  if (!t) return null;
  if (t.includes('억')) {
    const [a, b] = t.split('억');
    const eok = Number(a);
    const man = b ? Number(b) : 0;
    if (!Number.isFinite(eok) || !Number.isFinite(man)) return null;
    return eok * 10000 + man;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * 매물 정규화. 전용면적(area2 우선, 없으면 area1)과 가격(dealOrWarrantPrc = 매매가/보증금)을 추출.
 * 네이버 응답 필드명 변경에 대비해 방어적으로 파싱하고, 파싱 불가 매물은 버린다.
 */
function parseArticle(a) {
  const tradeType = a.tradeTypeName ?? '';
  if (!tradeType) return null;

  const exclusive = Number(a.area2) > 0 ? Number(a.area2) : Number(a.area1);
  if (!(exclusive > 0)) return null;

  const price = parsePriceManwon(a.dealOrWarrantPrc);
  if (price == null) return null;

  return {
    articleNo: String(a.articleNo ?? ''),
    tradeType,
    exclusiveM2: exclusive,               // 전용면적
    supplyM2: Number(a.area1) > 0 ? Number(a.area1) : null, // 공급면적
    price,                                 // 매매가 또는 보증금 (만원)
    rent: parsePriceManwon(a.rentPrc) ?? 0, // 월세 (만원), 매매/전세는 0
    floor: a.floorInfo ?? '',
    direction: a.direction ?? '',
    building: a.buildingName ?? '',
    confirmYmd: a.articleConfirmYmd ?? '',
    feature: a.articleFeatureDesc ?? '',
    realtor: a.realtorName ?? '',
  };
}

/* ── 집계 ─────────────────────────────────────────────────────────── */

const eok = (manwon) => (manwon / 10000).toFixed(1).replace(/\.0$/, '') + '억';
const toPyeong = (m2) => Math.round(m2 / M2_PER_PYEONG);
const median = (nums) => {
  const s = [...nums].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * 한 거래유형을 [전용면적 행 × 0.5억 가격대 열] 매트릭스로 집계.
 * 가격대는 0원 기준 0.5억 절대 그리드라 단지끼리 같은 눈금으로 비교된다.
 * 매물이 하나도 없는 양끝 구간은 잘라내 열 수가 불필요하게 늘지 않게 한다.
 */
function aggregateGroup(tradeType, list) {
  const prices = list.map((a) => a.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const loBand = Math.floor(minPrice / BAND_UNIT);
  const hiBand = Math.floor(maxPrice / BAND_UNIT);
  const bandCount = hiBand - loBand + 1;
  const priceBands = Array.from({ length: bandCount }, (_, i) => {
    const lo = (loBand + i) * BAND_UNIT;
    return { lo, hi: lo + BAND_UNIT, label: eok(lo) };
  });

  // 행: 전용면적 정수 ㎡별, 오름차순
  const areaKeys = [...new Set(list.map((a) => Math.round(a.exclusiveM2)))].sort((x, y) => x - y);
  const areaIndex = new Map(areaKeys.map((k, i) => [k, i]));

  const matrix = areaKeys.map(() => Array(bandCount).fill(0));
  const rowTotals = Array(areaKeys.length).fill(0);
  const colTotals = Array(bandCount).fill(0);

  for (const a of list) {
    const r = areaIndex.get(Math.round(a.exclusiveM2));
    const c = Math.floor(a.price / BAND_UNIT) - loBand;
    matrix[r][c]++;
    rowTotals[r]++;
    colTotals[c]++;
  }

  const areas = areaKeys.map((m2) => {
    const rows = list.filter((a) => Math.round(a.exclusiveM2) === m2);
    const ps = rows.map((a) => a.price);
    // 공급면적은 같은 전용면적 안에서도 편차가 있어 최빈값을 대표로 삼는다
    const supplies = rows.map((a) => a.supplyM2).filter(Boolean).map((v) => Math.round(v));
    const supplyM2 = supplies.length ? mode(supplies) : null;
    return {
      exclusiveM2: m2,
      supplyM2,
      pyeong: supplyM2 ? toPyeong(supplyM2) : toPyeong(m2),
      count: rows.length,
      min: Math.min(...ps),
      max: Math.max(...ps),
      median: median(ps),
    };
  });

  return {
    tradeType,
    total: list.length,
    minPrice,
    maxPrice,
    priceBands,
    areas,
    matrix,
    rowTotals,
    colTotals,
  };
}

function mode(nums) {
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/* ── 수집 ─────────────────────────────────────────────────────────── */

const TRADE_ORDER = ['매매', '전세', '월세'];

async function scrapeComplex(complexNo, name) {
  console.log(`\n▸ ${name ?? ''} (complexNo=${complexNo}) 수집 시작`);

  let detail = {};
  try {
    detail = await getComplexDetail(complexNo);
  } catch (e) {
    console.warn(`  단지 상세 조회 실패 — 매물만 수집: ${e.message}`);
  }

  const articles = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const root = await getComplexArticles(complexNo, page);
    const list = root.articleList ?? [];
    if (!list.length) break;

    for (const a of list) {
      const no = String(a.articleNo ?? '');
      if (no && seen.has(no)) continue; // 페이지 경계 중복 방어
      if (no) seen.add(no);
      const parsed = parseArticle(a);
      if (parsed) articles.push(parsed);
    }
    process.stdout.write(`  page ${page} · 누적 ${articles.length}건\r`);

    if (!root.isMoreData) break;
    if (page === MAX_PAGES) console.warn(`\n  매물 페이지 상한(${MAX_PAGES}) 도달`);
    await sleep(PAGE_DELAY_MS);
  }
  console.log(`  총 ${articles.length}건 수집 완료`);

  // 네이버 응답은 호출할 때마다 매물 순서가 달라진다. articleNo로 고정해두지 않으면
  // 내용이 하나도 안 바뀌어도 파일 전체가 diff로 잡혀 매번 커밋이 생긴다.
  articles.sort((a, b) => a.articleNo.localeCompare(b.articleNo));

  const byType = new Map(TRADE_ORDER.map((t) => [t, []]));
  for (const a of articles) {
    if (!byType.has(a.tradeType)) byType.set(a.tradeType, []);
    byType.get(a.tradeType).push(a);
  }

  const byTradeType = [];
  for (const [type, list] of byType) {
    if (!list.length) continue;
    byTradeType.push(aggregateGroup(type, list));
    console.log(`    ${type} ${list.length}건`);
  }

  return {
    complexNo: String(complexNo),
    complexName: detail.complexName ?? name ?? '',
    scrapedAt: new Date().toISOString(),
    totalCount: articles.length,
    detail: {
      address: detail.address ?? '',
      // 세대수 필드명이 응답마다 흔들려서 후보를 순서대로 시도한다
      totalHouseHold:
        detail.totalHouseHoldCount ?? detail.totalHouseholdCount ?? detail.householdCount ?? null,
      totalDong: detail.totalDongCount ?? null,
      useApproveYmd: detail.useApproveYmd ?? '',
      highFloor: detail.highFloor ?? null,
      lowFloor: detail.lowFloor ?? null,
      parkingPerHousehold: detail.parkingCountByHousehold ?? null,
      floorAreaRatio: detail.batlRatio ?? null,          // 용적률(%) — 실측 271
      buildingCoverageRatio: detail.btlRatio ?? null,    // 건폐율(%) — 실측 17
    },
    byTradeType,
    articles,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  const keyword = flag('--search');
  if (keyword) {
    const results = await searchComplexes(keyword);
    if (!results.length) return console.log('검색 결과 없음');
    console.log(`\n"${keyword}" 검색 결과 ${results.length}건\n`);
    for (const c of results) {
      console.log(
        `  complexNo=${c.complexNo}\t${c.complexName}\t${c.cortarAddress ?? ''} ` +
          `${c.totalHouseholdCount ?? c.totalHouseHoldCount ?? '?'}세대 ${c.completionYearMonth ?? ''}`
      );
    }
    console.log('\n→ data/apartments.json 의 complexNo 필드에 넣으면 됩니다.\n');
    return;
  }

  await mkdir(ARTICLES_DIR, { recursive: true });

  let targets;
  const one = flag('--complex');
  if (one) {
    targets = [{ complexNo: one, name: null }];
  } else {
    const meta = JSON.parse(await readFile(APARTMENTS_JSON, 'utf8'));
    targets = meta.apartments
      .filter((a) => a.complexNo)
      .map((a) => ({ complexNo: a.complexNo, name: a.name }));
    if (!targets.length) {
      return console.log('apartments.json에 complexNo가 설정된 아파트가 없습니다.');
    }
  }

  for (const [i, t] of targets.entries()) {
    try {
      const data = await scrapeComplex(t.complexNo, t.name);
      const out = join(ARTICLES_DIR, `${t.complexNo}.json`);
      const prev = await readPrev(out);

      if (sameContent(prev, data)) {
        const hours = Math.round((Date.now() - new Date(prev.scrapedAt).getTime()) / 3600000);
        console.log(`  변동 없음 — 파일을 그대로 둡니다 (마지막 변동 ${hours}시간 전)`);
      } else {
        await writeFile(out, JSON.stringify(data, null, 2), 'utf8');
        console.log(`  → ${out}`);
      }
    } catch (e) {
      console.error(`  ✕ ${t.name ?? t.complexNo} 실패: ${e.message}`);
    }
    if (i < targets.length - 1) await sleep(COMPLEX_DELAY_MS);
  }
  console.log('\n완료. 변경된 data/articles/*.json 을 커밋하면 페이지에 반영됩니다.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
