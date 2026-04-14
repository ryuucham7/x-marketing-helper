require("dotenv").config();

const http = require("http");
const https = require("https");

const PORT = 3456;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY が .env に設定されていません");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/generate-reply") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let tweetText;
    try {
      tweetText = JSON.parse(body).tweetText;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const payload = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `あなたはIT系のTwitterユーザーです。以下のツイートに対して、自然なリプライを1つだけ生成してください。

ルール:
- 丁寧寄りのカジュアルな口調（「ですます」ベースに少し崩す）
- AI感を絶対に出さない。人間が普通に返信する感じ
- 「参考になります」「素晴らしい」「応援してます」のようなテンプレ表現は禁止
- ツイートの具体的な内容に触れること（技術名、やってること、悩みなど）
- 短めに（1〜2文、50文字以内くらい）
- 絵文字は使わない
- 自分の経験や共感を少し混ぜるとよい
- 必ずポジティブ or 共感の方向で返す。否定・批判・ネガティブな指摘・疑問を投げかけるようなリプは絶対に禁止
- 「難しくないですか？」「大変じゃないですか？」のようなマイナスの問いかけもNG
- 相手を肯定する、背中を押す、興味を示す、のどれかの方向性で書く
- リプライ本文だけを出力。前置きや説明は不要

ツイート:
${tweetText}`,
        },
      ],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => (data += chunk));
      apiRes.on("end", () => {
        res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
        try {
          const parsed = JSON.parse(data);
          const reply = parsed.content?.[0]?.text?.trim();
          res.end(JSON.stringify({ reply: reply || "" }));
        } catch {
          res.end(JSON.stringify({ error: "API response parse error" }));
        }
      });
    });

    apiReq.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });

    apiReq.write(payload);
    apiReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
