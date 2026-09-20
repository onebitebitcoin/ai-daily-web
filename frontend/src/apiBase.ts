/** 백엔드 API 의 접두사.
 *
 * 이 도메인(`daily.onebitecoder.com`)은 카드뉴스 시리즈가 둘이다 — `/ai` 가 이쪽,
 * `/quantum` 이 quantum-daily-web 이다. 두 시리즈가 각자의 서브패스 아래를 통째로
 * 소유하고 도메인 루트는 비워 둔다. 그래야 셋째 시리즈가 생겨도 기존 둘을 건드리지
 * 않는다.
 *
 * 호스트 nginx 가 `/ai/*` 를 이 컨테이너로 보내고, 컨테이너 nginx 가 접두사를 떼어
 * 백엔드에 넘긴다 — 백엔드 라우트 자체는 `/api` 그대로다(backend/app/routes.py).
 *
 * `vite.config.ts` 의 `base` 와 짝이다. 한쪽만 바꾸면 개발 서버에서는 되는데
 * 배포에서 404 가 난다.
 */
export const API_BASE = '/ai/api';
