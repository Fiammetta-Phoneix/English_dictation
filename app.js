const lessons = [
  { zh: "因为有些粉结块了。", en: "because some of the powder has clumped" },
  { zh: "我每天早上练习英语听力。", en: "I practice English listening every morning" },
  { zh: "熟能生巧。", en: "practice makes perfect" },
  { zh: "我们将按照时间顺序来讲述这个故事，而荷马并没有这样做。", en: "We're going to proceed through the story chronologically, which Homer does not do" },

  // 根据 Reuters 2026-08-12 报道改写的进阶听写句：
  // https://www.reuters.com/legal/transactional/bank-america-launches-250-billion-initiative-us-tech-energy-infrastructure-2026-08-12/
  { zh: "美国银行推出了一项规模达二千五百亿美元的计划，旨在推动美国关键基础设施的新一轮投资。", en: "Bank of America has launched a two hundred and fifty billion dollar initiative designed to accelerate a new wave of investment in critical American infrastructure" },
  { zh: "该计划将重点支持人工智能数据中心、半导体制造以及日益紧迫的能源基础设施需求。", en: "The initiative will focus on artificial intelligence data centers semiconductor manufacturing and the increasingly urgent need for expanded energy infrastructure" },
  { zh: "该行表示，资金将通过贷款、投资、资本市场交易以及面向企业客户的顾问服务来调动。", en: "The bank said capital would be mobilized through lending investments capital markets transactions and advisory services provided to corporate clients" },
  { zh: "随着人工智能投资加速，科技公司正面临算力、电力供应和制造能力方面越来越大的限制。", en: "As investment in artificial intelligence accelerates technology companies are confronting mounting constraints on computing power electricity supplies and manufacturing capacity" },
  { zh: "除数据中心和先进芯片外，该计划还涵盖硬件、设备以及支撑数字经济的其他关键技术。", en: "Beyond data centers and advanced chips the initiative also covers hardware equipment and other critical technologies underpinning the digital economy" },
  { zh: "传统能源与可再生能源发电项目都将符合条件，储能系统以及电网相关设施也包括在内。", en: "Both conventional and renewable power generation projects will be eligible along with energy storage systems and infrastructure connected to the electrical grid" },
  { zh: "该计划的范围延伸至交通、天然气、水务系统和关键矿产，因为这些领域对工业扩张至关重要。", en: "The program extends to transportation natural gas water systems and critical minerals because each of these sectors is essential to industrial expansion" },
  { zh: "美国银行预计，这些投资不仅会提高国家竞争力，还可能在多个行业创造数以万计的就业岗位。", en: "Bank of America expects the investments not only to strengthen national competitiveness but also to create tens of thousands of jobs across multiple industries" },
  { zh: "该计划从今年年初开始计算，并将持续到二〇二七年年中，届时银行将评估已调动的资金总额。", en: "The initiative will be measured from the beginning of this year through the middle of twenty twenty seven when the bank will assess the capital mobilized" },
  { zh: "随着人工智能热潮推动基础设施需求急剧上升，华尔街大型银行正竞相将私人资本引向战略性项目。", en: "As the artificial intelligence boom drives a sharp increase in infrastructure demand major Wall Street banks are competing to direct private capital toward strategic projects" }
];

const builtInLessonCount = lessons.length;
const transcriptLibraryKey = "dictation-transcript-library-v1";
const maxSavedTranscripts = 30;
const audioLeadInSeconds = 0.35;
const audioTailSeconds = 0.25;

const state = {
  index: Math.min(Number(localStorage.getItem("dictation-index") || 0), lessons.length - 1),
  correct: Number(localStorage.getItem("dictation-correct") || 0),
  replays: 0,
  checked: false,
  peekTimer: null,
  audioUrl: null,
  clipStart: 0,
  clipEnd: 0,
  currentAudioFingerprint: null,
  favoriteKeys: new Set()
};

const $ = (selector) => document.querySelector(selector);
const answerArea = $("#answerArea");
const feedback = $("#feedback");
const sourceAudio = $("#sourceAudio");

function wordsFor(lesson) {
  return lesson.en.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
}

function normalize(value) {
  return value.trim().toLocaleLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}'-]/gu, "");
}

