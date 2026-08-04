# 작업 인수인계 메모 (Loom / dk-workflow-graph)

> 이 파일은 이전 세션(Cowork)에서 진행한 진단·수정 내용을 새 세션(Claude Code)이 이어받기 위한 메모입니다.
> **먼저 이 파일 전체를 읽고, 아래 "가장 먼저 할 일"부터 진행하세요.**

## ⚠️ 안전 규칙 (매우 중요)
- 이 저장소는 **GitHub `Bluechordtape/dk-workflow-graph`** 에 연결되어 있고, **master에 push하면 Railway가 즉시 실전 배포**됩니다.
- **master 병합·push·배포는 반드시 사용자에게 확인받은 뒤에만 하세요.** 승인 없이 절대 push 금지.
- 현재 작업 브랜치: **`feature/stability-and-permissions`** (여기서 작업/커밋).
- 라이브 서비스이고 실제 사용자 데이터가 있습니다. 파괴적 작업 전 백업 확인.

## 현재 상태
- 브랜치 `feature/stability-and-permissions` 에 아래 변경이 **작성만 되어 있고 아직 커밋/테스트 안 됨**.
- 이전 세션은 OneDrive 마운트라 파일 삭제·git 커밋·로컬 실행(DB 없음)이 불가능했음. 그래서 **테스트가 전혀 안 된 상태**.
- 찌꺼기 파일 `.__wtest` 가 남아 있음 → 삭제할 것.

## 가장 먼저 할 일
1. `git status`, `git branch` 로 상태 확인 (브랜치 `feature/stability-and-permissions` 인지).
2. 찌꺼기/죽은 파일 정리:
   ```
   git rm fix_drag.js fix_drag2.js fix_drag3.js fix_edges.js fix_perf.js fix_snapback.js swap_colors.js
   del .__wtest   (또는 rm .__wtest)
   ```
   (이 fix_*.js / swap_colors.js 들은 index.html에서 로드되지 않는 죽은 파일임 — 확인 후 삭제)
3. `.env` 에 `DATABASE_URL` 채우고 로컬 실행 준비 (아래 "테스트" 참고).

---

## 배경: 진단 요약
- 구조: Express + Socket.io + Postgres 백엔드(`server/`), 순수 JS 프론트(`index.html`, `app.js`, `graph.js`, `data.js`, `style.css`).
- **불안정의 핵심 원인**: 앱 전체 상태가 DB 단일 행(`workflow_data` id=1)에 JSON 통째로 저장되고, 매 수정마다 전체를 덮어씀(last-write-wins) → 동시 편집 시 데이터 유실 위험, 통째 브로드캐스트.
- 노드/프로젝트 **위치는 사용자별 `user_layouts` 테이블**에 저장됨(공유 데이터 아님) → 드래그 스냅백 위험은 예상보다 작음. (스냅백은 재현 후 판단 필요.)
- 권한: 4개 역할(admin/leader/manager/member) + 반쪽짜리 viewer. 권한이 두 곳(① DB `app_settings.permissions` 매트릭스=UI 가림막, ② 서버 하드코딩 규칙=실제 강제)에 있고 서로 어긋남.
- 관리자 기본 계정: `admin@dk.com` / `dk2024!` (Railway `ADMIN_PASSWORD` 설정 시 그 값 우선, UI에서 변경했으면 그게 우선).

---

## Phase 1 — 저장/동기화 안정화 (이번에 코드 작성됨, **테스트 필요**)
목표: 동시 저장 시 데이터 유실 방지 + 팀원 완료(done) 차단 토대.

방식: **낙관적 동시성(rev)** 도입. 저장 본문은 그대로 두고 버전은 HTTP 헤더로 주고받음(블래스트 반경 최소화).

변경된 파일:
- **server/db.js**: `workflow_data` 에 `rev INTEGER NOT NULL DEFAULT 0` 컬럼 추가(ALTER, idempotent).
- **server/routes/data.js**:
  - `introducesDone(prev, next)` 헬퍼 추가(이전 대비 새로 done 된 task 감지).
  - `GET /data`: 현재 rev를 `X-Data-Rev` 응답 헤더로 전달.
  - `PUT /data`: 트랜잭션 + `SELECT ... FOR UPDATE`. 클라이언트가 보낸 `X-Base-Rev` 헤더와 현재 rev가 다르면 **409 반환(덮어쓰기 거부)**. 저장 성공 시 `rev = rev+1`, `X-Data-Rev` 헤더 + `io.emit('data:updated', data, rev)`. **member 역할이 done 전환을 시도하면 403.**
  - `PATCH /data/task`, `PATCH /data/task-status`: 트랜잭션 + 행잠금 + rev 증가 + rev 함께 emit 하도록 변경.
