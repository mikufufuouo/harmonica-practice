import "./style.css";
import {
  type Breath,
  type Key,
  isConsecutiveHoles,
  noteFor,
} from "./lib/harmonica.ts";
import { encodeMonoWav } from "./lib/wav.ts";
import { mountScoreImport } from "./score-ui.ts";

type CaptureKind = "single" | "double" | "triple" | "ambient" | "uncertain";
type Intent = {
  label: CaptureKind;
  breath: Breath;
  holes: number[];
  key: Key;
  selectedHole: number;
};
type Take = {
  id: string;
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  createdAt: string;
  intent: Intent;
  trackSettings: MediaTrackSettings;
};
let ctx: AudioContext | null = null,
  stream: MediaStream | null = null,
  source: MediaStreamAudioSourceNode | null = null,
  worklet: AudioWorkletNode | null = null;
let chunks: Float32Array[] = [],
  samplesInTake = 0,
  recording = false,
  selectedHole = 4,
  selectedBreath: Breath = "B",
  latest: Take | null = null;
let playback: HTMLAudioElement | null = null,
  playbackUrl: string | null = null,
  startGeneration = 0,
  takeIntent: Intent | null = null,
  takeSettings: MediaTrackSettings | null = null;
const pageSessionId = crypto.randomUUID();

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main><header><p class="eyebrow">阶段 0A · 本地音频采样实验</p><h1>口琴单音采样实验台</h1><p class="intro">这不是识别器。点选的孔位、B/D 和标签只记录你的意图，供后续验证“单音与串孔”使用。</p></header>
<div id="score-import"></div><section class="panel setup"><div><label>口琴调式 <select id="key"><option>C</option><option>G</option><option>A</option><option>D</option><option>F</option><option>Bb</option></select></label><small>10 孔 Richter；调式与实际琴需由你确认。</small></div><div class="controls"><button id="mic" class="primary">开启麦克风</button><button id="stopMic" disabled>停止麦克风</button></div></section>
<section class="panel"><div class="section-title"><h2>虚拟口琴</h2><span id="choice">意图：4B</span></div><div class="harp" id="harp"></div><p class="hint">点击只是在标记本次采样的目标，绝不代表浏览器已识别出该孔。</p></section>
<section class="grid"><section class="panel"><h2>输入状态</h2><p id="status" role="status">尚未开启麦克风。没有麦克风也可以浏览本页。</p><dl><dt>实际采样率</dt><dd id="rate">—</dd><dt>轨道设置</dt><dd id="settings">—</dd><dt>音量 RMS</dt><dd id="rms">—</dd><dt>削波</dt><dd id="clip">—</dd></dl></section><section class="panel"><h2>采样标签</h2><label>你的判断 <select id="kind"><option value="single">单孔</option><option value="double">相邻双孔</option><option value="triple">相邻三孔</option><option value="ambient">环境声</option><option value="uncertain">不确定</option></select></label><div class="tag-row"><label>B/D <select id="breath"><option>B</option><option>D</option></select></label><label>连续孔 <input id="holes" inputmode="numeric" value="4" /></label></div><small id="holeHelp">仅接受 1–10 的连续孔，例如 4、4,5、4,5,6。</small><div class="controls"><button id="record" class="record" disabled>录制采样（最多 5 秒）</button><button id="finish" disabled>完成本次采样</button><button id="cancel" disabled>取消本次采样</button></div><p id="recording">未录制</p></section></section>
<section class="panel"><h2>最近一次采样（仅内存）</h2><p id="take">尚无录音。不会上传、不会自动保存到设备。</p><div class="controls"><button id="play" disabled>播放</button><button id="wav" disabled>导出 WAV</button><button id="json" disabled>导出 JSON 元数据</button></div><p class="hint">麦克风开启期间不能播放，避免反馈。</p></section></main>`;
const $ = <T extends HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`)!;
const key = $<HTMLSelectElement>("key"),
  mic = $<HTMLButtonElement>("mic"),
  stop = $<HTMLButtonElement>("stopMic"),
  record = $<HTMLButtonElement>("record"),
  finish = $<HTMLButtonElement>("finish"),
  cancel = $<HTMLButtonElement>("cancel"),
  kind = $<HTMLSelectElement>("kind"),
  breath = $<HTMLSelectElement>("breath"),
  holes = $<HTMLInputElement>("holes"),
  help = $("holeHelp"),
  message = $("status"),
  rate = $("rate"),
  settings = $("settings"),
  rms = $("rms"),
  clip = $("clip"),
  recordingText = $("recording"),
  takeText = $("take"),
  play = $<HTMLButtonElement>("play"),
  wav = $<HTMLButtonElement>("wav"),
  json = $<HTMLButtonElement>("json");