function render() {
  const lesson = lessons[state.index];
  const words = wordsFor(lesson);
  state.checked = false;
  $("#hintText").textContent = lesson.zh;
  $("#progressText").textContent = `${state.index + 1} / ${lessons.length}`;
  $("#progressBar").style.width = `${((state.index + 1) / lessons.length) * 100}%`;
  $("#correctCount").textContent = state.correct;
  $("#replayCount").textContent = state.replays;
  $("#statusText").textContent = lesson.source === "local" ? "真人音频" : "合成语音";
  const favoriteKey = normalize(lesson.en);
  $("#favoriteBtn").classList.toggle("saved", state.favoriteKeys.has(favoriteKey));
  $("#favoriteBtn").textContent = state.favoriteKeys.has(favoriteKey) ? "★ 已收藏" : "☆ 收藏例句";
  $("#nextBtn").textContent = "检查答案";
  feedback.className = "feedback";
  feedback.textContent = "听音频，然后逐词输入；按空格切换到下一个词。";
  answerArea.replaceChildren(...words.map((word, index) => makeInput(word, index)));
  requestAnimationFrame(() => answerArea.querySelector("input")?.focus());
  save();
}

function makeInput(word, index) {
  const input = document.createElement("input");
  input.className = "word-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.dataset.answer = word;
  input.setAttribute("aria-label", `第 ${index + 1} 个单词`);
  input.style.setProperty("--letters", Math.min(word.length, 11));
  input.maxLength = word.length + 3;
  input.addEventListener("input", () => {
    input.classList.remove("wrong", "peek");
    if (normalize(input.value) === normalize(word)) input.classList.add("correct");
    else input.classList.remove("correct");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const inputs = [...answerArea.querySelectorAll("input")];
      inputs[index + 1]?.focus();
      if (!inputs[index + 1] && event.key === "Enter") checkAnswer();
    }
    if (event.key === "Backspace" && !input.value && index > 0) {
      answerArea.querySelectorAll("input")[index - 1].focus();
    }
  });
  return input;
}

function speak(isReplay = false) {
  const lesson = lessons[state.index];
  if (lesson.source === "local") {
    playAudioSegment(lesson);
    countReplay(isReplay);
    return;
  }
  if (!("speechSynthesis" in window)) {
    feedback.textContent = "当前浏览器不支持语音朗读，请换用 Chrome 或 Edge。";
    feedback.className = "feedback error";
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(lesson.en);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  utterance.onstart = () => $("#listenBtn").classList.add("speaking");
  utterance.onend = () => $("#listenBtn").classList.remove("speaking");
  speechSynthesis.speak(utterance);
  countReplay(isReplay);
}

function countReplay(isReplay) {
  if (!isReplay) return;
  state.replays += 1;
  $("#replayCount").textContent = state.replays;
}

async function playAudioSegment(lesson) {
  if (!state.audioUrl || !sourceAudio.src) {
    feedback.textContent = "真人音频文件已失效，请重新导入原音频。";
    feedback.className = "feedback error";
    return;
  }
  window.speechSynthesis?.cancel();
  sourceAudio.pause();
  state.clipStart = Math.max(0, lesson.start - audioLeadInSeconds);
  state.clipEnd = sourceAudio.duration
    ? Math.min(sourceAudio.duration, lesson.end + audioTailSeconds)
    : lesson.end + audioTailSeconds;
  sourceAudio.currentTime = state.clipStart;
  try {
    await sourceAudio.play();
    $("#listenBtn").classList.add("speaking");
  } catch {
    feedback.textContent = "浏览器未能播放该音频，请确认文件格式可被 Edge 或 Chrome 识别。";
    feedback.className = "feedback error";
  }
}

sourceAudio.addEventListener("timeupdate", () => {
  if (state.clipEnd && sourceAudio.currentTime >= state.clipEnd) {
    sourceAudio.pause();
    sourceAudio.currentTime = state.clipStart;
    $("#listenBtn").classList.remove("speaking");
  }
});
sourceAudio.addEventListener("pause", () => $("#listenBtn").classList.remove("speaking"));

function timestampToSeconds(timestamp) {
  const parts = timestamp.replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function splitTranscriptText(text) {
  const pieces = text.split(/\s+\|\s+/);
  return {
    en: (pieces.shift() || "").replace(/<[^>]+>/g, "").trim(),
    zh: pieces.join(" | ").trim()
  };
}

function parseTimedTranscript(rawText) {
  const timePattern = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?";
  const timingOnly = new RegExp(`^\\s*(${timePattern})\\s*-->\\s*(${timePattern})\\s*$`);
  const timingWithText = new RegExp(`^\\s*(${timePattern})\\s*-->\\s*(${timePattern})\\s*(?:\\|\\s*)?(.+)$`);
  const normalized = rawText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const entries = [];
  const blocks = normalized.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => timingOnly.test(line));
    if (timingIndex >= 0) {
      const match = lines[timingIndex].match(timingOnly);
      const content = lines.slice(timingIndex + 1).join(" ");
      if (content) entries.push(makeTimedEntry(match[1], match[2], content));
      continue;
    }
    for (const line of lines) {
      const match = line.match(timingWithText);
      if (match) entries.push(makeTimedEntry(match[1], match[2], match[3]));
    }
  }
  return entries.filter((entry) => entry.en && Number.isFinite(entry.start) && entry.end > entry.start);
}

