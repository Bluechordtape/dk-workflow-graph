// server/db.js — PostgreSQL 연결 풀
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// 테이블이 없으면 자동 생성 (단일 행 upsert 방식)
pool.query(`
  CREATE TABLE IF NOT EXISTS workflow_data (
    id      INTEGER PRIMARY KEY DEFAULT 1,
    data    JSONB       NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).then(() => {
  console.log('[DB] workflow_data 테이블 준비 완료');
}).catch((err) => {
  console.error('[DB] 테이블 초기화 실패:', err.message);
});

module.exports = pool;
