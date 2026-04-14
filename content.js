// === 設定 ===
const SPAM_WORDS = [
  "稼ぐ", "副収入", "無料相談", "LINE登録", "公式LINE", "月収",
  "万円達成", "情報商材", "コンサル生", "実績者の声", "脱サラ",
  "自動収益", "不労所得", "DMください", "プレゼント企画",
  "限定公開", "note販売", "教材", "オンラインサロン",
];

// リプライテンプレート（投稿内容に応じて自動選択）
// 丁寧寄りのカジュアルで統一。「ですます」ベースに少し崩す。
const REPLY_TEMPLATES = {
  learning: {
    keywords: ["勉強", "学習", "初心者", "積み上げ", "入門", "始めた", "挑戦", "独学", "スクール"],
    replies: [
      "おー自分も今ちょうどやってるとこです",
      "最初ほんと大変ですよね、わかります",
      "自分もそこ苦戦しました...お互いがんばりましょう",
      "毎日やってるのえらいですね",
      "同じとこやってる人いて嬉しいです",
      "ここ乗り越えたらだいぶ楽になりますよ〜",
      "めっちゃわかります笑 自分もそうでした",
    ],
  },
  built: {
    keywords: ["作った", "リリース", "公開", "デプロイ", "完成", "実装した", "開発した", "ローンチ"],
    replies: [
      "おーこれ気になります、使ってみますね",
      "へぇ〜これどのくらいで作ったんですか？",
      "ちゃんと形にしてるのすごいですね",
      "いい感じですね、技術スタック何使ってるんですか？",
      "おもしろそうです、自分もなんか作りたくなりました",
    ],
  },
  trouble: {
    keywords: ["エラー", "バグ", "ハマった", "詰まった", "わからない", "困った", "解決できない"],
    replies: [
      "あーそれ自分もハマったことあります...",
      "つらいやつですね...おつかれさまです",
      "あるあるですよねそれ",
      "地味にきついですよねそれ",
      "解決した時の達成感すごそうですね",
    ],
  },
  career: {
    keywords: ["転職", "副業", "フリーランス", "年収", "採用", "人事", "広報", "内定", "面接", "退職"],
    replies: [
      "わかります〜自分も最近それ考えてました",
      "めっちゃリアルな話でありがたいです",
      "ほんとそれですよね",
      "いい話聞けました、ありがとうございます",
      "同じ悩み持ってる人いて安心しました",
    ],
  },
  article: {
    keywords: ["ブログ", "記事", "Qiita", "Zenn", "note書いた", "アウトプット"],
    replies: [
      "あとで読みます、ブクマしました",
      "ちょうど気になってたやつです",
      "わかりやすくていいですねこれ",
      "書くのえらいですね...自分もやらないと",
    ],
  },
  general: {
    keywords: [],
    replies: [
      "たしかにそうですね",
      "へぇ〜知らなかったです",
      "おーなるほどです",
      "いいですねそれ",
      "ふむふむ、勉強になります",
    ],
  },
};

const DEFAULT_SETTINGS = {
  delay: 8,
  maxLikes: 50,
  maxFollows: 25,
  maxReplies: 15,
};

// === 状態管理 ===
let running = false;
let counts = { likes: 0, follows: 0, replies: 0, skipped: 0 };
let settings = { ...DEFAULT_SETTINGS };

// === ユーティリティ ===
function sleep(sec) {
  const jitter = sec * (0.5 + Math.random());
  return new Promise((r) => setTimeout(r, jitter * 1000));
}

function isSpam(text) {
  return SPAM_WORDS.some((w) => text.includes(w));
}

// AI生成リプライ（ローカルプロキシ経由）
async function generateAIReply(tweetText) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "generateReply", tweetText },
      (response) => {
        if (response && response.reply) {
          resolve(response.reply);
        } else {
          reject(new Error(response?.error || "AI生成失敗"));
        }
      }
    );
  });
}

// フォールバック用テンプレ選択
function pickReplyFallback(tweetText) {
  for (const [category, data] of Object.entries(REPLY_TEMPLATES)) {
    if (category === "general") continue;
    if (data.keywords.some((kw) => tweetText.includes(kw))) {
      return data.replies[Math.floor(Math.random() * data.replies.length)];
    }
  }
  const gen = REPLY_TEMPLATES.general.replies;
  return gen[Math.floor(Math.random() * gen.length)];
}

// リプライ取得（AI優先、失敗時テンプレにフォールバック）
async function pickReply(tweetText) {
  try {
    const reply = await generateAIReply(tweetText);
    addLog("AI生成リプ");
    return reply;
  } catch (e) {
    addLog(`AI失敗、テンプレ使用: ${e.message}`);
    return pickReplyFallback(tweetText);
  }
}