function makeTimedEntry(startText, endText, content) {
  const { en, zh } = splitTranscriptText(content);
  const start = timestampToSeconds(startText);
  const end = timestampToSeconds(endText);
  const timeLabel = `${startText.replace(",", ".")}–${endText.replace(",", ".")}`;
  return {
    en,
    zh: zh || `真人音频听写 · ${timeLabel}`,
    start,
    end,
    source: "local",
    timeLabel
  };
}

function updateImportPreview() {
  const entries = parseTimedTranscript($("#transcriptInput").value);
  const summary = $("#importSummary");
  $("#saveTranscriptBtn").disabled = !$("#audioFile").files[0] || !entries.length;
  summary.className = "import-summary";
  summary.textContent = entries.length
    ? `已识别 ${entries.length} 个有效时间段，选择音频后即可生成。`
    : "选择音频并粘贴原文后即可生成。";
}

function audioFingerprint(file) {
  return file ? `${file.name}::${file.size}::${file.lastModified}` : "";
}

function readTranscriptLibrary() {
  try {
    const value = JSON.parse(localStorage.getItem(transcriptLibraryKey) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeTranscriptLibrary(library) {
  const records = Object.entries(library)
    .sort((a, b) => (b[1].savedAt || "").localeCompare(a[1].savedAt || ""))
    .slice(0, maxSavedTranscripts);
  localStorage.setItem(transcriptLibraryKey, JSON.stringify(Object.fromEntries(records)));
}

function refreshSavedTranscriptPanel(file) {
  const panel = $("#savedTranscriptPanel");
  const record = file ? readTranscriptLibrary()[audioFingerprint(file)] : null;
  panel.hidden = !record;
  if (!record) return;
  const savedDate = new Date(record.savedAt);
  const dateText = Number.isNaN(savedDate.getTime()) ? "此前" : savedDate.toLocaleString("zh-CN");
  $("#savedTranscriptMeta").textContent = `${dateText} 保存 · ${record.segmentCount || parseTimedTranscript(record.transcript).length} 个时间段`;
}

function saveCurrentTranscript() {
  const file = $("#audioFile").files[0];
  const transcript = $("#transcriptInput").value.trim();
  const entries = parseTimedTranscript(transcript);
  const status = $("#transcribeStatus");
  if (!file || !entries.length) return;
  try {
    const library = readTranscriptLibrary();
    library[audioFingerprint(file)] = {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      transcript,
      segmentCount: entries.length,
      model: $("#modelSelect").value,
      selectionCount: $("#selectionCount").value,
      savedAt: new Date().toISOString()
    };
    writeTranscriptLibrary(library);
    refreshSavedTranscriptPanel(file);
    status.className = "transcribe-status success";
    status.textContent = `时间稿已保存在此浏览器中，共 ${entries.length} 个时间段。`;
  } catch {
    status.className = "transcribe-status error";
    status.textContent = "保存失败：浏览器本地存储空间可能已满。";
  }
}

function loadSavedTranscript() {
  const file = $("#audioFile").files[0];
  const record = file ? readTranscriptLibrary()[audioFingerprint(file)] : null;
  if (!record) return;
  $("#transcriptInput").value = record.transcript;
  if ([...$("#modelSelect").options].some((option) => option.value === record.model)) {
    $("#modelSelect").value = record.model;
  }
  if ([...$("#selectionCount").options].some((option) => option.value === String(record.selectionCount))) {
    $("#selectionCount").value = String(record.selectionCount);
  }
  updateImportPreview();
  const status = $("#transcribeStatus");
  status.className = "transcribe-status success";
  status.textContent = `已导入以前保存的时间稿，共 ${record.segmentCount || parseTimedTranscript(record.transcript).length} 个时间段，无需重新识别。`;
}

async function transcribeSelectedAudio() {
  const file = $("#audioFile").files[0];
  const button = $("#transcribeBtn");
  const status = $("#transcribeStatus");
  if (!file) return;

  button.disabled = true;
  button.classList.add("busy");
  $("#transcribeIcon").textContent = "◌";
  $("#transcribeButtonText").textContent = "正在识别，请保持页面打开…";
  status.className = "transcribe-status";
  status.textContent = "首次运行需要下载模型；长音频在 CPU 上可能需要几分钟。";

  const formData = new FormData();
  formData.append("audio", file, file.name);
  formData.append("model", $("#modelSelect").value);
  formData.append("selection_count", $("#selectionCount").value);

  try {
    const response = await fetch("/api/transcribe", { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `识别服务返回错误 ${response.status}`);
    if (!result.segments?.length) throw new Error("没有识别到英文语音，请确认音频内容和音量。 ");

    $("#transcriptInput").value = result.import_text;
    updateImportPreview();
    status.className = "transcribe-status success";
    const selectionText = result.selection_count
      ? `从 ${result.total_segments} 段中精选 ${result.selected_segments} 段`
      : `共识别 ${result.selected_segments} 段`;
    status.textContent = `识别完成：${selectionText}，音频约 ${formatDuration(result.duration)}。请校对后生成听写题。`;
  } catch (error) {
    status.className = "transcribe-status error";
    if (location.protocol === "file:") {
      status.textContent = "自动识别需要通过 start.bat 启动应用，不能直接双击 index.html。";
    } else if (error instanceof TypeError) {
      status.textContent = "无法连接本地识别服务，请关闭窗口后重新运行 start.bat。";
    } else {
      status.textContent = error.message;
    }
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    $("#transcribeIcon").textContent = "✦";
    $("#transcribeButtonText").textContent = "重新识别并生成时间稿";
  }
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`;
}

function generateAudioLessons() {
  const file = $("#audioFile").files[0];
  const entries = parseTimedTranscript($("#transcriptInput").value);
  const summary = $("#importSummary");
  if (!file) {
    summary.className = "import-summary error";
    summary.textContent = "请先选择一个本地音频文件。";
    return;
  }
  if (!entries.length) {
    summary.className = "import-summary error";
    summary.textContent = "没有识别到有效句子，请检查时间格式和英文原文。";
    return;
  }

  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(file);
  sourceAudio.src = state.audioUrl;
  const audioLessons = entries.map((entry) => ({ ...entry, audioName: file.name }));
  lessons.splice(builtInLessonCount, lessons.length - builtInLessonCount, ...audioLessons);
  state.index = builtInLessonCount;
  state.replays = 0;
  summary.className = "import-summary success";
  summary.textContent = `已生成 ${entries.length} 道真人音频听写题。`;
  render();
  $("#importDialog").close();
  sourceAudio.addEventListener("loadedmetadata", () => {
    const invalid = entries.some((entry) => entry.end > sourceAudio.duration + 0.1);
    if (invalid) {
      feedback.textContent = "部分结束时间超出了音频长度，请检查时间码。";
      feedback.className = "feedback error";
    } else {
      speak();
    }
  }, { once: true });
}

async function favoriteCurrentLesson() {
  const lesson = lessons[state.index];
  const key = normalize(lesson.en);
  const button = $("#favoriteBtn");
  button.disabled = true;
  try {
    const response = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        en: lesson.en,
        zh: lesson.zh,
        source: lesson.source === "local" ? lesson.audioName : "内置课程",
        time: lesson.timeLabel || ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "收藏失败。");
    state.favoriteKeys.add(key);
    button.classList.add("saved");
    button.textContent = "★ 已收藏";
    feedback.className = "feedback success";
    feedback.textContent = result.duplicate ? "这条例句已经收藏过了。" : "已收藏到例句.md。";
  } catch (error) {
    feedback.className = "feedback error";
    feedback.textContent = location.protocol === "file:"
      ? "收藏需要通过 start.bat 启动应用。"
      : error.message;
  } finally {
    button.disabled = false;
  }
}

function checkAnswer() {
  if (state.checked) return nextLesson();
  const inputs = [...answerArea.querySelectorAll("input")];
  const wrong = inputs.filter((input) => {
    const ok = normalize(input.value) === normalize(input.dataset.answer);
    input.classList.toggle("correct", ok);
    input.classList.toggle("wrong", !ok);
    return !ok;
  });
  if (wrong.length) {
    feedback.textContent = `还有 ${wrong.length} 个单词需要修改，红线处再听一听。`;
    feedback.className = "feedback error";
    wrong[0].focus();
    return;
  }
  state.checked = true;
  state.correct += 1;
  $("#correctCount").textContent = state.correct;
  feedback.textContent = "全部正确，很棒！";
  feedback.className = "feedback success";
  $("#nextBtn").textContent = state.index === lessons.length - 1 ? "完成练习" : "下一题";
  save();
}

function peek(show = true) {
  clearTimeout(state.peekTimer);
  const inputs = [...answerArea.querySelectorAll("input")];
  if (show) {
    inputs.forEach((input) => {
      if (!input.value) {
        input.value = input.dataset.answer;
        input.classList.add("peek");
      }
    });
    feedback.textContent = "答案只显示 2 秒，记住它哦。";
    state.peekTimer = setTimeout(() => peek(false), 2000);
  } else {
    inputs.forEach((input) => {
      if (input.classList.contains("peek")) input.value = "";
      input.classList.remove("peek");
    });
    feedback.textContent = "继续拼写吧。";
  }
}

function nextLesson() {
  if (state.index === lessons.length - 1) {
    $("#statusText").textContent = "本轮已完成";
    feedback.textContent = `练习完成！本轮答对 ${state.correct} 题。`;
    feedback.className = "feedback success";
    return;
  }
  state.index += 1;
  render();
  speak();
}

function save() {
  // 浏览器刷新后无法继续访问用户选择的本地文件，因此不保存导入题的题号。
  localStorage.setItem("dictation-index", state.index < builtInLessonCount ? state.index : 0);
  localStorage.setItem("dictation-correct", state.correct);
}

$("#listenBtn").addEventListener("click", () => speak());
$("#favoriteBtn").addEventListener("click", favoriteCurrentLesson);
$("#replayBtn").addEventListener("click", () => speak(true));
$("#peekBtn").addEventListener("click", () => peek(true));
$("#nextBtn").addEventListener("click", checkAnswer);
$("#backBtn").addEventListener("click", () => {
  if (state.index > 0) { state.index -= 1; render(); }
});
$("#finishBtn").addEventListener("click", () => {
  feedback.textContent = `已保存进度：第 ${state.index + 1} 题。`;
  feedback.className = "feedback success";
});
$("#fontSize").addEventListener("input", (event) => {
  $("#hintText").style.fontSize = `${event.target.value}px`;
});
$("#importBtn").addEventListener("click", () => $("#importDialog").showModal());
$("#audioFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const nextFingerprint = audioFingerprint(file);
  if (state.currentAudioFingerprint && state.currentAudioFingerprint !== nextFingerprint) {
    $("#transcriptInput").value = "";
  }
  state.currentAudioFingerprint = nextFingerprint || null;
  $("#audioFileName").textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "尚未选择文件";
  $("#transcribeBtn").disabled = !file;
  $("#transcribeButtonText").textContent = "自动识别并生成时间稿";
  $("#transcribeStatus").textContent = file ? "音频已准备好，可以开始本地识别。" : "";
  refreshSavedTranscriptPanel(file);
  updateImportPreview();
});
$("#transcriptInput").addEventListener("input", updateImportPreview);
$("#transcribeBtn").addEventListener("click", transcribeSelectedAudio);
$("#saveTranscriptBtn").addEventListener("click", saveCurrentTranscript);
$("#loadSavedTranscriptBtn").addEventListener("click", loadSavedTranscript);
$("#generateBtn").addEventListener("click", generateAudioLessons);
$("#importForm").addEventListener("submit", (event) => {
  event.preventDefault();
  generateAudioLessons();
});
document.addEventListener("keydown", (event) => {
  if ($("#importDialog").open) return;
  if (event.key === "Tab") { event.preventDefault(); peek(true); }
  if (event.key === "~" || event.key === "`") { event.preventDefault(); speak(true); }
});

render();
