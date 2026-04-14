// ローカルプロキシサーバー経由で Claude API を呼び出す
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "generateReply") {
    generateReply(request.tweetText)
      .then((reply) => sendResponse({ reply }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function generateReply(tweetText) {
  const response = await fetch("http://localhost:3456/generate-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tweetText }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Proxy error ${response.status}: ${err}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.reply;
}
