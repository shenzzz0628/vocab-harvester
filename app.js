const DATA_FILES = ["CET4_1.json", "CET4_2.json", "CET4_3.json"];
const STORAGE_KEY = "cet4_web_vocab_state_v1";

const $ = (id) => document.getElementById(id);

const els = {
  loadingView: $("loadingView"),
  studyView: $("studyView"),
  scoreValue: $("scoreValue"),
  comboValue: $("comboValue"),
  doneValue: $("doneValue"),
  totalValue: $("totalValue"),
  translationText: $("translationText"),
  exampleBlock: $("exampleBlock"),
  exampleCn: $("exampleCn"),
  exampleEn: $("exampleEn"),
  answerInput: $("answerInput"),
  answerForm: $("answerForm"),
  answerText: $("answerText"),
  resultBox: $("resultBox"),
  nextBtn: $("nextBtn"),
  showBtn: $("showBtn"),
  wrongBtn: $("wrongBtn"),
  speakBtn: $("speakBtn"),
  shuffleBtn: $("shuffleBtn"),
  typeModeBtn: $("typeModeBtn"),
  cardModeBtn: $("cardModeBtn"),
  weakModeBtn: $("weakModeBtn"),
  submitBtn: $("submitBtn"),
  bookTag: $("bookTag"),
  searchInput: $("searchInput"),
  wordList: $("wordList"),
};

let words = [];
let current = null;
let mode = "type";
let state = loadState();

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
      score: 0,
      combo: 0,
      done: 0,
      stats: {},
    };
  } catch {
    return { score: 0, combo: 0, done: 0, stats: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeAnswer(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function pickFirstSentence(content) {
  const sentences = content?.sentence?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) return {};
  return sentences.find((item) => item?.sContent && item?.sCn) || sentences[0] || {};
}

function flattenWord(raw) {
  const content = raw?.content?.word?.content || {};
  const trans = Array.isArray(content.trans) ? content.trans : [];
  const sentence = pickFirstSentence(content);
  const translation = trans
    .map((item) => {
      const pos = item.pos ? `[${item.pos}] ` : "";
      return `${pos}${item.tranCn || ""}`;
    })
    .filter(Boolean)
    .join("  ");

  return {
    id: raw.content?.word?.wordId || `${raw.bookId}_${raw.wordRank}_${raw.headWord}`,
    word: raw.headWord || raw.content?.word?.wordHead || "",
    translation: translation || "暂无释义",
    exampleEn: sentence.sContent || "",
    exampleCn: sentence.sCn || "",
    book: raw.bookId || "CET4",
  };
}

async function loadWords() {
  const chunks = await Promise.all(
    DATA_FILES.map(async (file) => {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`${file} 加载失败`);
      return response.json();
    })
  );

  words = chunks
    .flat()
    .map(flattenWord)
    .filter((item) => item.word && item.translation);

  els.loadingView.classList.add("hidden");
  els.studyView.classList.remove("hidden");
  els.totalValue.textContent = `${words.length} 词`;
  updateStats();
  renderList();
  nextWord();
}

function getWordStats(word) {
  if (!state.stats[word.id]) {
    state.stats[word.id] = { seen: 0, correct: 0, wrong: 0 };
  }
  return state.stats[word.id];
}

function chooseWord() {
  const weakWords = words.filter((item) => {
    const stats = state.stats[item.id];
    return stats && stats.wrong > stats.correct;
  });

  const pool = mode === "weak" && weakWords.length > 0 ? weakWords : words;
  const weighted = [];

  for (const item of pool) {
    const stats = state.stats[item.id];
    const misses = stats?.wrong || 0;
    const hits = stats?.correct || 0;
    const weight = Math.max(1, 3 + misses * 2 - hits);
    for (let i = 0; i < weight; i += 1) weighted.push(item);
  }

  return weighted[Math.floor(Math.random() * weighted.length)] || pool[0];
}

function nextWord(forcedWord) {
  current = forcedWord || chooseWord();
  els.bookTag.textContent = current.book;
  els.translationText.textContent = current.translation;
  els.exampleCn.textContent = current.exampleCn || "暂无例句";
  els.exampleBlock.classList.toggle("hidden", !current.exampleCn);
  els.answerInput.value = "";
  els.resultBox.className = "result hidden";
  els.answerText.textContent = "";
  els.exampleEn.textContent = "";
  els.answerInput.disabled = mode !== "type";
  els.submitBtn.disabled = mode !== "type";
  els.answerInput.placeholder = mode === "type" ? "输入英文单词" : "卡片模式";
  if (mode === "type") els.answerInput.focus({ preventScroll: true });
}

function updateStats() {
  els.scoreValue.textContent = state.score;
  els.comboValue.textContent = state.combo;
  els.doneValue.textContent = state.done;
}

function showResult(kind) {
  els.resultBox.className = `result ${kind || ""}`;
  els.answerText.textContent = current.word;
  els.exampleEn.textContent = current.exampleEn || "";
}

function recordResult(isCorrect) {
  const stats = getWordStats(current);
  stats.seen += 1;
  state.done += 1;

  if (isCorrect) {
    stats.correct += 1;
    state.score += 10 + state.combo * 2;
    state.combo += 1;
    showResult("correct");
  } else {
    stats.wrong += 1;
    state.score = Math.max(0, state.score - 5);
    state.combo = 0;
    showResult("wrong");
  }

  saveState();
  updateStats();
  renderList(els.searchInput.value);
}

function submitAnswer(event) {
  event.preventDefault();
  if (!current || mode !== "type") return;
  const typed = normalizeAnswer(els.answerInput.value);
  if (!typed) return;
  const isCorrect = typed === normalizeAnswer(current.word);
  recordResult(isCorrect);
}

function setMode(nextMode) {
  mode = nextMode;
  els.typeModeBtn.classList.toggle("active", mode === "type");
  els.cardModeBtn.classList.toggle("active", mode === "card");
  els.weakModeBtn.classList.toggle("active", mode === "weak");
  nextWord();
}

function speakCurrent() {
  if (!current || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(current.word);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function renderList(filter = "") {
  const keyword = normalizeAnswer(filter);
  const matched = words
    .filter((item) => !keyword || item.word.toLowerCase().includes(keyword))
    .slice(0, 50);

  els.wordList.innerHTML = "";

  for (const item of matched) {
    const button = document.createElement("button");
    button.className = "word-item";
    button.type = "button";
    button.innerHTML = `<strong>${item.word}</strong><span>${item.translation}</span>`;
    button.addEventListener("click", () => nextWord(item));
    els.wordList.appendChild(button);
  }
}

els.answerForm.addEventListener("submit", submitAnswer);
els.nextBtn.addEventListener("click", () => nextWord());
els.showBtn.addEventListener("click", () => showResult());
els.wrongBtn.addEventListener("click", () => recordResult(false));
els.speakBtn.addEventListener("click", speakCurrent);
els.shuffleBtn.addEventListener("click", () => nextWord());
els.typeModeBtn.addEventListener("click", () => setMode("type"));
els.cardModeBtn.addEventListener("click", () => setMode("card"));
els.weakModeBtn.addEventListener("click", () => setMode("weak"));
els.searchInput.addEventListener("input", (event) => renderList(event.target.value));

loadWords().catch((error) => {
  els.loadingView.innerHTML = `<p>${error.message}</p>`;
});