function addLog(msg) {
  const logEl = document.getElementById("xmh-log");
  if (!logEl) return;
  const div = document.createElement("div");
  const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  div.textContent = `[${time}] ${msg}`;
  logEl.prepend(div);
  while (logEl.children.length > 50) logEl.lastChild.remove();
}

function updateStats() {
  const el = document.getElementById("xmh-stats");
  if (el) {
    el.innerHTML = `いいね: ${counts.likes}/${settings.maxLikes} | リプ: ${counts.replies}/${settings.maxReplies} | フォロー: ${counts.follows}/${settings.maxFollows}<br>スパム除外: ${counts.skipped}`;
  }
}

// === ツイート取得 ===
function getVisibleTweets() {
  return Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
}

function getTweetText(article) {
  const el = article.querySelector('[data-testid="tweetText"]');
  return el ? el.innerText : "";
}

function getTweetUser(article) {
  const el = article.querySelector('[data-testid="User-Name"]');
  return el ? el.innerText : "";
}

// === アクション ===
async function likeOne(article) {
  const btn = article.querySelector('[data-testid="like"]');
  if (!btn) return false;
  btn.click();
  return true;
}

async function replyToTweet(article, replyText) {
  // リプライボタンをクリック
  const replyBtn = article.querySelector('[data-testid="reply"]');
  if (!replyBtn) return false;
  replyBtn.click();

  // リプライモーダルが開くのを待つ
  await sleep(2);

  // リプライ入力欄を探す
  const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!replyBox) {
    addLog("リプ入力欄が見つからない、スキップ");
    // モーダルを閉じる
    const closeBtn = document.querySelector('[data-testid="app-bar-close"]');
    if (closeBtn) closeBtn.click();
    return false;
  }

  // テキスト入力（contenteditable な div）
  replyBox.focus();
  await sleep(0.5);
  document.execCommand("insertText", false, replyText);
  await sleep(1);

  // 送信ボタン
  const sendBtn = document.querySelector('[data-testid="tweetButton"]');
  if (!sendBtn) {
    addLog("送信ボタンが見つからない、スキップ");
    const closeBtn = document.querySelector('[data-testid="app-bar-close"]');
    if (closeBtn) closeBtn.click();
    return false;
  }

  // 確認ダイアログ（送信前に内容を確認できる）
  const action = await showReplyConfirm(replyText, article);

  if (action === "send") {
    sendBtn.click();
    await sleep(2);
    return true;
  } else if (action === "edit") {
    // ユーザーが編集済み。モーダルは開いたまま手動送信を待つ
    addLog("手動編集モード、送信したら次へ進みます");
    await waitForReplyModalClose();
    return true;
  } else {
    // スキップ
    const closeBtn = document.querySelector('[data-testid="app-bar-close"]');
    if (closeBtn) closeBtn.click();
    await sleep(1);
    addLog("リプスキップ");
    return false;
  }
}

