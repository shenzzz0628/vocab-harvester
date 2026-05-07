const $ = (id) => document.getElementById(id);

// ─── Constants ─────────────────────────────────────────────
const INTERVALS = [0, 1, 2, 4, 7, 15, 30];
const MAX_LEVEL = INTERVALS.length - 1;
const STORAGE_KEY = "vocab_harvester_v3";

// ─── State ─────────────────────────────────────────────────
let store = loadStore();
let dataFile = null;
let allItems = [];
let studyQueue = [];
let queueIdx = 0;
let currentFilter = "all";
let studyMode = "smart";
let sidebarSearch = "";
let tablePage = 0;
const PAGE_SIZE = 100;
let sortKey = null, sortDir = 1;
let flashcard = false;
let slideDir = 1; // 1=forward, -1=backward

function defaultStore() {
  return {
    stats: { streak:0, lastStudyDate:"", totalReviews:0, totalCorrect:0, todayCount:0, dailyGoal:25, xp:0 },
    words: {},
    currentFile: "",
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultStore(), ...JSON.parse(raw) } : defaultStore();
  } catch { return defaultStore(); }
}

function saveStore() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }

function fileKey() { return dataFile || store.currentFile || "default"; }

function getWordState(wordId) {
  const fk = fileKey();
  if (!store.words[fk]) store.words[fk] = {};
  if (!store.words[fk][wordId]) {
    store.words[fk][wordId] = { level:0, nextReview:0, reviews:0, correct:0, wrong:0, lastReview:0, firstSeen:Date.now() };
  }
  return store.words[fk][wordId];
}

// ─── Utility ───────────────────────────────────────────────
function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function isArray(v) { return Array.isArray(v); }
function isScalar(v) { return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"; }
function smartStr(v) { if (v === null || v === undefined) return ""; if (typeof v === "object") return JSON.stringify(v); return String(v); }
function fmtSize(b) { if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// ─── Normalization ─────────────────────────────────────────
function normalizeItems(rawData) {
  let src = [];
  if (Array.isArray(rawData)) src = rawData;
  else if (isObject(rawData)) {
    for (const v of Object.values(rawData)) { if (Array.isArray(v) && v.length > 0) { src = v; break; } }
    if (src.length === 0) src = [rawData];
  }
  return src.map(normalizeItem);
}

function normalizeItem(item) {
  if (!isObject(item)) return { id: smartStr(item), word: smartStr(item), phonetic:"", translations:[], sentences:[], extra:{}, raw:item };

  const cet4 = item.content?.word?.content;
  if (cet4) {
    const trans = (cet4.trans || []).map((t) => ({ pos: t.pos || "", meaning: t.tranCn || "" })).filter((t) => t.meaning);
    const sents = cet4.sentence?.sentences || cet4.realExamSentence?.sentences || [];
    const sentences = sents.filter((s) => s.sContent && s.sCn).map((s) => ({ en: s.sContent, cn: s.sCn }));
    const word = item.headWord || cet4.wordHead || "";
    const examQ = (cet4.exam || []).map((e) => ({
      question: e.question || "",
      choices: (e.choices || []).map((c) => c.choice),
      answer: e.answer?.explain || "",
      rightIdx: e.answer?.rightIndex,
    }));

    return {
      id: word.toLowerCase(),
      word,
      phonetic: cet4.usphone || cet4.phone || "",
      translations: trans,
      sentences,
      extra: cleanExtra({
        ukphone: cet4.ukphone || "",
        phrases: (cet4.phrase?.phrases || []).map((p) => ({ en: p.pContent || "", cn: p.pCn || "" })),
        synos: (cet4.syno?.synos || []).map((s) => ({ pos: s.pos || "", words: (s.hwds || []).map((h) => h.w).join("、"), meaning: s.tran || "" })),
        rels: (cet4.relWord?.rels || []).map((r) => ({ pos: r.pos || "", words: (r.words || []).map((w) => w.hwd + " " + (w.tran || "")).join("、") })),
        remMethod: cet4.remMethod?.val || "",
        antos: (cet4.antos?.antos || []).map((a) => ({ pos: a.pos || "", words: (a.hwds || []).map((h) => h.w).join("、"), meaning: a.tran || "" })),
        exam: examQ,
      }),
      raw: item,
    };
  }

  // Generic
  const word = item.word || item.headWord || item.term || item.name || item.title || smartStr(item.id || "");
  const phonetic = item.phonetic || item.usphone || item.phone || "";
  const translation = item.translation || item.meaning || item.definition || "";
  const tArr = item.translations || (translation ? [{ pos: "", meaning: translation }] : []);
  let sentences = [];
  const rs = item.sentences || item.examples || [];
  if (Array.isArray(rs)) sentences = rs.map((s) => isObject(s) ? { en: s.en || s.sContent || "", cn: s.cn || s.sCn || "" } : { en: smartStr(s), cn: "" }).filter((s) => s.en);
  const used = new Set(["word","headWord","term","name","title","id","phonetic","usphone","phone","translation","meaning","definition","translations","sentences","examples","content"]);
  const extra = {};
  for (const [k, v] of Object.entries(item)) { if (!used.has(k) && isScalar(v) && v !== "") extra[k] = v; }

  return { id: word.toLowerCase(), word: smartStr(word), phonetic: smartStr(phonetic), translations: Array.isArray(tArr) ? tArr : [{ pos: "", meaning: smartStr(tArr) }], sentences, extra: cleanExtra(extra), raw: item };
}

function cleanExtra(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) { if (v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v; }
  return out;
}

// ─── File loading ──────────────────────────────────────────
function loadFromJson(json, filename) {
  dataFile = filename || "uploaded";
  store.currentFile = dataFile;
  allItems = normalizeItems(json);
  for (const item of allItems) getWordState(item.id);
  saveStore();
  updateStats();
  buildQueue();
  renderSidebar();
  renderFileList();
  showView("card");
  renderCard();
}

async function loadFile(filename) {
  showView("loading");
  try {
    const res = await fetch(filename);
    if (!res.ok) throw new Error("加载失败");
    loadFromJson(await res.json(), filename);
  } catch (err) {
    $("serverHint").textContent = "❌ " + err.message;
    showView("welcome");
  }
}

// ─── File upload / drag-drop ───────────────────────────────
function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.name.endsWith(".json"));
  if (files.length === 0) { toast("请选择 JSON 文件"); return; }
  showView("loading");
  const file = files[0];
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadFromJson(JSON.parse(reader.result), file.name);
      toast("✅ 已加载 " + file.name);
    } catch { toast("❌ JSON 解析失败"); showView("welcome"); }
  };
  reader.readAsText(file);
}

