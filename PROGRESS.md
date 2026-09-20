# 구현 진행 상황

`/ai/api` 로 API 경로를 내려 quantum 과 같은 체계를 맞추는 작업이다.
계획: `~/.claude/plans/flickering-exploring-marble.md`

## 완료된 Phase
- [x] Phase 1: 프런트엔드 API 베이스 분리 (`98efbab`)
- [x] Phase 2: 컨테이너 nginx 와 OG 메타 접두사 (`1efe951`)
- [x] Phase 3: 발행·운영 스크립트와 배포 워크플로 (`347e25d`)
- [x] Phase 4: 호스트 vhost 를 세 갈래로 (`454c608`)
- [x] Phase 5: 문서 (`cb01583`)

## 현재 진행 중
- [ ] Phase 6: 배포와 검증
  - [x] 0.4.0 푸시 → CI 배포 성공 (`c1c26c7`, run 35521028815)
  - [x] 프로덕션에서 `/ai/api` · `/ai/health` 200, og:image 가 `/ai/api/og/...`
  - [ ] **서버에서 호스트 vhost 교체** ← 사람이 sudo 로. 이걸 해야 `/quantum` 이 열린다

## 서버에서 남은 작업

```bash
sudo cp /etc/nginx/sites-available/daily.onebitecoder.com \
        /etc/nginx/sites-available/daily.onebitecoder.com.bak-$(date +%F)
sudo cp /home/measly/ai-daily-web/deploy/nginx/daily.onebitecoder.com.conf \
        /etc/nginx/sites-available/daily.onebitecoder.com
sudo nginx -t && sudo systemctl reload nginx
```

교체 뒤 루트는 301, 아래 여섯은 200 이어야 한다. 어긋나면 백업으로 되돌린다.

```bash
D=https://daily.onebitecoder.com
for p in / /ai/ /ai/api/editions /ai/health /quantum/ /quantum/api/editions /api/editions; do
  curl -s -o /dev/null -w "$p  %{http_code}\n" "$D$p"
done
```

함께 해 두면 quantum 도 푸시 시 자동 배포된다(지금은 러너가 offline):

```bash
cd /home/measly/actions-runner-quantum-daily
sudo ./svc.sh install measly && sudo ./svc.sh start
```

## 이후 정리할 것 (전환 기간이 끝나면)

루트 `/api` 와 `/health` 레거시 블록을 지운다. 기준은 access log 다.

```bash
sudo awk '$7 ~ /^\/api\// {print $4, $7}' \
    /var/log/nginx/daily.onebitecoder.com.access.log | tail -20
```

지울 곳 둘: `deploy/nginx/daily.onebitecoder.com.conf` 와 `frontend/nginx.conf`.
