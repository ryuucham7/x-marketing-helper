require("dotenv").config();

const https = require("https");
const http = require("http");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY が .env に設定されていません");
  process.exit(1);
}

// === RSS フィード取得 ===
function fetch(url) {
  const lib = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      // リダイレクト対応
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// RSS XML からタイトルとリンクを抽出
function extractItems(xml, max = 5) {
  const items = [];
  // <item> ブロックを切り出し
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];

  for (const block of itemBlocks) {
    if (items.length >= max) break;

    // タイトル
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    // リンク
    const linkMatch = block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);

    if (titleMatch) {
      items.push({
        title: titleMatch[1].trim(),
        link: linkMatch ? linkMatch[1].trim() : "",
      });
    }
  }
  return items;
}

// Atom フィード対応（The Verge等）
function extractAtomItems(xml, max = 5) {
  const items = [];
  const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];

  for (const block of entryBlocks) {
    if (items.length >= max) break;

    const titleMatch = block.match(/<title[\s\S]*?>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link[^>]*href="(.*?)"/);

    if (titleMatch) {
      items.push({
        title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
        link: linkMatch ? linkMatch[1].trim() : "",
      });
    }
  }
  return items;
}

async function getLatestNews() {
  // 海外テック + AI企業 + 日本語AI系
  const feeds = [
    // 海外テック系
    { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch", type: "rss" },
    { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge", type: "atom" },
    { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat", type: "rss" },
    // AI企業ブログ・リリース
    { url: "https://blog.google/technology/ai/rss/", source: "Google AI Blog", type: "rss" },
    { url: "https://openai.com/blog/rss.xml", source: "OpenAI Blog", type: "rss" },
    { url: "https://www.anthropic.com/rss.xml", source: "Anthropic Blog", type: "rss" },
    // 日本語 AI ニュース（Google News検索）
    { url: "https://news.google.com/rss/search?q=Claude+OR+Gemini+OR+OpenAI+OR+LLM&hl=ja&gl=JP&ceid=JP:ja", source: "Google News JP", type: "rss" },
  ];

  const allNews = [];
  for (const feed of feeds) {
    try {
      const xml = await fetch(feed.url);
      const items = feed.type === "atom" ? extractAtomItems(xml, 3) : extractItems(xml, 3);
      for (const item of items) {
        allNews.push({ ...item, source: feed.source });
      }
    } catch (e) {
      // フィード取得失敗は無視して次へ
    }
  }

  // 重複除去（タイトルで）
  const seen = new Set();
  return allNews.filter((n) => {
    if (seen.has(n.title)) return false;
    seen.add(n.title);
    return true;
  }).slice(0, 15);
}

// === Claude API でツイートドラフト生成 ===
async function generateDrafts(newsItems) {
  const newsText = newsItems
    .map((n, i) => `${i + 1}. [${n.source}] ${n.title}\n   ${n.link}`)
    .join("\n");

  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [
      {
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

出力フォーマット（各ドラフトの間は空行を入れる）:
---
【ドラフト1】
（本文 + URL）

【ドラフト2】
（本文 + URL）

【ドラフト3】
（本文 + URL）
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

// === メイン ===
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
  news.forEach((n, i) => console.log(`${i + 1}. [${n.source}] ${n.title}\n   ${n.link}`));
  console.log("");

  console.log("ドラフト生成中...\n");
  const drafts = await generateDrafts(news);
  console.log(drafts);
  console.log("\n上記から選んで投稿してください！");
}

main().catch(console.error);