$("fileInput").addEventListener("change", (e) => handleFiles(e.target.files));
$("welcomeFileInput").addEventListener("change", (e) => handleFiles(e.target.files));

// Drag-drop on welcome
const dropZone = $("dropZone");
if (dropZone) {
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("drag-over"); handleFiles(e.dataTransfer.files); });
}

// Global drag-drop
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.target.closest(".modal-overlay") || e.target.closest("input")) return;
  handleFiles(e.dataTransfer.files);
});

// ─── File list ─────────────────────────────────────────────
let cachedFiles = [];
async function loadFileList() {
  try {
    const res = await fetch("/api/files");
    if (res.ok) { cachedFiles = await res.json(); $("serverHint").textContent = `已连接 · ${cachedFiles.length} 个词库`; }
  } catch { cachedFiles = []; $("serverHint").textContent = "离线模式 · 拖拽 JSON 文件上传"; }
  return cachedFiles;
}

function renderFileList() {
  const fl = $("fileList");
  const files = cachedFiles || [];
  let html = "";
  if (files.length) {
    html += files.map((f) =>
      `<button class="file-item${dataFile === f.name ? " active" : ""}" data-file="${f.name}">
        <span class="file-icon">📄</span><span class="file-info"><span class="file-name">${f.name}</span><span class="file-size">${fmtSize(f.size)}</span></span>
      </button>`
    ).join("");
  }
  if (dataFile && !files.some((f) => f.name === dataFile)) {
    html += `<button class="file-item active" data-file="${dataFile}">
      <span class="file-icon">📂</span><span class="file-info"><span class="file-name">${dataFile}</span><span class="file-badge">已上传</span></span>
    </button>`;
  }
  if (!html) html = '<p class="empty-hint">无词库文件</p>';
  fl.innerHTML = html;

  fl.querySelectorAll(".file-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.file;
      if (name !== dataFile) {
        if (cachedFiles.some((f) => f.name === name)) loadFile(name);
        else toast("此文件已加载");
      }
    });
  });
}

// ─── Queue ─────────────────────────────────────────────────
function buildQueue() {
  const ids = allItems.map((_, i) => i);
  if (studyMode === "random") { shuffle(ids); studyQueue = ids; }
  else if (studyMode === "sequential") { studyQueue = ids; }
  else {
    const due = ids.filter((i) => { const ws = getWordState(allItems[i].id); return ws.level > 0 && ws.level < MAX_LEVEL && ws.nextReview <= Date.now(); });
    const dueNew = ids.filter((i) => { const ws = getWordState(allItems[i].id); return ws.level === 0 && ws.reviews === 0; });
    const rest = ids.filter((i) => !due.includes(i) && !dueNew.includes(i));
    shuffle(dueNew); shuffle(rest);
    studyQueue = [...due, ...dueNew, ...rest];
  }
  if (queueIdx >= studyQueue.length) queueIdx = 0;
}

