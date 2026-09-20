# ai-daily-web

매일 한 편씩 쌓이는 AI 카드뉴스 웹사이트. 쇼츠처럼 세로로 스크롤해 카드 10장을
읽고, 마지막 카드 다음에 바로 지난 날짜가 이어진다(최대 7일). 특정 날짜는 상단
날짜 칩의 달력에서 고른다.

`btc-daily-web`을 포크해 만들었다. 백엔드·프론트엔드 구조와 발행 파이프라인은
그대로 옮기고, 도메인 용어집·인용구 풀·후보 클러스터링만 새로 짰다 — 자세한
차이는 [CLAUDE.md](CLAUDE.md)의 비교표를 본다. 두 저장소는 완전히 독립이고,
한쪽 수정이 다른 쪽에 자동으로 반영되지 않는다.

- 프로덕션: <https://daily.onebitecoder.com/ai> (루트 `/`는 `/ai/`로 301)
- 로컬 개발: 백엔드 `:8003` · 프론트 `:5176`
- 스펙: [SPEC.md](SPEC.md) · 콘텐츠 계약: [CONTENT_CONTRACT.md](CONTENT_CONTRACT.md)

## 구조

| 경로 | 내용 |
|---|---|
| `backend/` | FastAPI + SQLAlchemy + Alembic. 엔드포인트 5개(`/health`, 목록/단건/latest/POST) + OG 미리보기용 3개(`/api/og/{date}`, `/api/og/latest`, `/api/og/{date}/image.jpg`) + 이미지 프록시 1개(`/api/img/{date}/{num}`) |
| `backend/scripts/` | 수집·발행 스크립트(앱 코드 아님). 도메인 용어집·클러스터링은 `collect_daily.py`에 있다 |
| `frontend/` | React + Vite + Tailwind. 세로 스냅 피드(`ShortsFeed`), 스타일은 `feed.css`·`chrome.css` |
| `deploy/` | 호스트 nginx vhost, DB 백업 스크립트 |
| `reference/` | 원본 카드뉴스 템플릿과 스키마 테스트용 표본. `btc-daily-web` 시절 그대로라 브랜드가 `BTC DAILY`다 — 발행물과 무관하다(`CLAUDE.md` 참고) |

콘텐츠는 이 저장소가 만들지 않는다 — 다른 Claude 세션이 `/ai-daily` 스킬로 만들어
`POST /api/editions`로 밀어 넣는다.

## 로컬 개발

포트는 고정이다(다른 프로젝트와 충돌 방지): 백엔드 `8003`, 프론트 `5176`
(`8002`/`5175`는 `btc-daily-web`이 쓴다).

```bash
bash scripts/dev.sh            # 둘 다
bash scripts/dev.sh backend    # 하나씩
```

lint / test:

```bash
cd backend  && ruff check . && pytest
cd frontend && npm run lint && npm run test && npm run build
```

> 저장소 루트가 체크아웃돼 있어야 한다. `backend/tests`가 `../reference/content.json`을
> 읽으므로 `backend/`만 떼어내면 테스트가 깨진다.

## 배포 (자체 VPS + Docker Compose)

서비스 3개: `db`(Postgres 16) · `backend`(uvicorn, 기동 시 `alembic upgrade head`) ·
`web`(nginx가 `dist`를 서빙 + `/api` → backend 프록시 + SPA fallback).

`/`, `/d/{date}`는 User-Agent가 SNS 미리보기 봇(Twitterbot, Slackbot, KakaoTalk 등,
`frontend/nginx.conf`의 `is_social_bot` 목록)일 때만 백엔드가 렌더링한 OG 메타 HTML로
넘어간다 — 사람은 그대로 SPA를 받는다. og:image는 카드 1 썸네일을 1200×630으로 크롭해
`og_cache` 볼륨(`/data/og`)에 캐시한다.

### 1. 환경 변수

```bash
cp .env.example .env
```

`POSTGRES_PASSWORD`와 `ADMIN_API_KEY`를 실제 값으로 채운다(`openssl rand -hex 32`).
**`DATABASE_URL` 안의 비밀번호도 같이 바꿔야 한다** — 두 값이 어긋나면 백엔드가 붙지 못한다.
Postgres는 최초 init 때만 비밀번호를 반영하므로, 볼륨을 만든 뒤 바꾸려면
`docker compose down -v`로 지우고 다시 올려야 한다.

`DOMAIN`은 `daily.onebitecoder.com`, `WEB_PORT`는 `8021`이다(같은 서버의
btc-daily-web이 8020을 쓴다). **`ADMIN_API_KEY`는 새로 뽑지 말고 발행 머신의
`backend/.env`에 있는 값을 그대로 옮긴다** — `push_edition.py`가 그 파일에서
키를 읽어 POST하므로 두 값이 다르면 발행이 401로 막힌다.

