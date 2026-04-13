// Claude API 呼び出し（content script からは CORS で叩けないので background で中継）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "generateReply") {
    generateReply(request.tweetText, request.apiKey)
      .then((reply) => sendResponse({ reply }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 非同期レスポンスを示す
  }
});

async function generateReply(tweetText, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
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
- リプライ本文だけを出力。前置きや説明は不要

ツイート:
${tweetText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}