function getFilteredIndices() {
  return allItems.map((_, i) => i).filter((i) => {
    const ws = getWordState(allItems[i].id);
    const w = allItems[i].word.toLowerCase();
    const sq = sidebarSearch.toLowerCase();
    if (sq && !w.includes(sq)) {
      const tr = allItems[i].translations.map((t) => t.meaning).join(" ");
      if (!tr.toLowerCase().includes(sq)) return false;
    }
    switch (currentFilter) {
      case "due": return ws.level > 0 && ws.level < MAX_LEVEL && ws.nextReview <= Date.now();
      case "new": return ws.level === 0 && ws.reviews === 0;
      case "mastered": return ws.level >= MAX_LEVEL;
      default: return true;
    }
  });
}

// ─── Stats ─────────────────────────────────────────────────
function updateStats() {
  const st = store.stats;
  const today = new Date().toISOString().slice(0, 10);
  if (st.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (st.lastStudyDate === yesterday) st.streak += 1;
    else if (st.lastStudyDate !== today) st.streak = st.todayCount > 0 ? 1 : 0;
    st.lastStudyDate = today;
    st.todayCount = 0;
    saveStore();
  }

  const fk = fileKey();
  const wsAll = store.words[fk] || {};
  let mastered = 0, dueCount = 0;
  for (const [, ws] of Object.entries(wsAll)) {
    if (ws.level >= MAX_LEVEL) mastered++;
    if (ws.level > 0 && ws.level < MAX_LEVEL && ws.nextReview <= Date.now()) dueCount++;
  }

  $("streakVal").textContent = st.streak;
  $("todayText").textContent = `${st.todayCount}/${st.dailyGoal}`;
  const pct = Math.min(100, Math.round((st.todayCount / st.dailyGoal) * 100));
  $("todayProgress").style.width = pct + "%";
  $("todayProgress").style.background = pct >= 100 ? "var(--success)" : "var(--accent)";
  $("masteredVal").textContent = mastered;
  $("xpVal").textContent = st.xp;
  $("levelVal").textContent = Math.floor(st.xp / 100) + 1;
  $("dueBadge").textContent = dueCount;
}

