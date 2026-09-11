# super_fruit

생생보감 농산물 수익화 관제센터(`saengsaeng-agri-command`)의 **기획·타당성 검토 저장소**.

## 이 폴더가 뭐냐

실제 애플리케이션 코드는 여기 없다. 코드는 로컬 윈도우 PC에 있다.

```
C:/Users/kluck/Downloads/3. 판매상품/상세페이지_참고/saengsaeng-agri-command/
```

이 폴더는 그 프로젝트의 **기획 원본, 외부 조건 조사, 구현 가능/불가 판정**을 쌓아두는 곳이다.

**용도 확정: 본인 전용 비공개 도구.** 판매·공개하지 않는다. 크롤링하지 않는다.
코드를 옮겨오게 되면 그때 `app/` 이하를 추가한다.

## 문서

| 파일 | 내용 |
|---|---|
| `docs/00-source-log.md` | 원본 ChatGPT 대화 기록 (판단 근거) |
| `docs/01-feasibility.md` | **타당성 판정 — 여기부터 읽어라** |
| `docs/02-data-sources.md` | 데이터 소스별 생존 여부·약관·대체안 |
| `docs/03-action-guide.md` | **1·2순위 실행 절차 + 로컬 세션 지시문** |
| `docs/04-itemscout-pandarank.md` | 아이템스카우트+판다랭크 결합 검토 · 크롤링 판례 |
| `docs/05-weapon-spec.md` | **무기 설계서 — 판정 엔진 · 화면 · 로드맵** |
| `docs/06-live-data-plan.md` | **실데이터 연동 사양 · 하루 2회 스케줄** |
| `docs/07-apihub-budget.md` | **API HUB 호출 예산 · 갱신 주기 설계** |
| `docs/08-verdict-rules.md` | **판정 기준 확정본** — 실데이터 검증 완료 |
| `prototype/keyword-lab.html` | **동작하는 프로토타입 v2** — 202품종 범용 |
| `prototype/golden-keyword.html` | 프로토타입 v1 (6품목 고정, 참고용) |
| `prototype/supply-calendar.json` | 수확 캘린더 202품종 · 인기 TOP20 (시트 추출) |
| `prototype/fetch-naver.mjs` | **검색광고 API 수집기** — 단계별 · 이어하기 |
| `prototype/fetch-hub.mjs` | API HUB 호출 주소 탐색기 |
| `prototype/seeds.json` | **수집 우선순위 시드 644개** (4단계) |
| `prototype/pack/` | **사용자에게 보내는 꾸러미** (bat · key.txt · README) |

## 현재 상태 요약 (2026-09-10 기준)

- 운영 사이트: 버전 71, 비공개 배포, 소유자 전용
- 데이터 수집: **부분 완료** (SearchAd 31%, 검색트렌드 29%, 쇼핑인사이트 33%)
- 6개월 매출·판매량·평균가격: 화면에서 제거 완료, 내부 필드는 잔존
- 공급가 맞비교(온그린/어드민플러스): **미착수** — Access Key 0개
- 네이버 검색어트렌드·쇼핑인사이트: **종료 아님, API 허브로 이관.** 개발자센터 키는 2027-06-30까지
- 실제로 끊긴 건 **쇼핑 검색 API 하나** (2026-07-31, 대체 없음)
- **네이버 API 약관 개정 시행 (2026-09-07)** → `docs/01-feasibility.md` 리스크 1 참조
- **최우선 과제: 카테고리 ID 버그** → `docs/03-action-guide.md`

## 프로토타입

`prototype/keyword-lab.html` — 단일 HTML. 빌드 없이 브라우저로 열린다.

- **수확 캘린더 202품종 45카테고리** — 업로드 시트에서 추출한 실데이터.
  초록 칸 = 수확 직전 진입 구간, 노랑 칸 = 공급 시기. 시즌 판정이 여기서 나온다.
- **마진 공식** — 업로드 시트 그대로. 네이버/쿠팡 전환, 주문관리·매출연동 수수료 구간 선택.
  홍로사과 12,150 → 19,900 검증: 마진 6,431원 · 마진율 32.3% · 최소광고효율 3.09 (시트와 일치)
- **손익분기 전환율 = CPC × 배수 ÷ 마진** — 최소광고효율에서 유도. 입찰가와 마진을 한 줄에서 묶는다.
- NAVER 지표(검색수·입찰가·광고깊이·연령·성별)는 **샘플**. 연동 사양은 `docs/06-live-data-plan.md`.

기준값은 스크립트 상단 `RULE` 객체 한 곳에서 바꾼다.

```js
var RULE = { minVol:5000, maxComp:5.0, goldGood:55, goldSkip:30,
             volSkip:2000, marginGood:25, marginSkip:15 };
```
