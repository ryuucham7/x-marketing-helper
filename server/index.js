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

  // ルーティング
  if (req.method === "GET" && req.url === "/news-drafts") {
    return handleNewsDrafts(req, res);
  }

  if (req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (req.url === "/generate-reply") {
    return handleGenerateReply(req, res);
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
  return;

});

// === リプライ生成 ===
function handleGenerateReply(req, res) {
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
}

// === ニュースドラフト生成 ===
function fetchURL(url) {
  const lib = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return fetchURL(r.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function extractRSSItems(xml, max = 3) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    if (items.length >= max) break;
    const t = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const l = block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
    if (t) items.push({ title: t[1].trim(), link: l ? l[1].trim() : "" });
  }
  return items;
}

function extractAtomItems(xml, max = 3) {
  const items = [];
  const blocks = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
  for (const block of blocks) {
    if (items.length >= max) break;
    const t = block.match(/<title[\s\S]*?>([\s\S]*?)<\/title>/);
    const l = block.match(/<link[^>]*href="(.*?)"/);
    if (t) items.push({ title: t[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), link: l ? l[1].trim() : "" });
  }
  return items;
}

async function getLatestNews() {
  const feeds = [
    { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch", type: "rss" },
    { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge", type: "atom" },
    { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat", type: "rss" },
    { url: "https://blog.google/technology/ai/rss/", source: "Google AI Blog", type: "rss" },
    { url: "https://openai.com/blog/rss.xml", source: "OpenAI Blog", type: "rss" },
    { url: "https://www.anthropic.com/rss.xml", source: "Anthropic Blog", type: "rss" },
    { url: "https://news.google.com/rss/search?q=Claude+OR+Gemini+OR+OpenAI+OR+LLM&hl=ja&gl=JP&ceid=JP:ja", source: "Google News JP", type: "rss" },
  ];

  const allNews = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchURL(feed.url);
      const items = feed.type === "atom" ? extractAtomItems(xml, 3) : extractRSSItems(xml, 3);
      for (const item of items) allNews.push({ ...item, source: feed.source });
    } catch {}
  }

  const seen = new Set();
  return allNews.filter((n) => {
    if (seen.has(n.title)) return false;
    seen.add(n.title);
    return true;
  }).slice(0, 15);
}

async function handleNewsDrafts(req, res) {
  try {
    const news = await getLatestNews();
    if (news.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ニュースが取得できませんでした", news: [], drafts: [] }));
      return;
    }

    const newsText = news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}\n   ${n.link}`).join("\n");

    const payload = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `あなたはIT・AI系の最新情報を発信しているXのユーザーです。
以下の最新ニュースから特に注目度が高いものを選び、Xに投稿するツイートのドラフトを3つ作ってください。

ルール:
- 海外ニュースは日本語に翻訳して紹介する
- ニュースの要点を簡潔にまとめた上で、自分の意見や視点を1〜2文で添える
- 必ず元記事のURLをツイート末尾に含める
- 本文+URLで280文字以内（URLは23文字としてカウント）
- 丁寧寄りのカジュアルな口調（「ですます」ベースに少し崩す）
- AI感を出さない。人間が普通にツイートする感じ
- 絵文字は使わない
- フォロワーが共感したりリプしたくなるような内容にする
- ポジティブな方向性で
- 3つそれぞれ違うニュースを選ぶ
- Claude、Google/Gemini、OpenAI、LLM関連のニュースを優先的に選ぶ

以下のJSON形式で出力してください。前置きや説明は不要です:
[
  {"text": "ツイート本文（URL含む）", "source": "ニュースソース名"},
  {"text": "ツイート本文（URL含む）", "source": "ニュースソース名"},
  {"text": "ツイート本文（URL含む）", "source": "ニュースソース名"}
]

最新ニュース:
${newsText}`,
      }],
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
      apiRes.on("data", (c) => (data += c));
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text?.trim() || "[]";
          // JSONを抽出（前後にテキストがある場合も対応）
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          const drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ news, drafts }));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "ドラフト生成失敗", news, drafts: [] }));
        }
      });
    });

    apiReq.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    apiReq.write(payload);
    apiReq.end();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

server.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