function recordReview(itemId, isCorrect) {
  const ws = getWordState(itemId);
  const st = store.stats;
  const today = new Date().toISOString().slice(0, 10);

  if (st.lastStudyDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    st.streak = (st.lastStudyDate === yesterday) ? st.streak + 1 : 1;
    st.lastStudyDate = today;
    st.todayCount = 0;
  }

  ws.reviews += 1;
  ws.lastReview = Date.now();
  st.totalReviews += 1;
  st.todayCount += 1;

  if (isCorrect) {
    ws.correct += 1; st.totalCorrect += 1;
    if (ws.level < MAX_LEVEL) ws.level += 1;
    ws.nextReview = Date.now() + INTERVALS[Math.min(ws.level, MAX_LEVEL)] * 86400000;
    st.xp += 10 + Math.min(ws.level * 2, 10);
  } else {
    ws.wrong += 1;
    ws.level = Math.max(0, ws.level - 1);
    ws.nextReview = Date.now() + INTERVALS[ws.level] * 86400000;
    st.xp = Math.max(0, st.xp - 3);
  }

  saveStore();
  updateStats();
  renderSidebar();

  if (st.todayCount === st.dailyGoal) toast("🎉 今日目标达成！");
  if (st.totalReviews > 0 && st.totalReviews % 100 === 0) toast(`🔥 累计复习 ${st.totalReviews} 次！`);
  if (st.totalCorrect > 0 && st.totalCorrect % 50 === 0) toast(`⭐ 累计答对 ${st.totalCorrect} 次！`);
  const newLvl = Math.floor(st.xp / 100) + 1;
  const oldLvl = Math.floor((st.xp - (isCorrect ? 18 : 0)) / 100) + 1;
  if (newLvl > oldLvl) toast(`⬆ 升级！Lv.${newLvl}`);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─── View switching ────────────────────────────────────────
function showView(name) {
  ["welcomeView","loadingView","cardView","wordTreeView","tableView","rawTreeView"].forEach((v) => $(v).classList.toggle("hidden", v !== name));
}

// ─── Card rendering ────────────────────────────────────────
function renderCard() {
  if (allItems.length === 0) { showView("welcome"); return; }
  showView("card");

  if (queueIdx >= studyQueue.length) buildQueue();
  if (studyQueue.length === 0) { showView("welcome"); return; }

  const item = allItems[studyQueue[queueIdx]];
  const ws = getWordState(item.id);

  // Level dots
  let dotsHtml = "";
  for (let i = 1; i <= MAX_LEVEL; i++) {
    let cls = "dot";
    if (ws.level >= MAX_LEVEL) cls += " mastered";
    else if (i <= ws.level) cls += " filled";
    dotsHtml += `<span class="${cls}"></span>`;
  }
  $("levelDots").innerHTML = dotsHtml;
  const lvlNames = ["新词","初识","短时","巩固","一周","长期","已掌握"];
  $("levelLabel").textContent = lvlNames[Math.min(ws.level, MAX_LEVEL)];

  // Word
  $("cardWord").textContent = item.word;
  $("cardWord").classList.toggle("blurred", flashcard);
  $("cardPhonetic").textContent = item.phonetic ? `/${item.phonetic}/` : "";
  if (item.extra?.ukphone && item.extra.ukphone !== item.phonetic) {
    $("cardPhonetic").textContent += `  英 /${item.extra.ukphone}/`;
  }

  // Reveal button
  $("revealBtn").innerHTML = flashcard
    ? `<span>👁</span><span>显示单词</span>`
    : `<span>🙈</span><span>隐藏单词</span>`;

  // Translations
  $("cardTranslations").innerHTML = item.translations.length
    ? item.translations.map((t) => `<span class="trans-item">${t.pos ? `<span class="trans-pos">${t.pos}</span>` : ""}<span class="trans-meaning">${t.meaning}</span></span>`).join("")
    : "";

  // Sentences
  $("cardSentences").innerHTML = item.sentences.length
    ? item.sentences.map((s) => `<div class="sentence-item"><p class="sentence-en">${s.en}</p><p class="sentence-cn">${s.cn}</p></div>`).join("")
    : "";

  // Extras
  let exHtml = "";
  const ex = item.extra;
  if (ex) {
    const sec = (title, icon, items, fn) => {
      if (!items || !items.length) return "";
      return `<details class="extra-section"><summary>${icon} ${title} (${items.length})</summary><div class="extra-body">${items.map(fn).join("")}</div></details>`;
    };
    if (ex.phrases?.length) exHtml += sec("短语", "🔗", ex.phrases, (p) => `<p class="extra-line"><b>${p.en}</b> ${p.cn}</p>`);
    if (ex.synos?.length) exHtml += sec("同近义词", "📎", ex.synos, (s) => `<p class="extra-line"><span class="trans-pos">${s.pos}</span> ${s.words} ${s.meaning}</p>`);
    if (ex.antos?.length) exHtml += sec("反义词", "↔", ex.antos, (a) => `<p class="extra-line"><span class="trans-pos">${a.pos}</span> ${a.words} ${a.meaning}</p>`);
    if (ex.rels?.length) exHtml += sec("同根词", "🌱", ex.rels, (r) => `<p class="extra-line"><span class="trans-pos">${r.pos}</span> ${r.words}</p>`);
    if (ex.remMethod) exHtml += `<details class="extra-section"><summary>🧠 记忆方法</summary><div class="extra-body"><p class="extra-line">${ex.remMethod}</p></div></details>`;
    if (ex.exam?.length) exHtml += sec("📝 真题", "📝", ex.exam, (e, i) => `<p class="extra-line"><b>Q:</b> ${e.question}<br>${e.choices.map((c, j) => (j + 1 === e.rightIdx ? `<b>✓${c}</b>` : c)).join(" / ")}<br><span style="color:var(--muted);font-size:11px">${e.answer}</span></p>`);
  }
  $("cardExtras").innerHTML = exHtml;

  $("navPos").textContent = `${queueIdx + 1} / ${studyQueue.length}`;

  // Scroll sidebar
  requestAnimationFrame(() => {
    const active = $("wordList").querySelector(".word-list-item.active");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

// ─── Card actions ──────────────────────────────────────────
function advanceCard(delta) {
  slideDir = delta;
  queueIdx += delta;
  if (queueIdx < 0) queueIdx = studyQueue.length - 1;
  if (queueIdx >= studyQueue.length) { buildQueue(); queueIdx = 0; }
  flashcard = false;
  const card = $("studyCard");
  card.classList.remove("slide-left");
  void card.offsetWidth; // reflow
  card.classList.add(delta > 0 ? "" : "slide-left");
  renderCard();
}

function onKnow() {
  if (!studyQueue.length) return;
  const item = allItems[studyQueue[queueIdx]];
  recordReview(item.id, true);
  // Flash green
  const card = $("studyCard");
  card.classList.add("correct-flash");
  setTimeout(() => card.classList.remove("correct-flash"), 400);
  advanceCard(1);
}

function onDontKnow() {
  if (!studyQueue.length) return;
  const item = allItems[studyQueue[queueIdx]];
  recordReview(item.id, false);
  const card = $("studyCard");
  card.classList.add("wrong-flash");
  setTimeout(() => card.classList.remove("wrong-flash"), 400);
  flashcard = false;
  renderCard();
}

function onToggleReveal() {
  flashcard = !flashcard;
  renderCard();
}

function onSpeak() {
  if (!studyQueue.length) return;
  const item = allItems[studyQueue[queueIdx]];
  if (!("speechSynthesis" in window) || !item.word) return;
  const u = new SpeechSynthesisUtterance(item.word);
  u.lang = "en-US"; u.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// ─── Sidebar ───────────────────────────────────────────────
function renderSidebar() {
  const indices = getFilteredIndices();
  const maxShow = 200;
  const shown = indices.slice(0, maxShow);
  const wl = $("wordList");

  wl.innerHTML = shown.map((i) => {
    const item = allItems[i];
    const ws = getWordState(item.id);
    const active = studyQueue.length > 0 && studyQueue[queueIdx] === i;
    return `<button class="word-list-item${active ? " active" : ""}" data-idx="${i}">
      <span class="wl-word">${item.word}</span>
      <span class="wl-info"><span class="wl-dot" data-lvl="${Math.min(ws.level, MAX_LEVEL)}"></span></span>
    </button>`;
  }).join("");

  if (indices.length > maxShow) wl.innerHTML += `<p style="text-align:center;color:var(--muted);font-size:11px;padding:8px">... 还有 ${indices.length - maxShow} 个</p>`;

  wl.querySelectorAll(".word-list-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      const pos = studyQueue.indexOf(idx);
      if (pos >= 0) { queueIdx = pos; }
      else { studyQueue = [idx, ...studyQueue.filter((j) => j !== idx)]; queueIdx = 0; }
      flashcard = false;
      renderCard();
      if (window.innerWidth < 800) $("studyCard").scrollIntoView({ behavior: "smooth" });
    });
  });
}

// ─── Word Tree View ────────────────────────────────────────
function renderWordTree() {
  if (allItems.length === 0) return;
  showView("wordTree");

  const item = allItems[studyQueue[queueIdx]];
  const ws = getWordState(item.id);
  const ex = item.extra || {};

  let secId = 0;
  const branch = (icon, title, bodyHtml, count) => {
    const id = `wt-sec-${secId++}`;
    return `<div class="wt-branch">
      <div class="wt-branch-head" data-target="${id}">
        <span class="wt-branch-arrow open">▾</span>
        <span class="wt-branch-icon">${icon}</span> ${title}${count != null ? ` (${count})` : ""}
      </div>
      <div class="wt-branch-body" id="${id}">${bodyHtml}</div>
    </div>`;
  };

  let html = `<div class="wt-root">
    <div class="wt-word">${item.word}</div>
    <div class="wt-phonetic">${item.phonetic ? `/ ${item.phonetic} /` : ""}${ex.ukphone && ex.ukphone !== item.phonetic ? `  英 /${ex.ukphone}/` : ""}</div>
  `;

  // Translations
  if (item.translations.length) {
    html += branch("📝", "释义", item.translations.map((t) =>
      `<div class="wt-leaf">${t.pos ? `<span class="wt-pos">${t.pos}</span>` : ""}${t.meaning}</div>`
    ).join(""), item.translations.length);
  }

  // Sentences
  if (item.sentences.length) {
    html += branch("💬", "例句", item.sentences.map((s) =>
      `<div class="wt-leaf">
        <div class="wt-sentence-en">${s.en}</div>
        <div class="wt-sentence-cn">${s.cn}</div>
      </div>`
    ).join(""), item.sentences.length);
  }

  // Phrases
  if (ex.phrases?.length) {
    html += branch("🔗", "短语", ex.phrases.map((p) =>
      `<div class="wt-leaf"><b>${p.en}</b>  ${p.cn}</div>`
    ).join(""), ex.phrases.length);
  }

  // Synonyms
  if (ex.synos?.length) {
    html += branch("📎", "同近义词", ex.synos.map((s) =>
      `<div class="wt-leaf"><span class="wt-pos">${s.pos}</span> ${s.words} ${s.meaning}</div>`
    ).join(""), ex.synos.length);
  }

  // Antonyms
  if (ex.antos?.length) {
    html += branch("↔", "反义词", ex.antos.map((a) =>
      `<div class="wt-leaf"><span class="wt-pos">${a.pos}</span> ${a.words} ${a.meaning}</div>`
    ).join(""), ex.antos.length);
  }

  // Related words
  if (ex.rels?.length) {
    html += branch("🌱", "同根词", ex.rels.map((r) =>
      `<div class="wt-leaf"><span class="wt-pos">${r.pos}</span> ${r.words}</div>`
    ).join(""), ex.rels.length);
  }

  // Memory method
  if (ex.remMethod) {
    html += branch("🧠", "记忆方法", `<div class="wt-leaf">${ex.remMethod}</div>`);
  }

  // Exam
  if (ex.exam?.length) {
    html += branch("📝", "真题", ex.exam.map((e, i) =>
      `<div class="wt-leaf"><b>Q${i + 1}:</b> ${e.question}<br>${e.choices.map((c, j) => (j + 1 === e.rightIdx ? `<b>✓${c}</b>` : c)).join(" / ")}<br><span style="color:var(--muted);font-size:11px">${e.answer}</span></div>`
    ).join(""), ex.exam.length);
  }

  // Study stats for this word
  html += branch("📊", "学习统计", `
    <div class="wt-leaf">等级：${["新词","初识","短时","巩固","一周","长期","已掌握"][Math.min(ws.level, MAX_LEVEL)]}</div>
    <div class="wt-leaf">复习次数：${ws.reviews}</div>
    <div class="wt-leaf">正确：${ws.correct} / 错误：${ws.wrong}</div>
    <div class="wt-leaf">${ws.reviews > 0 ? '正确率：' + Math.round((ws.correct / ws.reviews) * 100) + '%' : '尚未复习'}</div>
    ${ws.nextReview > Date.now() ? `<div class="wt-leaf">下次复习：${new Date(ws.nextReview).toLocaleDateString("zh-CN")}</div>` : ws.level > 0 ? '<div class="wt-leaf" style="color:var(--danger)">⚠ 需要复习</div>' : ''}
  `);

  html += `</div>`;
  $("wordTreeCard").innerHTML = html;
  $("wtNavPos").textContent = `${queueIdx + 1} / ${studyQueue.length}`;

  // Bind branch toggle
  $("wordTreeCard").querySelectorAll(".wt-branch-head").forEach((head) => {
    head.addEventListener("click", () => {
      const target = $(head.dataset.target);
      const arrow = head.querySelector(".wt-branch-arrow");
      if (target) {
        target.classList.toggle("collapsed");
        arrow.classList.toggle("open");
      }
    });
  });
}

function advanceWordTree(delta) {
  queueIdx += delta;
  if (queueIdx < 0) queueIdx = studyQueue.length - 1;
  if (queueIdx >= studyQueue.length) { buildQueue(); queueIdx = 0; }
  renderWordTree();
}

// ─── Table view ────────────────────────────────────────────
function renderTable() {
  showView("table");
  const indices = getFilteredIndices();
  const items = indices.map((i) => allItems[i]);
  $("tableTitle").textContent = `${dataFile || "数据"} · ${items.length} 词`;

  $("tableHead").innerHTML = `<tr>${["单词","释义","等级","复习","正确率","下次复习"].map((c) => `<th>${c}</th>`).join("")}</tr>`;

  const tp = Math.ceil(items.length / PAGE_SIZE);
  if (tablePage >= tp) tablePage = Math.max(0, tp - 1);
  const start = tablePage * PAGE_SIZE;
  const page = items.slice(start, start + PAGE_SIZE);

  $("tableBody").innerHTML = page.map((item) => {
    const ws = getWordState(item.id);
    const rate = ws.reviews > 0 ? Math.round((ws.correct / ws.reviews) * 100) + "%" : "—";
    const next = ws.nextReview > Date.now() ? new Date(ws.nextReview).toLocaleDateString("zh-CN") : (ws.level > 0 ? "需复习" : "—");
    const lvl = ["新词","Lv1","Lv2","Lv3","Lv4","Lv5","已掌握"][Math.min(ws.level, 6)];
    return `<tr data-idx="${indices[start + page.indexOf(item)]}">
      <td><b>${item.word}</b></td><td>${item.translations.map((t) => t.meaning).join(" ")}</td>
      <td>${lvl}</td><td>${ws.reviews}</td><td>${rate}</td><td>${next}</td></tr>`;
  }).join("");

  $("tableBody").querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      const idx = parseInt(tr.dataset.idx);
      studyQueue = [idx, ...studyQueue.filter((j) => j !== idx)];
      queueIdx = 0; flashcard = false;
      renderCard();
      showView("card");
    });
  });

  if (tp <= 1) { $("tablePager").innerHTML = ""; return; }
  let h = `<button${tablePage === 0 ? " disabled" : ""} data-p="0">«</button>`;
  h += `<button${tablePage === 0 ? " disabled" : ""} data-p="${tablePage - 1}">‹</button>`;
  const s = Math.max(0, tablePage - 2), e = Math.min(tp, tablePage + 3);
  if (s > 0) h += `<button data-p="0">1</button><span class="page-info">…</span>`;
  for (let i = s; i < e; i++) h += `<button${i === tablePage ? ' class="active"' : ""} data-p="${i}">${i + 1}</button>`;
  if (e < tp) h += `<span class="page-info">…</span><button data-p="${tp - 1}">${tp}</button>`;
  h += `<button${tablePage >= tp - 1 ? " disabled" : ""} data-p="${tablePage + 1}">›</button>`;
  h += `<button${tablePage >= tp - 1 ? " disabled" : ""} data-p="${tp - 1}">»</button>`;
  $("tablePager").innerHTML = h;
  $("tablePager").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => { tablePage = parseInt(b.dataset.p); renderTable(); });
  });
}

