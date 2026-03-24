// server/db.js — PostgreSQL 연결 풀 + 테이블 초기화
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  // 워크플로우 데이터 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workflow_data (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      data       JSONB       NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 사용자 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member',
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  // 역할 체크 제약 갱신 (leader 추가)
  await pool.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('admin','leader','manager','member','viewer'));
  `).catch(() => {});

  // password_plain 컬럼 추가 (없을 때만)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain TEXT DEFAULT NULL
  `).catch(() => {});

  // admin 계정이 없으면 자동 생성
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash('dk2024!', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, password_plain, name, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      ['admin@dk.com', hash, 'dk2024!', '관리자']
    );
    console.log('[DB] admin 계정 생성: 관리자 / dk2024!');
  }

  // 손님(viewer) 계정이 없으면 자동 생성
  const guest = await pool.query("SELECT id FROM users WHERE name = '손님' LIMIT 1");
  if (guest.rows.length === 0) {
    const guestHash = await bcrypt.hash('0000', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, password_plain, name, role)
       VALUES ($1, $2, $3, $4, 'viewer')`,
      ['guest@loom.internal', guestHash, '0000', '손님']
    );
    console.log('[DB] 손님 계정 생성: 손님 / 0000');
  }

  // 팀원 계정 시딩 (없을 때만)
  const MEMBERS = ['민경', '창규', '진희', '정현'];
  for (const name of MEMBERS) {
    const exists = await pool.query('SELECT id FROM users WHERE name = $1', [name]);
    if (exists.rows.length === 0) {
      const hash = await bcrypt.hash('dkc2626', 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, password_plain, name, role)
         VALUES ($1, $2, $3, $4, 'member')`,
        [`${name}@dk.internal`, hash, 'dkc2626', name]
      );
    }
  }
  // 기존 계정에 password_plain 백필 (null인 경우 기본값으로)
  await pool.query(`
    UPDATE users SET password_plain = 'dkc2626' WHERE password_plain IS NULL AND role = 'member'
  `).catch(() => {});
  await pool.query(`
    UPDATE users SET password_plain = 'dk2024!' WHERE password_plain IS NULL AND role = 'admin'
  `).catch(() => {});
  console.log('[DB] 팀원 계정 확인 완료');

  // 템플릿 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      data        JSONB NOT NULL,
      created_by  TEXT NOT NULL DEFAULT 'system',
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  // 기본 템플릿 시드 (없을 때만)
  const tmplCount = await pool.query('SELECT COUNT(*) FROM templates');
  if (parseInt(tmplCount.rows[0].count) === 0) {
    const tpl1 = {
      tasks: [
        { id:'tt1', name:'자료 수집',  x:50,   y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt2', name:'초안 작성',  x:290,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt3', name:'내부 검토',  x:530,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt4', name:'수정',       x:770,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt5', name:'최종 제출',  x:1010, y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
      ],
      flows: [
        { id:'tf1', from:'tt1', to:'tt2' },
        { id:'tf2', from:'tt2', to:'tt3' },
        { id:'tf3', from:'tt3', to:'tt4' },
        { id:'tf4', from:'tt4', to:'tt5' },
      ]
    };
    const tpl2 = {
      tasks: [
        { id:'tt1', name:'현황 조사',    x:50,   y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt2', name:'재무 모델',    x:290,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt3', name:'초안',         x:530,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt4', name:'자문 회의',    x:770,  y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
        { id:'tt5', name:'최종 보고서',  x:1010, y:200, status:'pending', assignee:'', note:'', subtasks:[], dueDate:null },
      ],
      flows: [
        { id:'tf1', from:'tt1', to:'tt2' },
        { id:'tf2', from:'tt2', to:'tt3' },
        { id:'tf3', from:'tt3', to:'tt4' },
        { id:'tf4', from:'tt4', to:'tt5' },
      ]
    };
    await pool.query(
      `INSERT INTO templates (name, description, data, created_by) VALUES
       ($1,$2,$3,'system'), ($4,$5,$6,'system')`,
      ['제안서 제출', '자료수집→초안작성→내부검토→수정→최종제출', JSON.stringify(tpl1),
       'FS 보고서',   '현황조사→재무모델→초안→자문회의→최종보고서',  JSON.stringify(tpl2)]
    );
    console.log('[DB] 기본 템플릿 2개 생성 완료');
  }

  // 앱 설정 테이블 (권한 등 key-value JSON store)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);

  // 백업 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backups (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      data       JSONB NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMP DEFAULT NOW(),
      is_auto    BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // 사용자별 레이아웃 테이블 (노드/프로젝트 위치 개인 저장)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_layouts (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      layout     JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('[DB] 테이블 준비 완료');
}

initDB().catch(err => console.error('[DB] 초기화 실패:', err.message));

module.exports = pool;
