# 이사 후보 아파트 분석

이사 후보로 보고 있는 아파트 단지를 하나씩 분석해 모아둔 정적 사이트.
`index.html`이 후보 목록이고, 카드를 누르면 단지별 분석 페이지로 들어간다.

각 단지 페이지에는 네이버 부동산에서 수집한 **매물 시세 스냅샷**이 탭으로 붙는다.

```
index.html                  후보 단지 목록 (카드 그리드)
sk-map.html                 SK북한산시티 — 배치도 / 입주민 이야기 / 매물 시세
data/apartments.json        단지 메타 목록 — 여기에 추가하면 카드가 생긴다
data/articles/{no}.json     단지별 매물 스냅샷 (scrape.mjs가 생성)
assets/base.css             공통 팔레트·타이포
assets/articles.css|js      매물 렌더러 (모든 단지 페이지 공용)
scripts/scrape.mjs          네이버 부동산 수집기
update-prices.bat           매물 갱신 — 더블클릭용 런처
scripts/update-prices.ps1   갱신 본체 (수집 → 커밋 → 푸시)
```

## 열어보기

`file://`로 직접 열면 브라우저가 `fetch`를 막아서 데이터가 안 보인다. 둘 중 하나로 연다.

```bash
npm run serve        # 로컬 정적 서버 (http://localhost:3000)
```

또는 GitHub Pages 주소로 접속한다.

## 매물 시세 갱신

**`update-prices.bat` 더블클릭.** 수집부터 커밋·푸시까지 한 번에 끝난다.
푸시하고 20초쯤 지나면 사이트에 반영된다.

- 매물이 하나도 안 바뀌었으면 커밋하지 않는다. 매일 돌려도 히스토리가 안 쌓인다.
- 지난번 푸시가 실패해 남은 커밋이 있으면 이번에 마저 올린다.
- 어느 단계에서 실패하든 원인과 대처를 알려주고 멈춘다.

```
update-prices.bat -NoPush     커밋까지만 하고 푸시는 생략
update-prices.bat -NoPause    끝나고 창을 바로 닫음 (예약 실행용)
```

손으로 돌리려면:

```bash
npm run scrape                      # apartments.json의 모든 단지 수집
npm run scrape -- --complex 3098    # 특정 단지만
git add data/articles
git commit -m "매물 시세 갱신"
git push
```

수집이 끝나면 `data/articles/*.json`이 갱신된다. **커밋해야 Pages에 반영된다.**

> 배치파일은 ASCII로만 써야 한다. cmd.exe가 UTF-8 배치파일의 한글을 파싱하지 못해
> 인자 처리까지 깨진다. 그래서 로직은 전부 `scripts/update-prices.ps1`에 있고,
> 이 파일은 Windows PowerShell 5.1이 한글을 제대로 읽도록 **UTF-8 BOM**으로 저장돼 있다.
> 편집할 때 BOM을 날리지 말 것.

> **회사망 등 SSL 인스펙션 환경**에서는 Node가 인증서 검증에 실패한다.
> npm 스크립트에 `--use-system-ca`가 이미 들어가 있어 그대로 쓰면 된다.

수집은 네이버 부동산 단지 페이지에서 토큰을 부트스트랩한 뒤 언오피셜 JSON API를 호출하는 방식이다.
**개인용 소량 조회 전용**이며, 페이지 간 400ms·단지 간 1.5초 간격을 두고 단지당 30페이지에서 끊는다.
자동화(cron, GitHub Actions)로 돌리지 말 것 — 클라우드 IP는 차단당하기 쉽고, 애초에 그럴 용도가 아니다.

## 단지 추가하기

1. 분석 페이지를 만든다 (예: `xx-apt.html`). 기존 `sk-map.html`을 참고.
2. 페이지 `<head>`에 공용 스타일을 건다.

   ```html
   <link rel="stylesheet" href="assets/base.css">
   <link rel="stylesheet" href="assets/articles.css">
   ```

3. `<body>` 맨 위에 목록 복귀 바를 넣는다.

   ```html
   <nav class="topbar"><div class="inner">
     <a href="index.html">← 후보 단지 목록</a>
     <span class="sep">/</span><span class="cur">단지명</span>
   </div></nav>
   ```

4. 매물을 붙일 자리에 `<div id="articles"></div>`를 두고, 페이지 끝에서 렌더러를 호출한다.

   ```html
   <script src="assets/articles.js"></script>
   <script>
   AptArticles.mount('#articles', {
     complexNo: '3098',
     pyeongAlias: { 59: '24평', 84: '33평', 114: '43평' }
   });
   </script>
   ```

   `pyeongAlias`는 선택이다. 공급면적을 평으로 환산하면 단지에서 실제로 부르는 이름과
   1평씩 어긋나는 경우가 잦아서(공급 81.4㎡ → 계산상 25평, 분양 표기는 24평),
   전용면적 → 표기명을 직접 지정할 수 있게 해뒀다.

5. 단지의 `complexNo`를 찾는다.

   ```bash
   npm run search -- "단지명"
   ```

6. `data/apartments.json`에 항목을 추가하고 `npm run scrape`를 돌린다.

   ```json
   {
     "id": "xx-apt",
     "name": "단지명",
     "file": "xx-apt.html",
     "complexNo": "12345",
     "region": "서울 ○○구",
     "address": "○○동 000 · ○○로 00",
     "built": "2004.05",
     "accent": "#2f5d4f",
     "tags": ["특징", "특징"],
     "summary": "카드에 들어갈 한 문장 요약.",
     "highlights": [{ "label": "총 세대수", "value": "5,327" }]
   }
   ```

## 매물 데이터 읽는 법

가격대는 **0.5억 단위 절대 구간**이다. 단지마다 눈금이 달라지지 않으므로 후보끼리 그대로 비교된다.
매물이 하나도 없는 양끝 구간은 표에서 잘라낸다.

- **평형별 가격** — 전용면적별 매물 수와 최저/중앙값/최고. 시세 감은 중앙값으로 본다.
- **가격대 분포** — 평형 × 가격대 히트맵. 같은 평형이 어느 구간에 몰려 있는지가 협상 여지를 말해준다.
- **매물 목록** — 동·층·향·확인일·특징. 배치도와 겹쳐 보면 어느 라인 매물인지 바로 나온다.

집계는 네이버의 **동일매물 묶음** 기준이라, 같은 물건을 여러 중개사가 올린 건은 1건으로 센다.
월세는 보증금으로 집계하고 월세액은 평형별 범위로 따로 표시한다.

전부 **호가이며 실거래가가 아니다.** 실거래는 국토부 데이터를 따로 봐야 한다.