// ─── Raw tree ──────────────────────────────────────────────
function renderRawTree() {
  showView("rawTree");
  $("rawTreeTitle").textContent = dataFile || "JSON 结构";
  $("treeRoot").innerHTML = "<div style='font-family:var(--font-mono);font-size:12px;line-height:1.7'>" + buildRawNode(store.words[fileKey()] || {}, "wordStates") + "</div>";
  $("treeRoot").querySelectorAll(".tree-toggle").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const node = el.closest(".tree-key");
      const children = node.nextElementSibling;
      if (children) { const hid = children.classList.toggle("hidden"); el.textContent = hid ? "▸" : "▾"; }
    });
  });
}

function buildRawNode(value, keyName) {
  const t = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? "array" : typeof v);
  const type = t(value);
  if (type === "null") return `<span class="tree-leaf"><span class="tree-prop">${keyName}:</span><span class="tree-val-null">null</span></span>`;
  if (type === "string") return `<span class="tree-leaf"><span class="tree-prop">${keyName}:</span><span class="tree-val-string">"${esc(String(value))}"</span></span>`;
  if (type === "number") return `<span class="tree-leaf"><span class="tree-prop">${keyName}:</span><span class="tree-val-number">${value}</span></span>`;
  if (type === "boolean") return `<span class="tree-leaf"><span class="tree-prop">${keyName}:</span><span class="tree-val-boolean">${value}</span></span>`;

  if (type === "array") {
    if (value.length === 0) return `<span class="tree-leaf"><span class="tree-prop">${keyName}:</span><span class="tree-bracket">[]</span></span>`;
    const lbl = keyName ? `<span class="tree-prop">${keyName}: </span>` : "";
    if (value.every((v) => v === null || ["string","number","boolean"].includes(typeof v))) {
      const prev = value.slice(0, 20).map((v) => (typeof v === "string" ? `"${esc(v)}"` : v)).join(", ");
      const more = value.length > 20 ? `, … +${value.length - 20}` : "";
      return `<span class="tree-leaf">${lbl}<span class="tree-bracket">[</span>${prev}${more}<span class="tree-bracket">]</span></span>`;
    }
    let h = `<div class="tree-key"><span class="tree-toggle">▾</span>${lbl}<span class="tree-bracket">[${value.length}]</span></div><div class="tree-node">`;
    value.slice(0, 100).forEach((v, i) => { h += buildRawNode(v, String(i)); });
    if (value.length > 100) h += `<span class="tree-leaf" style="color:var(--muted)">… +${value.length - 100}</span>`;
    return h + "</div>";
  }

  const lbl = keyName ? `<span class="tree-prop">${keyName}: </span>` : "";
  const entries = Object.entries(value);
  if (entries.length === 0) return `<span class="tree-leaf">${lbl}<span class="tree-bracket">{}</span></span>`;
  let h = `<div class="tree-key"><span class="tree-toggle">▾</span>${lbl}<span class="tree-bracket">{${entries.length}}</span></div><div class="tree-node">`;
  for (const [k, v] of entries) h += buildRawNode(v, k);
  return h + "</div>";
}

