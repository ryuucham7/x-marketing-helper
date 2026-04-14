require("dotenv").config();

const https = require("https");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY が .env に設定されていません");
  process.exit(1);
}

// RSS フィードから最新AI系ニュースを取得
async function fetchRSS(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function extractItems(xml, max = 5) {
  const items = [];
  const regex = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>|<link><!\[CDATA\[(.*?)\]\]>/g;

  // シンプルなパース
  const titleMatches = xml.matchAll(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g);
  for (const m of titleMatches) {
    if (items.length >= max) break;
    items.push(m[1].trim());
  }
  return items;
}

async function getLatestNews() {
  const feeds = [
    "https://news.google.com/rss/search?q=AI+%E6%9C%80%E6%96%B0&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=%E7%94%9F%E6%88%90AI&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=ChatGPT+OR+Claude+OR+LLM&hl=ja&gl=JP&ceid=JP:ja",
  ];

  const allNews = [];
  for (const url of feeds) {
    try {
      const xml = await fetchRSS(url);
      const items = extractItems(xml, 5);
      allNews.push(...items);
    } catch (e) {
      // フィード取得失敗は無視
    }
  }

  // 重複除去
  return [...new Set(allNews)].slice(0, 10);
}

// Claude API でツイートドラフト生成
async function generateDrafts(newsItems) {
  const newsText = newsItems.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `あなたはIT・AI系の情報発信をしているXのユーザーです。
以下の最新ニュースを参考に、Xに投稿するツイートのドラフトを3つ作ってください。

ルール:
- 1投稿は140文字以内
- ニュースをそのまま紹介するのではなく、自分の意見や視点を入れる
- 丁寧寄りのカジュアルな口調（「ですます」ベースに少し崩す）
- AI感を出さない。人間が普通にツイートする感じ
- 絵文字は使わない
- 「参考になります」等のテンプレ表現は禁止
- フォロワーが共感したりリプしたくなるような内容にする
- 問いかけや自分の体験を混ぜるとよい
- ポジティブな方向性で
- 3つそれぞれ違う切り口で

出力フォーマット:
---
【ドラフト1】
（本文）

【ドラフト2】
（本文）

【ドラフト3】
（本文）
---

最新ニュース:
${newsText}`,
      },
    ],
  });

  return new Promise((resolve, reject) => {
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

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "生成失敗");
        } catch {
          reject(new Error("API parse error"));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// メイン
async function main() {
  console.log("=== AI ニュース投稿ドラフト生成 ===");
  console.log(`生成日時: ${new Date().toLocaleString("ja-JP")}\n`);

  console.log("最新ニュースを取得中...");
  const news = await getLatestNews();

  if (news.length === 0) {
    console.log("ニュースが取得できませんでした");
    process.exit(1);
  }

  console.log(`${news.length}件のニュースを取得\n`);
  console.log("--- 参照ニュース ---");
  news.forEach((n, i) => console.log(`${i + 1}. ${n}`));
  console.log("");

  console.log("ドラフト生成中...\n");
  const drafts = await generateDrafts(news);
  console.log(drafts);
  console.log("\n上記から選んで投稿してください！");
}

main().catch(console.error);
