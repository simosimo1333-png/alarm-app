// Neon (Postgres) への接続。Vercel の Neon 連携が自動で設定する
// 環境変数を順に見て、最初に見つかったものを使う。
import { neon } from '@neondatabase/serverless';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  // 接続情報が無い状態は「まだ Neon をつないでいない」ケース。
  // 各 API はこのエラーを 500 で返し、画面に案内を出す。
  console.error('データベース接続文字列(DATABASE_URL 等)が設定されていません。');
}

// neon() はタグ付きテンプレートで安全にパラメータを渡せる。
export const sql = connectionString ? neon(connectionString) : null;

export function hasDatabase() {
  return Boolean(sql);
}