// ─── Import / Export ───────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "vocab_harvester_backup.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("📤 学习数据已导出");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.stats && data.words) {
        store = { ...defaultStore(), ...data };
        saveStore();
        updateStats();
        buildQueue();
        renderSidebar();
        renderCard();
        toast("📥 学习数据已导入");
      } else { toast("❌ 无效的数据文件"); }
    } catch { toast("❌ JSON 解析失败"); }
  };
  reader.readAsText(file);
}

// ─── Event bindings ────────────────────────────────────────
$("knowBtn").addEventListener("click", onKnow);
$("dontKnowBtn").addEventListener("click", onDontKnow);
$("revealBtn").addEventListener("click", onToggleReveal);
$("cardSpeak").addEventListener("click", onSpeak);
$("cardWord").addEventListener("click", () => { flashcard = !flashcard; renderCard(); });
$("cardWordBlur").addEventListener("click", () => { flashcard = false; renderCard(); });
$("prevCardBtn").addEventListener("click", () => advanceCard(-1));
$("nextCardBtn").addEventListener("click", () => advanceCard(1));

// Mode buttons
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    studyMode = btn.dataset.mode;
    buildQueue(); flashcard = false;
    if (!$("cardView").classList.contains("hidden")) renderCard();
    if (!$("wordTreeView").classList.contains("hidden")) renderWordTree();
    renderSidebar();
  });
});