서버에서 처음 올릴 때는 [DEPLOY.md](DEPLOY.md)의 순서를 따른다.

```bash
docker compose up -d --build
curl -s "localhost:${WEB_PORT:-8021}/health"     # {"status":"ok"}
```

`web`은 `127.0.0.1:${WEB_PORT:-8021}`에만 바인딩된다 — 외부 노출은 호스트 nginx가
전담한다.

### 2. 인그레스 + TLS

호스트 nginx가 80/443과 인증서를 소유한다. 인증서가 없는 상태로 `:443` 블록을
넣으면 `nginx -t`가 깨지므로 **2단계**로 올린다.

```bash
# (1) :80 전용 vhost 먼저
sudo cp deploy/nginx/daily.onebitecoder.com.bootstrap.conf \
        /etc/nginx/sites-available/daily.onebitecoder.com
sudo ln -sf /etc/nginx/sites-available/daily.onebitecoder.com \
            /etc/nginx/sites-enabled/daily.onebitecoder.com
sudo nginx -t && sudo systemctl reload nginx

# (2) 인증서 — 이 도메인 전용. 기존 공용 인증서에 --expand 하지 않는다
#     (SAN 목록을 잘못 넘기면 기존 도메인이 갱신에서 조용히 빠진다)
sudo certbot certonly --webroot -w /var/www/letsencrypt \
     --cert-name daily.onebitecoder.com -d daily.onebitecoder.com

# (3) TLS 포함 최종 vhost로 교체
sudo cp deploy/nginx/daily.onebitecoder.com.conf \
        /etc/nginx/sites-available/daily.onebitecoder.com
sudo nginx -t && sudo systemctl reload nginx
```

DNS가 Cloudflare 프록시 뒤에 있다면 HTTP-01 챌린지가 CF를 통과하는지 먼저
확인한다(`btc-daily-web`에서는 확인됨). 갱신은 certbot이 등록한 스케줄 작업이 처리한다.

### 3. 갱신 배포

```bash
git pull && docker compose up -d --build
```

마이그레이션은 backend 컨테이너가 기동하면서 `alembic upgrade head`로 적용한다.
실패하면 컨테이너가 뜨지 않는다(의도된 설계) — `docker compose logs backend`를 본다.

## 발행

수집 소스(my-news `:8000`, my-youtube `:23456`)는 개발 머신에만 있다. 그래서
수집·문구작성은 개발 머신에서 하고, 완성된 에디션만 프로덕션으로 POST한다:

```bash
cd backend
python scripts/push_edition.py ../drafts/edition-<date>.json --api https://daily.onebitecoder.com
```

