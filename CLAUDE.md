# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 성격

이사 후보 아파트를 단지별로 분석해 모아둔 **정적 사이트**. 빌드 스텝이 없고, `main` 브랜치 루트가
그대로 GitHub Pages로 서빙된다 (https://leegyuhun.github.io/AnalysisApt/). 저장소는 public이다.

테스트 프레임워크, 린터, 번들러 모두 없다. 없는 걸 찾지 말 것.

## 명령어

```bash
npm run serve                       # 로컬 정적 서버. 반드시 이걸로 열 것 (아래 참조)
npm run scrape                      # apartments.json의 모든 단지 매물 수집
npm run scrape -- --complex 3098    # 특정 단지만
npm run search -- "단지명"           # 네이버에서 단지 검색 → complexNo 확인
update-prices.bat                   # 수집 → 커밋 → 푸시 한 번에 (평소 갱신은 이것만)
```

`update-prices.bat -NoPush`는 커밋까지만, `-NoPause`는 창을 바로 닫는다.

## 아키텍처

### 데이터 파이프라인

수집과 렌더가 완전히 분리돼 있고, 그 사이 계약이 `data/articles/{complexNo}.json`이다.

```
scripts/scrape.mjs  →  data/articles/{complexNo}.json  →  assets/articles.js
   (Node, 수집·집계)        (커밋되는 스냅샷)              (브라우저, 그리기만)
```

**집계는 전부 수집 시점에 끝나 있다.** 평형×가격대 매트릭스, 행/열 합계, 평형별 최저·중앙·최고가가
모두 JSON에 들어 있고, 렌더러는 계산하지 않는다. 집계 방식을 바꾸려면 `scrape.mjs`를 고치고
재수집해야 하며, 기존 스냅샷은 자동으로 갱신되지 않는다.

예외적으로 렌더러가 직접 계산하는 것은 월세액 범위뿐이다. 월세는 보증금 기준으로 집계하므로
월세액은 `articles` 원본에서 평형별로 다시 뽑는다.

### 단지 레지스트리

`data/apartments.json`이 단일 진실 공급원이다. `index.html`이 이걸 읽어 카드를 만들고,
각 단지의 `complexNo`로 스냅샷을 추가로 fetch해 카드 하단 시세 요약을 붙인다.
스냅샷이 없으면 그 부분만 조용히 생략된다.

단지 페이지(`sk-map.html` 등)는 각자 독립된 HTML이고 자체 스타일을 인라인으로 갖는다.
공유하는 것은 `assets/`의 셋뿐이다 — `base.css`(팔레트·복귀바), `articles.css`, `articles.js`.
새 단지를 추가하는 절차는 README에 정리돼 있다.

### 왜 스냅샷 방식인가

네이버 부동산은 브라우저에서 직접 호출할 수 없다. CORS가 막히고, 애초에 단지 페이지 HTML을 긁어
JWT를 부트스트랩해야 API를 부를 수 있다. GitHub Pages에는 백엔드가 없으므로 Node로 수집해
JSON을 커밋하는 방식 외에 선택지가 없다. **실시간 조회 기능을 추가하려는 시도는 이 제약에 막힌다.**

`scripts/scrape.mjs`는 `E:\Git_leegh\AptPriceWebView`의 `NaverLandClient` / `NaverArticleService`
(Java)를 포팅한 것이다. 네이버 응답 구조가 바뀌면 양쪽을 같이 봐야 한다.

## 반드시 알아야 할 함정

**`file://`로 열면 아무것도 안 보인다.** 브라우저가 fetch를 막아 `apartments.json`과 스냅샷을
못 읽는다. 그 경우 안내 메시지가 뜨도록 해뒀다. 확인은 `npm run serve` 또는 Pages 주소로.

**SSL 인스펙션 환경이라 `--use-system-ca`가 필수다.** 없으면 Node가 인증서 검증에 실패한다
(`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). npm 스크립트에는 이미 들어 있지만, `node scripts/scrape.mjs`를
직접 부르면 빠지니 주의.

**`update-prices.bat`은 ASCII로만 쓴다.** cmd.exe가 UTF-8 배치파일의 한글을 파싱하지 못해
메시지가 깨지고 인자 처리까지 망가진다. 그래서 로직은 전부 `scripts/update-prices.ps1`에 있고
bat은 런처일 뿐이다.

**`scripts/update-prices.ps1`은 UTF-8 BOM으로 저장돼야 한다.** 이 환경에는 `pwsh`가 없고
Windows PowerShell 5.1은 BOM 없는 UTF-8 스크립트를 ANSI로 읽어 한글이 깨진다. 편집 후
BOM이 살아 있는지 확인할 것.

**매물 정렬과 무변동 감지를 제거하지 말 것.** 네이버는 호출할 때마다 매물 순서를 다르게 준다.
`scrape.mjs`가 `articleNo`로 정렬하고, 수집 시각을 제외한 내용이 이전과 같으면 파일을 아예 쓰지
않는다. 이 둘이 없으면 내용이 동일해도 파일 전체가 diff로 잡혀 매일 무의미한 커밋이 쌓인다.

**가격대는 0.5억 절대 그리드다.** 0원 기준으로 끊으므로 단지가 늘어도 같은 눈금으로 비교된다.
단지별 min~max를 N등분하는 동적 구간으로 되돌리면 단지 간 비교가 깨진다. 매물이 없는 양끝
구간만 잘라낸다.

**`pyeongAlias`는 오타가 아니다.** 공급면적을 평으로 환산하면 단지에서 실제로 부르는 이름과
1평씩 어긋난다 (공급 81.4㎡ → 계산상 25평, 분양 표기는 24평). 단지 페이지에서 전용면적 → 표기명을
직접 지정해 문서 내 다른 탭과 용어를 맞춘다.

## 수집 예의

언오피셜 API를 개인용으로 소량 조회하는 것이다. 페이지 간 400ms, 단지 간 1.5초 간격에
단지당 30페이지 상한이 걸려 있다. 이 값들을 낮추거나 상한을 올리지 말 것.

**작업 스케줄러나 GitHub Actions로 자동화하지 말 것.** 규칙적인 호출 패턴은 차단을 부르고,
클라우드 IP는 특히 막히기 쉽다. 갱신은 필요할 때 사람이 실행한다.

## 데이터 성격

매물은 전부 **호가이며 실거래가가 아니다.** 실거래는 국토부 데이터를 따로 봐야 한다.
집계는 네이버의 동일매물 묶음(`sameAddressGroup=true`) 기준이라 같은 물건을 여러 중개사가
올린 건은 1건으로 센다.

네이버 단지 정보의 세대수·동수는 임대분을 제외한 분양분만 센다. SK북한산시티의 경우
네이버는 3,830세대 / 47개 동인데, 문서상 5,327세대 / 54개 동에서 임대 15평 1,497세대와
임대동 7개(148~154)를 뺀 값이다. 두 숫자가 다르다고 오류로 판단하지 말 것.