// Filter tabs
document.querySelectorAll(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter;
    renderSidebar();
  });
});

$("sidebarSearch").addEventListener("input", () => { sidebarSearch = $("sidebarSearch").value; renderSidebar(); });
$("sidebarToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));

// View buttons in sidebar footer
$("tableModeBtn").addEventListener("click", () => { if (allItems.length === 0) return; tablePage = 0; renderTable(); });
$("wordTreeModeBtn").addEventListener("click", () => { if (allItems.length === 0) return; renderWordTree(); });
$("rawTreeModeBtn").addEventListener("click", () => { if (allItems.length === 0) return; renderRawTree(); });

// Back buttons
$("tableBackBtn").addEventListener("click", () => { renderCard(); showView("card"); });
$("rawTreeBackBtn").addEventListener("click", () => { renderCard(); showView("card"); });
$("wtBackBtn").addEventListener("click", () => { renderCard(); showView("card"); });

// Word tree nav
$("wtPrevBtn").addEventListener("click", () => advanceWordTree(-1));
$("wtNextBtn").addEventListener("click", () => advanceWordTree(1));

// Settings
$("settingsBtn").addEventListener("click", () => {
  $("dailyGoalInput").value = store.stats.dailyGoal;
  $("intervalsRow").innerHTML = INTERVALS.map((d, i) => `<span class="interval-tag">Lv${i}: ${d}天</span>`).join(" ");
  $("settingsModal").classList.remove("hidden");
});
$("settingsClose").addEventListener("click", () => $("settingsModal").classList.add("hidden"));
$("settingsModal").addEventListener("click", (e) => { if (e.target === $("settingsModal")) $("settingsModal").classList.add("hidden"); });
$("dailyGoalInput").addEventListener("change", () => {
  store.stats.dailyGoal = Math.max(5, Math.min(200, parseInt($("dailyGoalInput").value) || 25));
  saveStore(); updateStats();
});
$("resetProgressBtn").addEventListener("click", () => {
  if (confirm("确定要重置所有学习进度吗？此操作不可恢复。")) {
    store.words[fileKey()] = {};
    store.stats = { ...defaultStore().stats };
    saveStore(); updateStats(); buildQueue(); renderSidebar(); renderCard();
    $("settingsModal").classList.add("hidden");
    toast("🔄 进度已重置");
  }
});
$("exportBtn").addEventListener("click", exportData);
$("importBtn").addEventListener("click", () => $("importFileInput").click());
$("importFileInput").addEventListener("change", (e) => { if (e.target.files[0]) importData(e.target.files[0]); });

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  const inCard = !$("cardView").classList.contains("hidden");
  const inWTree = !$("wordTreeView").classList.contains("hidden");

  if (inCard) {
    if (e.key === "ArrowLeft") advanceCard(-1);
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); advanceCard(1); }
    if (e.key === "1" || e.key === "a") onDontKnow();
    if (e.key === "2" || e.key === "d") onKnow();
    if (e.key === "3" || e.key === "s" || e.key === "f") onToggleReveal();
    if (e.key === "r") onSpeak();
  }
  if (inWTree) {
    if (e.key === "ArrowLeft") advanceWordTree(-1);
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); advanceWordTree(1); }
  }
  if (e.key === "Escape") {
    if (!$("settingsModal").classList.contains("hidden")) $("settingsModal").classList.add("hidden");
    else if (inWTree || !$("tableView").classList.contains("hidden") || !$("rawTreeView").classList.contains("hidden")) { renderCard(); showView("card"); }
    else { flashcard = false; renderCard(); }
  }
});

// ─── Init ──────────────────────────────────────────────────
(async () => {
  const files = await loadFileList();
  renderFileList();

  if (files.length > 0) {
    if (store.currentFile && files.some((f) => f.name === store.currentFile)) {
      await loadFile(store.currentFile);
    } else {
      await loadFile(files[0].name);
    }
  } else {
    // No server files — show welcome with upload prompt
    if (store.currentFile && allItems.length === 0) {
      showView("welcome");
      $("serverHint").textContent = "离线模式 · 拖拽 JSON 文件上传或选择文件";
    } else {
      showView("welcome");
      $("serverHint").textContent = "离线模式 · 拖拽 JSON 文件上传或选择文件";
    }
  }

  updateStats();
  renderFileList();
})();
