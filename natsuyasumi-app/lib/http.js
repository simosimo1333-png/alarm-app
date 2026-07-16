// リクエスト/レスポンスの小さなヘルパー。

// JSON ボディを読む。Vercel が既に req.body を解析している場合はそれを使い、
// そうでなければ生ストリームから読む(どちらの実行環境でも動くように)。
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// DB 未接続などの共通エラーを返す
export function sendDbMissing(res) {
  sendJson(res, 503, {
    ok: false,
    error: 'DB_NOT_CONNECTED',
    message: 'データベースがまだ接続されていません。Vercel で Neon を接続してください。',
  });
}
