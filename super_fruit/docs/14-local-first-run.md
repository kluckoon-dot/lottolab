# 보갬 PC 첫 실호출 — 한글 경로에서 키를 못 찾았다

2026-10-09. 클라우드 세션을 접고 보갬 PC 의 Claude Code 데스크톱 앱에서 이어간다.
zip 왕복 없이 로컬 수집기 폴더를 직접 고치고, 진짜 네이버로 바로 검증한다.

## 결함 — 경로에 한글이 있으면 key.txt 를 못 읽는다

```
C:\Users\kluck\Downloads\4. 키워드분석\navercollector
```

서버를 띄우자마자 "key.txt 에 검색광고 키가 없다". 키는 다섯 칸 다 차 있었다.

```js
new URL(import.meta.url).pathname   // → /C:/Users/kluck/Downloads/4.%20%ED%82%A4%EC%9B%8C...
```

`pathname` 은 퍼센트 인코딩된 채로 나온다. 그 경로로 `readFileSync` 하면 없는 폴더라
조용히 건너뛰고 "키 없음" 이 된다. 가짜 네이버로 검증한 컨테이너 경로는 영문이라 안 드러났다.
보갬 PC 는 경로가 전부 한글이라 **실시간 서버가 처음부터 키 없이 떴을 것**이다.

`fileURLToPath(import.meta.url)` 로 바꿨다. 같은 줄이 있던 세 파일 모두.

| 파일 | 영향 |
|---|---|
| `live-server.mjs` | key.txt · naver-out 위치 |
| `fetch-naver.mjs` | key.txt |
| `fetch-hub.mjs` | key.txt (두 군데) |

`prototype/` · `pack/` · `update/` 세 벌 모두, `naver-collector.zip` · `naver-collector-update.zip` 다시 묶음.
zip 은 옛 zip 과 항목별로 대조해 **이 세 파일만** 달라졌음을 확인. 한글 파일명은 UTF-8 플래그 유지.

## 실제 네이버와 대조 — 처음으로

```
청도반시  PC 2,570 · 모바일 10,900 = 13,470   ← 키워드도구 엑셀 10/9 14:28 · 아이템스카우트와 같다
          연관 77개 · 입찰가 PC 400/300/270 · 모바일 410/370/330
          HUB 2023-10-09 ~ 2026-10-08 일간 검색·클릭 · 기기 모76.8/PC23.2 · 성별 여54/남46 · 연령 6구간
대봉감    PC 1,400 · 모바일 6,570 = 7,970 · 연관 304개   (수집기 폴더 자체에서 실행)
key.txt   → 404
```

12 · 13 문서에서 "아직" 이던 두 가지가 풀렸다.
- 실시간 검색광고 값이 네이버 키워드도구와 같다.
- HUB 3년 일간 요청이 실제로 돈다.

## 수집기 폴더 반영

`naver-collector-update.zip` 내용을 보갬 수집기 폴더에 직접 덮어썼다. key.txt · naver-out 은 그대로.
덮어쓰기 전 원래 파일 41개는 PC 의 작업 폴더 `.claude/backup/navercollector-20261009/` 에 떠뒀다.
이제 `0-keyword-lab.bat` 을 수집기 폴더에서 더블클릭하면 된다.

## 연령 막대가 위 고정 바를 뚫고 올라왔다

보갬 캡처: 스크롤하면 진한 초록 막대 하나가 `네이버 수수료 … 마진 …` 배지 위에 걸려 있다.

가장 두꺼운 연령 층에 `class="top"` 을 붙였는데, 페이지 머리 바도 `.top` 이다.
```css
.top{ position:sticky; top:0; z-index:30; background:…; border-bottom:… }
```
그 막대가 머리 바의 성질을 통째로 물려받아 화면 맨 위에 달라붙었다. z-index 30 이라 판매 설정 바(29)보다 위다.
쇼핑 구매층 연령 막대와 상세 탭의 연령·요일 막대 두 곳. `peak` 로 바꿨다.
1400px 에서 재현 → 고친 뒤 막대 `position:static` 확인.
