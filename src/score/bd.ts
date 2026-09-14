import { midiFor, type Breath, type Key } from "../lib/harmonica.ts";
import type { ImportDiagnostic, NoteSequence } from "./types.ts";
import { validateNoteSequence } from "./validate.ts";

const normalize = (char: string) => {
  const code = char.codePointAt(0)!;
  if (code >= 0xff10 && code <= 0xff19)
    return String.fromCharCode(code - 0xfee0);
  if (code >= 0xff21 && code <= 0xff3a)
    return String.fromCharCode(code - 0xfee0);
  if (code >= 0xff41 && code <= 0xff5a)
    return String.fromCharCode(code - 0xfee0);
  return { "，": ",", "；": ";", "｜": "|", "　": " " }[char] ?? char;
};
const diagnostic = (
  severity: ImportDiagnostic["severity"],
  code: string,
  message: string,
  line: number,
  column: number,
  token: string,
): ImportDiagnostic => ({ severity, code, message, line, column, token });

export function importBdText(
  text: string,
  options: { sourceKey: Key | null; title?: string },
): { sequence: NoteSequence | null; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  if (!options.sourceKey)
    diagnostics.push(
      diagnostic(
        "error",
        "SOURCE_KEY_REQUIRED",
        "请指定原谱使用的口琴调式。",
        1,
        1,
        "",
      ),
    );
  const sourceId = "bd-source-1",
    events: NoteSequence["events"] = [],
    annotations: NoteSequence["annotations"] = [],
    lyrics: NoteSequence["lyrics"] = [];
  let line = 1,
    column = 1,
    index = 0,
    order = 0,
    pendingLine = false,
    pendingBar = false;
  const addAnnotation = (kind: "line-break" | "barline") => {
    annotations.push({ kind, beforeEventId: `event-${order + 1}` });
  };
  while (index < text.length) {
    const raw = text[index],
      char = normalize(raw);
    if (raw === "\n") {
      pendingLine = true;
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    if (/\s|[,;、]/.test(char)) {
      index += 1;
      column += 1;
      continue;
    }
    if (char === "|") {
      pendingBar = true;
      index += 1;
      column += 1;
      continue;
    }
    const startLine = line,
      startColumn = column,
      startIndex = index;
    if (/\d/.test(char)) {
      let digits = "";
      while (index < text.length && /\d/.test(normalize(text[index]))) {
        digits += normalize(text[index]);
        index += 1;
        column += 1;
      }
      while (
        index < text.length &&
        /\s/.test(normalize(text[index])) &&
        text[index] !== "\n"
      ) {
        index += 1;
        column += 1;
      }
      const letter = normalize(text[index] ?? "");
      if (!/[BDbd]/.test(letter)) {
        diagnostics.push(
          diagnostic(
            "error",
            "INVALID_BD_TOKEN",
            "数字后必须接 B 或 D。",
            startLine,
            startColumn,
            digits + (letter || ""),
          ),
        );
        continue;
      }
      const token = `${digits}${letter.toUpperCase()}`;
      index += 1;
      column += 1;
      if (digits.length > 1 && digits.startsWith("0")) {
        diagnostics.push(
          diagnostic(
            "error",
            "NONSTANDARD_HOLE",
            "孔位不能使用前导零。",
            startLine,
            startColumn,
            token,
          ),
        );
        continue;
      }
      const next = normalize(text[index] ?? "");
      if (/['’\-—\[\]\(\)（）]/.test(next) || /[A-Za-z]/.test(next)) {
        diagnostics.push(
          diagnostic(
            "error",
            "UNSUPPORTED_MUSIC_SYMBOL",
            "压音、延音、和弦括号等尚不支持。",
            startLine,
            startColumn,
            token + next,
          ),
        );
        index += 1;
        column += 1;
        continue;
      }
      const hole = Number(digits);
      if (hole < 1 || hole > 10) {
        diagnostics.push(
          diagnostic(
            "error",
            "HOLE_OUT_OF_RANGE",
            "孔位必须在 1 到 10。",
            startLine,
            startColumn,
            token,
          ),
        );
        continue;
      }
      if (pendingLine) {
        addAnnotation("line-break");
        pendingLine = false;
      }
      if (pendingBar) {
        addAnnotation("barline");
        pendingBar = false;
      }
      const breath = letter.toUpperCase() as Breath;
      events.push({
        id: `event-${++order}`,
        trackId: "track-1",
        voiceId: "voice-1",
        order: order - 1,
        time: null,
        kind: "note",
        pitch: {
          midi: midiFor(options.sourceKey ?? "C", hole, breath),
          cents: 0,
        },
        sourceRef: {
          sourceId,
          line: startLine,
          column: startColumn,
          token: text.slice(startIndex, index),
        },
      });
      continue;
    }
    if (/['’\-—\[\]\(\)（）【】~/.]/.test(char)) {
      diagnostics.push(
        diagnostic(
          "error",
          "UNSUPPORTED_MUSIC_SYMBOL",
          "此音乐符号尚不支持。",
          line,
          column,
          raw,
        ),
      );
      index += 1;
      column += 1;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      let token = "";
      while (index < text.length && /[A-Za-z]/.test(normalize(text[index]))) {
        token += text[index];
        index += 1;
        column += 1;
      }
      diagnostics.push(
        diagnostic(
          /[BDbd]/.test(token) ? "error" : "warning",
          /[BDbd]/.test(token) ? "INVALID_BD_TOKEN" : "UNALIGNED_TEXT",
          /[BDbd]/.test(token)
            ? "疑似不完整 BD 指法。"
            : "未对齐文字已保留为歌词行，尚未对齐音符。",
          startLine,
          startColumn,
          token,
        ),
      );
      lyrics.push({
        id: `lyric-${lyrics.length + 1}`,
        text: token,
        eventIds: [],
        alignment: "unassigned",
        sourceRef: { sourceId, line: startLine, column: startColumn, token },
      });
      continue;
    }
    let token = "";
    while (
      index < text.length &&
      !/\s|[,;、|]/.test(normalize(text[index])) &&
      text[index] !== "\n"
    ) {
      token += text[index];
      index += 1;
      column += 1;
    }
    diagnostics.push(
      diagnostic(
        /[\dBDbd]|[^\u4e00-\u9fff\s，、。！？,.!?]/.test(token)
          ? "error"
          : "warning",
        /[\dBDbd]|[^\u4e00-\u9fff\s，、。！？,.!?]/.test(token)
          ? "UNSUPPORTED_TOKEN"
          : "UNALIGNED_TEXT",
        /[\dBDbd]|[^\u4e00-\u9fff\s，、。！？,.!?]/.test(token)
          ? "未支持的谱面符号或疑似 BD 指法。"
          : "未对齐文字已保留为歌词行，尚未对齐音符。",
        startLine,
        startColumn,
        token,
      ),
    );
    lyrics.push({
      id: `lyric-${lyrics.length + 1}`,
      text: token,
      eventIds: [],
      alignment: "unassigned",
      sourceRef: { sourceId, line: startLine, column: startColumn, token },
    });
  }
  if (!events.length)
    diagnostics.push(
      diagnostic("error", "NO_NOTES", "没有找到可导入的 BD 音符。", 1, 1, ""),
    );
  // Keep one unaligned lyric line per source line. BD tokens are removed while
  // punctuation and all internal whitespace remain available for later review.
  lyrics.length = 0;
  text.split("\n").forEach((rawLine, lineIndex) => {
    const remaining = rawLine.replace(/[０-９\d]+[ \t　]*[ＢＤｂｄBDbd]/g, "");
    if (!remaining.trim() || /^[\s,，;；、|｜]+$/.test(remaining)) return;
    lyrics.push({
      id: `lyric-${lyrics.length + 1}`,
      text: remaining,
      eventIds: [],
      alignment: "unassigned",
      sourceRef: {
        sourceId,
        line: lineIndex + 1,
        column: 1,
        token: rawLine,
      },
    });
  });
  if (diagnostics.some((item) => item.severity === "error"))
    return { sequence: null, diagnostics };
  const sequence: NoteSequence = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: options.title ?? "未命名 BD 谱",
    timeBase: "unmetered",
    tracks: [{ id: "track-1", name: "主旋律" }],
    events,
    tempoMap: [],
    meterMap: [],
    annotations,
    lyrics,
    sources: [
      {
        id: sourceId,
        format: "bd",
        rawText: text,
        instrument: { key: options.sourceKey!, layout: "richter-major" },
      },
    ],
  };
  const validation = validateNoteSequence(sequence);
  if (!validation.valid)
    return {
      sequence: null,
      diagnostics: [
        ...diagnostics,
        ...validation.errors.map((message) =>
          diagnostic("error", "INVALID_SEQUENCE", message, 1, 1, ""),
        ),
      ],
    };
  return { sequence, diagnostics };
}