function validHoles(): number[] | null {
  const values = holes.value
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number),
    optional = kind.value === "ambient" || kind.value === "uncertain",
    expected = kind.value === "double" ? 2 : kind.value === "triple" ? 3 : 1;
  const valid = optional
    ? values.length === 0 || isConsecutiveHoles(values)
    : isConsecutiveHoles(values) && values.length === expected;
  help.textContent = valid
    ? "标签格式有效；这是你的自报标签，尚未经过算法验证。"
    : `请输入连续的 1–10 孔；当前标签需要 ${expected} 个孔。`;
  record.disabled = !stream || !valid || recording;
  return valid ? values : null;
}
function lockForm(locked: boolean) {
  [key, kind, breath, holes].forEach((input) => (input.disabled = locked));
  document
    .querySelectorAll<HTMLButtonElement>(".hole")
    .forEach((button) => (button.disabled = locked));
}
function renderHarp() {
  const selectedKey = key.value as Key,
    selected = new Set(
      holes.value
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map(Number),
    );
  $("harp").innerHTML = Array.from({ length: 10 }, (_, index) => {
    const hole = index + 1;
    return `<button class="hole ${selected.has(hole) ? "selected" : ""}" data-hole="${hole}"><b>${hole}</b><span>${hole}B</span><em>${noteFor(selectedKey, hole, "B")}</em><span>${hole}D</span><em>${noteFor(selectedKey, hole, "D")}</em></button>`;
  }).join("");
  document.querySelectorAll<HTMLButtonElement>(".hole").forEach(
    (button) =>
      (button.onclick = () => {
        selectedHole = Number(button.dataset.hole);
        holes.value = String(selectedHole);
        validHoles();
        renderHarp();
      }),
  );
  $("choice").textContent =
    `意图：${holes.value || selectedHole}${selectedBreath}`;
}
function showSettings(s: MediaTrackSettings) {
  const flag = (
    name: "echoCancellation" | "noiseSuppression" | "autoGainControl",
  ) =>
    s[name] === undefined
      ? `${name}: unknown`
      : `${name}: ${s[name] ? "开启" : "关闭"}`;
  settings.textContent = [
    flag("echoCancellation"),
    flag("noiseSuppression"),
    flag("autoGainControl"),
    s.channelCount
      ? `channelCount: ${s.channelCount}`
      : "channelCount: unknown",
  ].join(" · ");
}
function stopPlayback() {
  playback?.pause();
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playback = null;
  playbackUrl = null;
}
async function startMic() {
  if (
    stream ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.isSecureContext
  ) {
    message.textContent = !window.isSecureContext
      ? "无法开启：麦克风需要安全上下文（HTTPS；桌面 localhost 例外）。"
      : "此浏览器不支持 getUserMedia。";
    return;
  }
  const generation = ++startGeneration;
  stopPlayback();
  play.disabled = true;
  mic.disabled = true;
  stop.disabled = false;
  message.textContent = "正在请求麦克风权限…";
  let candidate: MediaStream | null = null;
  let candidateContext: AudioContext | null = null;
  try {
    candidate = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    if (generation !== startGeneration) {
      candidate.getTracks().forEach((track) => track.stop());
      return;
    }
    candidateContext = new AudioContext();
    await candidateContext.resume();
    await candidateContext.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}pcm-capture-worklet.js`,
    );
    if (generation !== startGeneration) {
      candidate.getTracks().forEach((track) => track.stop());
      void candidateContext.close();
      return;
    }
    stream = candidate;
    ctx = candidateContext;
    source = candidateContext.createMediaStreamSource(candidate);
    worklet = new AudioWorkletNode(candidateContext, "pcm-capture");
    source.connect(worklet);
    worklet.connect(candidateContext.destination);
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (generation === startGeneration) onPcm(data);
    };
    const actual = candidate.getAudioTracks()[0]?.getSettings() ?? {};
    rate.textContent = `${candidateContext.sampleRate} Hz`;
    showSettings(actual);
    candidate.getAudioTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (generation === startGeneration) stopMic("麦克风轨道已结束。");
      }),
    );
    candidateContext.addEventListener("statechange", () => {
      if (
        generation === startGeneration &&
        candidateContext?.state === "suspended"
      )
        stopMic("音频上下文已暂停。");
    });
    message.textContent = "麦克风已开启，原始单声道 PCM 正在本地采集。";
    validHoles();
  } catch (error) {
    if (candidate && candidate !== stream)
      candidate.getTracks().forEach((track) => track.stop());
    if (candidateContext && candidateContext !== ctx)
      void candidateContext.close();
    if (generation === startGeneration)
      stopMic(
        `无法开启麦克风：${error instanceof DOMException ? error.name : "未知错误"}`,
      );
  }
}
function onPcm(frame: Float32Array) {
  let sum = 0,
    max = 0;
  for (const value of frame) {
    sum += value * value;
    max = Math.max(max, Math.abs(value));
  }
  rms.textContent = Math.sqrt(sum / frame.length).toFixed(4);
  clip.textContent = max >= 0.99 ? "检测到削波" : "未检测到";
  if (!recording || !ctx) return;
  const remaining = 5 * ctx.sampleRate - samplesInTake,
    saved = frame.length > remaining ? frame.slice(0, remaining) : frame;
  if (saved.length) {
    chunks.push(saved);
    samplesInTake += saved.length;
  }
  recordingText.textContent = `录制中：${(samplesInTake / ctx.sampleRate).toFixed(2)} / 5.00 秒`;
  if (samplesInTake >= 5 * ctx.sampleRate) finishTake();
}
function beginTake() {
  const labelledHoles = validHoles();
  if (!stream || !labelledHoles || recording) return;
  chunks = [];
  samplesInTake = 0;
  takeIntent = {
    label: kind.value as CaptureKind,
    breath: breath.value as Breath,
    holes: labelledHoles,
    key: key.value as Key,
    selectedHole,
  };
  takeSettings = stream.getAudioTracks()[0]?.getSettings() ?? {};
  recording = true;
  lockForm(true);
  record.disabled = true;
  finish.disabled = false;
  cancel.disabled = false;
}
function finishTake() {
  if (!recording || !ctx || !takeIntent || !takeSettings) return;
  if (!samplesInTake) {
    recordingText.textContent = "尚未收到 PCM 样本，请继续录制片刻后完成。";
    return;
  }
  recording = false;
  const samples = new Float32Array(samplesInTake);
  let offset = 0;
  chunks.forEach((part) => {
    samples.set(part, offset);
    offset += part.length;
  });
  latest = {
    id: crypto.randomUUID(),
    samples,
    sampleRate: ctx.sampleRate,
    seconds: samplesInTake / ctx.sampleRate,
    createdAt: new Date().toISOString(),
    intent: takeIntent,
    trackSettings: takeSettings,
  };
  recordingText.textContent = `已录制 ${latest.seconds.toFixed(2)} 秒（仅内存）`;
  takeText.textContent = `${{ single: "单孔", double: "相邻双孔", triple: "相邻三孔", ambient: "环境声", uncertain: "不确定" }[latest.intent.label]} · ${latest.intent.holes.join(",")}${latest.intent.breath} · ${latest.seconds.toFixed(2)} 秒`;
  lockForm(false);
  finish.disabled = true;
  cancel.disabled = true;
  wav.disabled = false;
  json.disabled = false;
  play.disabled = Boolean(stream);
  takeIntent = null;
  takeSettings = null;
  validHoles();
}
function cancelTake() {
  if (!recording) return;
  recording = false;
  chunks = [];
  samplesInTake = 0;
  takeIntent = null;
  takeSettings = null;
  lockForm(false);
  finish.disabled = true;
  cancel.disabled = true;
  recordingText.textContent = "本次采样已取消。";
  validHoles();
}
function stopMic(reason = "麦克风已停止并释放设备。") {
  ++startGeneration;
  cancelTake();
  stopPlayback();
  worklet?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  void ctx?.close();
  ctx = null;
  stream = null;
  source = null;
  worklet = null;
  mic.disabled = false;
  stop.disabled = true;
  record.disabled = true;
  finish.disabled = true;
  play.disabled = !latest;
  message.textContent = reason;
  rate.textContent =
    settings.textContent =
    rms.textContent =
    clip.textContent =
      "—";
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportWav() {
  if (latest)
    download(
      encodeMonoWav(latest.samples, latest.sampleRate),
      `harmonica-${latest.id}.wav`,
    );
}
function exportJson() {
  const take = latest;
  if (!take) return;
  const metadata = {
    schemaVersion: 1,
    sessionId: pageSessionId,
    captureId: take.id,
    sampleRate: take.sampleRate,
    seconds: take.seconds,
    createdAt: take.createdAt,
    userIntentUnreviewed: true,
    intent: take.intent,
    displayedNotes: take.intent.holes.map((hole) =>
      noteFor(take.intent.key, hole, take.intent.breath),
    ),
    trackSettings: take.trackSettings,
    harmonicaConfiguration: {
      layout: "10-hole Richter",
      key: take.intent.key,
      userConfirmationRequired: true,
    },
    captureBoundary:
      "AudioWorklet is delivered in 2048-sample batches; start/end may include or omit up to one batch.",
    captureScope: "local-only; no algorithmic recognition",
  };
  download(
    new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
    `harmonica-${take.id}.json`,
  );
}
function playTake() {
  if (!latest || stream) return;
  stopPlayback();
  playbackUrl = URL.createObjectURL(
    encodeMonoWav(latest.samples, latest.sampleRate),
  );
  playback = new Audio(playbackUrl);
  playback.onended = stopPlayback;
  void playback.play();
}
mic.onclick = () => void startMic();
stop.onclick = () => stopMic();
record.onclick = beginTake;
finish.onclick = finishTake;
cancel.onclick = cancelTake;
play.onclick = playTake;
wav.onclick = exportWav;
json.onclick = exportJson;
key.onchange = renderHarp;
breath.onchange = () => {
  selectedBreath = breath.value as Breath;
  renderHarp();
};
kind.onchange = () => {
  validHoles();
  renderHarp();
};
holes.oninput = () => {
  validHoles();
  renderHarp();
};
window.addEventListener("pagehide", () => stopMic());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMic();
});
renderHarp();
validHoles();
mountScoreImport($("score-import"));

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error: unknown) => console.warn("Service Worker registration failed", error));
  });
}