// リプライ確認ダイアログ
function showReplyConfirm(replyText, article) {
  return new Promise((resolve) => {
    // 元ツイートの情報
    const tweetText = getTweetText(article);
    const user = getTweetUser(article).split("\n")[0];

    const overlay = document.createElement("div");
    overlay.id = "xmh-confirm-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:100000;display:flex;align-items:center;justify-content:center;";

    const dialog = document.createElement("div");
    dialog.style.cssText = "background:#15202b;border:1px solid #38444d;border-radius:16px;padding:20px;max-width:480px;width:90%;color:#e7e9ea;font-family:-apple-system,sans-serif;";

    dialog.innerHTML = `
      <div style="font-size:13px;color:#8b98a5;margin-bottom:8px;">元ツイート (${user}):</div>
      <div style="font-size:14px;margin-bottom:16px;padding:10px;background:#273340;border-radius:8px;max-height:80px;overflow-y:auto;">${tweetText.slice(0, 200)}</div>
      <div style="font-size:13px;color:#8b98a5;margin-bottom:8px;">リプライ内容:</div>
      <div style="font-size:16px;margin-bottom:20px;padding:10px;background:#273340;border-radius:8px;color:#1d9bf0;">${replyText}</div>
      <div style="display:flex;gap:8px;">
        <button id="xmh-confirm-send" style="flex:1;padding:10px;border:none;border-radius:9999px;background:#1d9bf0;color:white;font-size:14px;font-weight:700;cursor:pointer;">送信</button>
        <button id="xmh-confirm-edit" style="flex:1;padding:10px;border:none;border-radius:9999px;background:#ff6b00;color:white;font-size:14px;font-weight:700;cursor:pointer;">自分で編集</button>
        <button id="xmh-confirm-skip" style="flex:1;padding:10px;border:none;border-radius:9999px;background:#71767b;color:white;font-size:14px;font-weight:700;cursor:pointer;">スキップ</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById("xmh-confirm-send").addEventListener("click", () => {
      overlay.remove();
      resolve("send");
    });
    document.getElementById("xmh-confirm-edit").addEventListener("click", () => {
      overlay.remove();
      resolve("edit");
    });
    document.getElementById("xmh-confirm-skip").addEventListener("click", () => {
      overlay.remove();
      resolve("skip");
    });
  });
}

// リプライモーダルが閉じるのを待つ（手動編集・送信後）
function waitForReplyModalClose() {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const modal = document.querySelector('[data-testid="tweetButton"]');
      // モーダルが消えたら（送信完了）resolve
      if (!modal) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
    // 最大2分で抜ける
    setTimeout(() => { clearInterval(check); resolve(); }, 120000);
  });
}

async function followFromArticle(article) {
  const linkEl = article.querySelector('a[href^="/"][role="link"][tabindex="-1"]');
  if (!linkEl) return false;

  const href = linkEl.getAttribute("href");
  if (!href) return false;

  window.open(`https://x.com${href}`, "_blank");
  addLog(`プロフィール開く: ${href}`);
  return true;
}

// === スクロール ===
async function scrollDown() {
  window.scrollBy({ top: 600, behavior: "smooth" });
  await sleep(2);
}

// === メイン処理: いいねのみ ===
async function runLikes() {
  if (running) return;
  running = true;
  updateButtons();
  addLog("いいね開始...");

  const processed = new Set();

  while (running && counts.likes < settings.maxLikes) {
    const tweets = getVisibleTweets();

    for (const tweet of tweets) {
      if (!running) break;
      if (counts.likes >= settings.maxLikes) break;

      const text = getTweetText(tweet);
      const key = text.slice(0, 80);
      if (processed.has(key)) continue;
      processed.add(key);

      if (isSpam(text)) {
        counts.skipped++;
        addLog(`SKIP: ${text.slice(0, 30)}...`);
        updateStats();
        continue;
      }

      const liked = await likeOne(tweet);
      if (liked) {
        counts.likes++;
        const user = getTweetUser(tweet).split("\n")[0];
        addLog(`LIKE: ${user}`);
        updateStats();
        await sleep(settings.delay);
      }
    }

    await scrollDown();
  }

  running = false;
  updateButtons();
  addLog(`完了! いいね:${counts.likes} スキップ:${counts.skipped}`);
}

// === メイン処理: いいね + リプライ ===
async function runLikeReply() {
  if (running) return;
  running = true;
  updateButtons();
  addLog("いいね+リプ開始...");

  const processed = new Set();

  while (running && (counts.likes < settings.maxLikes || counts.replies < settings.maxReplies)) {
    const tweets = getVisibleTweets();

    for (const tweet of tweets) {
      if (!running) break;

      const text = getTweetText(tweet);
      const key = text.slice(0, 80);
      if (processed.has(key)) continue;
      processed.add(key);

      if (isSpam(text)) {
        counts.skipped++;
        addLog(`SKIP: ${text.slice(0, 30)}...`);
        updateStats();
        continue;
      }

      // いいね
      if (counts.likes < settings.maxLikes) {
        const liked = await likeOne(tweet);
        if (liked) {
          counts.likes++;
          const user = getTweetUser(tweet).split("\n")[0];
          addLog(`LIKE: ${user}`);
          updateStats();
          await sleep(settings.delay);
        }
      }

      // リプライ
      if (counts.replies < settings.maxReplies) {
        const reply = await pickReply(text);
        const replied = await replyToTweet(tweet, reply);
        if (replied) {
          counts.replies++;
          const user = getTweetUser(tweet).split("\n")[0];
          addLog(`REPLY: ${user} ← "${reply}"`);
          updateStats();
          await sleep(settings.delay * 2); // リプは間隔長めに
        }
      }
    }

    await scrollDown();
  }

  running = false;
  updateButtons();
  addLog(`完了! いいね:${counts.likes} リプ:${counts.replies}`);
}

// === メイン処理: フルコース ===
async function runAll() {
  if (running) return;
  running = true;
  updateButtons();
  addLog("いいね+リプ+フォロー開始...");

  const processed = new Set();

  while (running) {
    if (counts.likes >= settings.maxLikes && counts.replies >= settings.maxReplies && counts.follows >= settings.maxFollows) break;

    const tweets = getVisibleTweets();

    for (const tweet of tweets) {
      if (!running) break;

      const text = getTweetText(tweet);
      const key = text.slice(0, 80);
      if (processed.has(key)) continue;
      processed.add(key);

      if (isSpam(text)) {
        counts.skipped++;
        addLog(`SKIP: ${text.slice(0, 30)}...`);
        updateStats();
        continue;
      }

      // いいね
      if (counts.likes < settings.maxLikes) {
        const liked = await likeOne(tweet);
        if (liked) {
          counts.likes++;
          const user = getTweetUser(tweet).split("\n")[0];
          addLog(`LIKE: ${user}`);
          updateStats();
          await sleep(settings.delay);
        }
      }

      // リプライ
      if (counts.replies < settings.maxReplies) {
        const reply = await pickReply(text);
        const replied = await replyToTweet(tweet, reply);
        if (replied) {
          counts.replies++;
          const user = getTweetUser(tweet).split("\n")[0];
          addLog(`REPLY: ${user} ← "${reply}"`);
          updateStats();
          await sleep(settings.delay * 2);
        }
      }

      // フォロー
      if (counts.follows < settings.maxFollows) {
        await followFromArticle(tweet);
        counts.follows++;
        updateStats();
      }
    }

    await scrollDown();
  }

  running = false;
  updateButtons();
  addLog(`完了! いいね:${counts.likes} リプ:${counts.replies} フォロー:${counts.follows}`);
}

function stopAll() {
  running = false;
  addLog("停止しました");
  updateButtons();
}

// === UI ===
function updateButtons() {
  const btns = document.querySelectorAll(".xmh-btn");
  btns.forEach((b) => {
    if (b.classList.contains("xmh-btn-stop")) {
      b.style.display = running ? "block" : "none";
    } else {
      b.disabled = running;
    }
  });
}

function createPanel() {
  if (document.getElementById("xmh-panel")) return;

  const panel = document.createElement("div");
  panel.id = "xmh-panel";
  panel.innerHTML = `
    <h3>X Marketing Helper</h3>
    <div class="xmh-stats" id="xmh-stats">いいね: 0/${settings.maxLikes} | リプ: 0/${settings.maxReplies} | フォロー: 0/${settings.maxFollows}<br>スパム除外: 0</div>

    <button class="xmh-btn xmh-btn-like" id="xmh-like">いいねのみ</button>
    <button class="xmh-btn xmh-btn-reply" id="xmh-like-reply">いいね + リプ</button>
    <button class="xmh-btn xmh-btn-all" id="xmh-all">フルコース（いいね+リプ+フォロー）</button>
    <button class="xmh-btn xmh-btn-stop" id="xmh-stop" style="display:none">停止</button>

    <div class="xmh-settings">
      <label>間隔(秒) <input type="number" id="xmh-delay" value="${settings.delay}" min="3" max="60"></label>
      <label>いいね上限 <input type="number" id="xmh-max-likes" value="${settings.maxLikes}" min="1" max="200"></label>
      <label>リプ上限 <input type="number" id="xmh-max-replies" value="${settings.maxReplies}" min="1" max="50"></label>
      <label>フォロー上限 <input type="number" id="xmh-max-follows" value="${settings.maxFollows}" min="1" max="100"></label>
    </div>

    <div class="xmh-log" id="xmh-log"></div>
  `;

  document.body.appendChild(panel);

  document.getElementById("xmh-like").addEventListener("click", () => {
    readSettings();
    runLikes();
  });
  document.getElementById("xmh-like-reply").addEventListener("click", () => {
    readSettings();
    runLikeReply();
  });
  document.getElementById("xmh-all").addEventListener("click", () => {
    readSettings();
    runAll();
  });
  document.getElementById("xmh-stop").addEventListener("click", stopAll);

}

function readSettings() {
  settings.delay = parseInt(document.getElementById("xmh-delay").value) || 8;
  settings.maxLikes = parseInt(document.getElementById("xmh-max-likes").value) || 50;
  settings.maxReplies = parseInt(document.getElementById("xmh-max-replies").value) || 15;
  settings.maxFollows = parseInt(document.getElementById("xmh-max-follows").value) || 25;
  counts = { likes: 0, follows: 0, replies: 0, skipped: 0 };
  updateStats();
}

// === 起動 ===
setTimeout(createPanel, 2000);

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(createPanel, 2000);
  }
}, 1000);