- **server/index.js**: 소켓 `data:sync` 브로드캐스트도 rev를 함께 전송.
- **data.js (프론트)**: `_rev` 추적, `getRev()/setRev()` 추가. `loadData()`가 `X-Data-Rev` 읽음. `saveData()`가 `X-Base-Rev` 전송, 성공 시 rev 갱신, **409면 최신 rev로 맞추고 `data:conflict` 커스텀 이벤트 발생(남의 데이터 덮어쓰지 않음)**.
- **app.js**: `setRev` import. 간단 토스트 `showToast()` 추가 + `window`의 `data:conflict` 리스너(“다른 사용자가 먼저 저장… 다시 적용” 안내). `data:updated` 핸들러가 `(newData, rev)` 받도록 수정.

문법 검사: 5개 파일 `node --check` 통과함. **런타임 테스트는 안 됨.**

### Phase 1 테스트 체크리스트 (배포 전 필수)
- [ ] 로컬 실행 후 앱 정상 로드/로그인/저장 되는지.
- [ ] DB에 `workflow_data.rev` 컬럼 생겼는지, 저장할 때마다 증가하는지.
- [ ] 두 브라우저(또는 탭)로 동시 편집 → 한쪽 저장 후 다른 쪽이 옛 rev로 저장 시 **409 + 토스트**, 데이터 유실 없는지.
- [ ] 일반 편집(단일 사용자)은 그대로 매끄럽게 저장되는지(회귀 없음).
- [ ] member 계정으로 로그인 → task를 done으로 바꾸려 하면 막히는지(403), review(완료요청)까지는 되는지.
- [ ] 소켓 실시간 반영(다른 탭에 즉시 갱신) 정상인지.

### 알려진 한계 / 후속(선택)
- 통째 저장(PUT) 모델 자체는 유지됨. 완전한 해결(필드 단위 부분 업데이트/머지)은 더 큰 리팩터로 별도 진행 권장.

---

## Phase 2 — 팀원 권한 확장 (아직 미착수)
사용자 결정사항:
- **팀원 권한을 전반적으로 확장**: 업무 생성/수정(이름·담당자·마감일 등)/이동, **프로젝트·묶음(group) 생성·삭제** 허용.
- **단, 상태는 '완료요청(review)'까지만.** 최종 '완료(done)'는 admin·leader만. ← 이미 Phase 1의 PUT/PATCH 서버 검증으로 강제됨.

구현 메모:
- UI 게이팅은 `app.js`의 `PERMISSIONS` 매트릭스 + `can(action)` 로 동작하고, 실제 활성값은 **DB `app_settings.permissions`(admin이 UI '역할별 권한 안내'에서 저장)** 가 덮어씀.
- 따라서 팀원 확장은 (a) 관리자 UI에서 매트릭스에 member 추가 또는 (b) 코드 기본값/서버 강제 정비로 처리. **DB 매트릭스가 최종 우선순위임에 주의.**
- 대상 액션 예: `createTask, deleteTask, editTask, changeStatus, editMemo, createProject, deleteProject, createGroup, deleteGroup, createView, editView, importExport, backup, saveTemplate` (단, `manageUsers`/권한설정은 admin 유지).
- 팀원이 넓어지면 동시 저장자가 늘어남 → Phase 1(rev)이 먼저 적용/검증돼 있어야 안전.
- 확장 후 UI와 서버 강제가 일치하는지(팀원한테 보이는 버튼이 실제로 동작하는지) 확인.

---

## Phase 3 — 보안 하드닝 (아직 미착수)
- **JWT_SECRET**: `server/middleware/auth.js`에 하드코딩 fallback(`'dk-workflow-secret-2024'`) 있음 → Railway에 `JWT_SECRET` 환경변수 확실히 설정하고, 미설정 시 서버가 뜨지 않도록 강제하는 것 검토.
- **평문 비밀번호**: `users.password_plain` 컬럼에 비번 원문 저장(관리자 UI에서 열람) → 보안 위험. 유지할지(편의) 제거할지 사용자와 결정. 제거 시 관리자 '비번 보기' 기능도 함께 변경 필요.
- **권한 일치**: 매트릭스 기본값과 서버 강제 불일치 정리.
- viewer(손님) 역할: 서버 사용자 생성에서 막혀 있음 — 제대로 쓸지 뺄지 결정.

---

## 참고: 실행/배포
- 로컬 실행: `.env`에 `DATABASE_URL`, `JWT_SECRET` 등 필요(현재 로컬 `.env`엔 DB 주소 비어 있음). Railway 대시보드에서 값 확인. **로컬에서 실전 DB에 직접 붙일지, 테스트 DB를 쓸지 먼저 결정.**
- `npm install` 후 `npm run dev`(nodemon) 또는 `npm start`.
- 배포: 브랜치에서 테스트 완료 → 사용자 승인 → master 병합 → push (Railway 자동 배포).
- 줄바꿈: `.gitattributes`(신규) 추가로 CRLF/LF 노이즈 방지. 필요 시 `git add --renormalize .` 한 번.

## 커밋 예시 (테스트 통과 후)
```
git add -A
git commit -m "Phase 1: 저장 낙관적 동시성(rev)로 데이터 유실 방지 + 팀원 done 차단, 죽은 파일 정리"
# push/배포는 사용자 확인 후!
```