`backend/.env`에 `ADMIN_API_KEY`가 있어야 하고, 그 값이 **서버 `.env`의 것과
같아야** 한다(아니면 401). 같은 `meta.date`는 upsert이므로 재발행이 안전하다.
`--api`를 `http://localhost:8003`으로 주면 로컬 백엔드로 간다 — 리허설용이다.
자세한 계약은 [CONTENT_CONTRACT.md](CONTENT_CONTRACT.md#4-발행-방법)에 있다.

## 백업 / 복구

### 무엇을, 왜

**발행 데이터는 재생성이 불가능하다.** 수집 소스(my-news·my-youtube)는 24시간 창만
보여주고 지난 날짜를 다시 주지 않으며, 카드의 Q&A 는 유료 모델 호출 결과다. DB
볼륨 하나에만 두지 않는다.

| 대상 | 백업됨 | 유실되면 |
|---|---|---|
| `editions` — 발행분 본문·카드 10장·Q&A | O | 복구 불가. 맥의 `drafts/edition-*.json` 이 남아 있다면 재발행으로 되살릴 수 있다 |
| `card_likes` — 좋아요 집계(2026-09-18~) | O | 집계가 0 으로 돌아간다 |
| `alembic_version` | O | 복원본이 스키마 리비전을 그대로 들고 온다 |
| `og_cache` · `img_cache` 도커 볼륨 | **X** | 원본 기사 이미지에서 다시 받아 재생성된다 — 첫 조회가 느려질 뿐이라 일부러 담지 않는다 |
| 서버 `.env` | **X** | 비밀값이라 덤프에 담지 않는다. 유실 시 새로 쓰되 `ADMIN_API_KEY` 는 맥 `backend/.env` 의 값과 반드시 같게 맞춘다(아니면 발행이 401) |

### 누가 언제 돌리나

**호스트(리눅스 서버) `measly` 사용자의 crontab** 이다. 컨테이너 안도, 발행을 돌리는
맥도 아니다.

```cron
35 4 * * * mkdir -p /home/measly/.claude/logs && /bin/bash /home/measly/ai-daily-web/deploy/backup.sh >> /home/measly/.claude/logs/ai-daily-backup.log 2>&1
```

- **매일 04:35 KST 1회.** 발행(06:00)보다 앞이라 오늘 덤프에는 어제까지의 발행분이 들어 있다.
- 같은 서버의 btc-daily-web 이 **04:30** 에 같은 일을 한다. 5 분 어긋나게 둔 것은
  의도다 — 같은 도커 데몬에 `pg_dump` 두 개가 동시에 붙지 않게 한다.
- 스크립트는 `docker compose exec -T db pg_dump` 로 뜬다. **컨테이너가 내려가 있으면
  그날치는 실패한다**(기존 백업을 덮어쓰지는 않는다).

### 어디에 쌓이나

`~/backups/ai-daily/ai-daily-<YYYY-MM-DD>.sql.gz` · gzip · 권한 600 · **14일 보관**
(15일째부터 스크립트가 지운다). `AI_DAILY_BACKUP_DIR` 로 위치를 바꿀 수 있다.
btc-daily-web 은 `~/backups/btc-daily/` 에 `btc-daily-` 접두사로 쌓여 서로를 덮어쓰지
않는다.

안전장치는 스크립트 안에 있다 — 임시 파일에 받아 성공했을 때만 옮기고(부분 파일이
정상 백업으로 남지 않게), `PIPESTATUS` 로 `pg_dump` 실패를 직접 확인하고(gzip 이
0 을 뱉어도 속지 않게), 빈 덤프면 기존 파일을 건드리지 않는다.

**한계: 같은 서버 같은 디스크다.** 디스크가 죽으면 DB 와 백업이 함께 사라진다.
오프사이트 사본은 아직 없다.

### 살아 있는지 확인

**실패해도 아무도 알려주지 않는다.** 텔레그램 알림은 발행 파이프라인에만 붙어 있고
백업에는 없다. 그래서 눈으로 확인한다.

```bash
ls -lt ~/backups/ai-daily | head -3          # 맨 위가 오늘(또는 어제) 날짜여야 한다
tail -5 ~/.claude/logs/ai-daily-backup.log   # 마지막 줄이 OK 여야 한다
crontab -l | grep ai-daily-web               # 등록이 살아 있는지
bash deploy/backup.sh                        # 수동 1회 — 같은 날 재실행은 덮어쓴다
```

정상 로그 한 줄은 이렇게 생겼다:

```
2026-09-21T00:16:40+09:00 OK: /home/measly/backups/ai-daily/ai-daily-2026-09-21.sql.gz (404K)
```

### 복구

```bash
cd /home/measly/ai-daily-web
set -a; . ./.env; set +a
gunzip -c ~/backups/ai-daily/ai-daily-<YYYY-MM-DD>.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

덤프는 평범한 `pg_dump` 출력이라 `DROP` 이 앞에 붙지 않는다 — **비어 있는 DB 에
붓는 것을 전제로 한다.** 테이블이 남아 있는 상태로 부으면 충돌한다. 통째로 되돌릴
때는 `docker compose down -v` 로 볼륨을 비우고 `up -d` 로 다시 만든 뒤 붓는다
(컨테이너 기동 시 `alembic upgrade head` 가 먼저 돌아 스키마가 생긴다).

## 트러블슈팅

| 증상 | 원인 / 대응 |
|---|---|
| `docker compose`가 `client version ... is too old` | 구버전 compose 플러그인(`/usr/lib/docker/cli-plugins`)이 탐색 순서에서 앞선다. `ln -sf /usr/libexec/docker/cli-plugins/docker-compose ~/.docker/cli-plugins/docker-compose` |
| `/d/<date>` 새로고침이 404 | 컨테이너 nginx의 `try_files` SPA fallback 확인(`frontend/nginx.conf`). 백엔드에는 catch-all이 없다 |
| 발행이 401 | `backend/.env`와 서버 `.env`의 `ADMIN_API_KEY` 불일치. 서버가 빈 값이면 항상 401(fail closed) |
| 발행이 "cover가 meta.date와 불일치" | stale draft다. 가드를 우회하지 말고 draft를 최신 코드로 재생성할 것 |
| `push_edition.py`가 엉뚱한 백엔드로 붙는다 | `--api`로 넘긴 주소를 본다. 기본값은 `localhost:8003`이다(포크 직후엔 btc-daily-web의 8002였다) |
| `/`가 에러 화면 | DB에 편집본이 0건이면 `latest`가 404다. 한 건이라도 발행하면 해소된다 |
