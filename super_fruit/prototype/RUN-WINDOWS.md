# 네이버 지표 수집 — 윈도우 실행 순서

형 PC(PowerShell)에서 그대로 따라 하면 된다. 10분 안에 끝난다.

---

## 1. API 키 발급 (2분)

1. 네이버 검색광고(`searchad.naver.com`) 로그인
2. 우측 상단 **도구** → **API 사용 관리**
3. **네이버 검색광고 API 서비스 신청**
4. 발급되는 세 가지를 메모한다

```
액세스라이선스   →  NAVER_AD_API_KEY
비밀키          →  NAVER_AD_SECRET
CUSTOMER_ID     →  NAVER_AD_CUSTOMER   (화면 우측 상단 계정 번호)
```

> 무료다. 광고를 집행하지 않아도 조회는 된다.
> 비밀키는 발급 시 한 번만 보인다. 못 보면 재발급하면 된다.

---

## 2. 코드 받기 (1분)

```powershell
cd $HOME\Documents
git clone https://github.com/kluckoon-dot/lottolab.git
cd lottolab
git checkout claude/site-feasibility-review-ymqztg
cd super_fruit\prototype
```

Node 버전 확인. **18 이상**이어야 한다.

```powershell
node -v
```

낮으면 `nodejs.org`에서 LTS 설치.

---

## 3. 키 넣기

PowerShell 창에서 (이 창을 닫으면 사라진다 — 그게 안전하다):

```powershell
$env:NAVER_AD_API_KEY  = "발급받은_액세스라이선스"
$env:NAVER_AD_SECRET   = "발급받은_비밀키"
$env:NAVER_AD_CUSTOMER = "고객ID숫자"
```

> `.env` 파일로 두고 싶으면 `.env.example`을 복사해서 쓴다.
> `.gitignore`에 이미 들어있어 커밋되지 않는다. **키는 절대 커밋하지 마라.**

---

## 4. 첫 실행 — 응답 원본 확인

```powershell
node fetch-naver.mjs --probe | Out-File -Encoding utf8 probe.txt
notepad probe.txt
```

한글 인자가 콘솔에서 깨질 수 있어서 **`--probe` 뒤에 아무것도 붙이지 마라.**
기본값으로 `샤인머스캣`을 쓴다.

`>` 리다이렉트 말고 `Out-File -Encoding utf8`을 써라. PowerShell 기본 리다이렉트는 UTF-16으로 저장돼서 한글이 깨진다.

**이 파일 내용을 나한테 붙여줘.** 키는 출력에 안 나오게 막아놨다.

확인할 게 두 가지다.

| 확인 | 왜 |
|---|---|
| `/keywordstool` 응답의 실제 필드명 | 프로토타입 매핑 확정 |
| 입찰가 엔드포인트 중 어느 게 200인지 | **1~3위 입찰가를 추정이 아닌 실값으로 바꾸는 핵심** |

지금 프로토타입의 2·3위 입찰가는 1위 × 0.78 / × 0.61 **추정값**이다.
형이 제일 없애고 싶어 한 수고가 정확히 이 부분이라, 여기만큼은 추정으로 두면 안 된다.

### 결과별 대처

| 나온 값 | 뜻 | 할 일 |
|---|---|---|
| `HTTP 200` | 정상 | 그대로 붙여줘 |
| `HTTP 401` | 키가 틀림 | 세 값 다시 확인. 특히 CUSTOMER_ID |
| `HTTP 403` + `Host not in allowlist` | 네트워크 차단 | 회사 방화벽·VPN 확인 |
| `HTTP 403` (다른 문구) | 계정 권한 없음 | API 서비스 신청이 승인됐는지 확인 |
| `HTTP 404` | 경로 다름 | 그 엔드포인트는 후보에서 뺀다. 괜찮다, 그래서 두 개 때려보는 거다 |

---

## 5. 본 수집

probe가 200이면 바로 이어서 돌린다.

**작게 먼저.** 40품종으로 한 번 돌려보고 결과를 확인한 뒤 전체로 간다.

```powershell
node fetch-naver.mjs --from supply-calendar.json --limit 40
```

전체 202품종:

```powershell
node fetch-naver.mjs --from supply-calendar.json
```

직접 고른 키워드만:

```powershell
# kw.txt 를 UTF-8로 저장, 한 줄에 하나씩
node fetch-naver.mjs --keywords-file kw.txt
```

결과는 `naver-out\keywords.json`에 떨어진다. **이 파일을 나한테 올려줘.**
그러면 프로토타입의 샘플 생성기를 실데이터로 갈아끼운다.

### 수집기가 하는 일

- 호출 간 **0.35초** 간격. 초당 3회를 넘지 않는다
- `429` 한도 초과면 **멈추고 기록한다.** 이전 값으로 덮어 성공처럼 만들지 않는다
- 실패는 `failed` 배열에 상태코드와 이유를 남긴다
- 모든 값에 `fetchedAt` 시각이 붙는다

### 얼마나 걸리나

202품종 × 0.35초 ≈ **2분**. 연관 키워드가 품종당 수십 개씩 딸려 오므로
결과는 **수천 개 키워드**가 된다. 형이 원한 규모가 여기서 채워진다.

---

## 키 관리

- `.env`는 `.gitignore`에 있다. `naver-out/`도 마찬가지다
- 실수로 커밋했으면 **키를 즉시 재발급해라.** 히스토리에서 지우는 것보다 그게 빠르고 확실하다
- PowerShell 창을 닫으면 `$env:` 변수는 사라진다
