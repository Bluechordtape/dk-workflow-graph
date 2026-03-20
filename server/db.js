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
      role          TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin','manager','member')),
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  // admin 계정이 없으면 자동 생성
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash('dk2024!', 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'admin')`,
      ['admin@dk.com', hash, '관리자']
    );
    console.log('[DB] admin 계정 생성: 관리자 / dk2024!');
  }

  // 팀원 계정 시딩 (없을 때만)
  const MEMBERS = ['민경', '창규', '진희', '정현'];
  for (const name of MEMBERS) {
    const exists = await pool.query('SELECT id FROM users WHERE name = $1', [name]);
    if (exists.rows.length === 0) {
      const hash = await bcrypt.hash('dkc2626', 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, 'member')`,
        [`${name}@dk.internal`, hash, name]
      );
    }
  }
  console.log('[DB] 팀원 계정 확인 완료');

  console.log('[DB] 테이블 준비 완료');
}

initDB().catch(err => console.error('[DB] 초기화 실패:', err.message));

module.exports = pool;
