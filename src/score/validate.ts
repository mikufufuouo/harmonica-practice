import type { Fraction } from "./types.ts";

type Dict = Record<string, unknown>;
const isObject = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isFraction = (value: unknown): value is Fraction => isObject(value) && isSafeInteger(value.numerator) && value.numerator >= 0 && isSafeInteger(value.denominator) && value.denominator > 0;
const fractionCompare = (a: Fraction, b: Fraction) => { const left = BigInt(a.numerator) * BigInt(b.denominator); const right = BigInt(b.numerator) * BigInt(a.denominator); return left < right ? -1 : left > right ? 1 : 0; };
const KEYS = new Set(["C", "G", "A", "D", "F", "Bb"]);
const FORMATS = new Set(["bd", "midi", "musicxml", "jianpu", "audio", "image", "native"]);

function validRegion(value: unknown): boolean {
  if (!isObject(value) || !isSafeInteger(value.page) || value.page < 1) return false;
  if (!["x", "y", "width", "height"].every((field) => isFiniteNumber(value[field]))) return false;
  const x = value.x as number, y = value.y as number, width = value.width as number, height = value.height as number;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1;
}
function validSourceRef(value: unknown, sourceIds: Set<string>): boolean {
  if (!isObject(value) || !isNonEmptyString(value.sourceId) || !sourceIds.has(value.sourceId)) return false;
  if (value.token !== undefined && typeof value.token !== "string") return false;
  if ((value.line === undefined) !== (value.column === undefined)) return false;
  if (value.line !== undefined && (!isSafeInteger(value.line) || (value.line as number) < 1 || !isSafeInteger(value.column) || (value.column as number) < 1)) return false;
  return value.region === undefined || validRegion(value.region);
}

function validate(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);
  if (!isObject(value)) return { valid: false, errors: ["sequence must be an object"] };
  if (value.schemaVersion !== 1 || !isNonEmptyString(value.id) || typeof value.title !== "string") fail("invalid sequence header");
  const base = value.timeBase;
  if (base !== "unmetered" && base !== "quarter" && base !== "second") fail("invalid timeBase");
  const tracks = value.tracks, trackIds = new Set<string>();
  if (!Array.isArray(tracks)) fail("tracks must be an array");
  else for (const track of tracks) { if (!isObject(track) || !isNonEmptyString(track.id) || typeof track.name !== "string" || trackIds.has(track.id)) fail("invalid track"); else trackIds.add(track.id); }
  const sources = value.sources, sourceIds = new Set<string>();
  if (!Array.isArray(sources)) fail("sources must be an array");
  else for (const source of sources) {
    if (!isObject(source) || !isNonEmptyString(source.id) || !FORMATS.has(source.format as string) || sourceIds.has(source.id)) { fail("invalid source"); continue; }
    sourceIds.add(source.id);
    if (source.rawText !== undefined && typeof source.rawText !== "string") fail("invalid source rawText");
    if (source.instrument !== undefined && (!isObject(source.instrument) || !KEYS.has(source.instrument.key as string) || source.instrument.layout !== "richter-major")) fail("invalid source instrument");
  }
  const events = value.events, eventIds = new Set<string>(), noteIds = new Set<string>();
  let previousOrder = -1;
  if (!Array.isArray(events)) fail("events must be an array");
  else for (const event of events) {
    if (!isObject(event) || !isNonEmptyString(event.id) || eventIds.has(event.id)) { fail("invalid event id"); continue; }
    eventIds.add(event.id);
    if (!isNonEmptyString(event.trackId) || !trackIds.has(event.trackId) || !isNonEmptyString(event.voiceId) || !isSafeInteger(event.order) || (event.order as number) < 0 || (event.order as number) < previousOrder) fail(`invalid event ${event.id}`);
    if (isSafeInteger(event.order)) previousOrder = event.order;
    if (event.tieGroupId !== undefined && !isNonEmptyString(event.tieGroupId)) fail(`invalid tie group ${event.id}`);
    const time = event.time;
    const timeOk = time === null ? base === "unmetered" : isObject(time) && ((time.unit === "quarter" && base === "quarter" && isFraction(time.start) && (time.duration === null || isFraction(time.duration))) || (time.unit === "second" && base === "second" && isFiniteNumber(time.start) && time.start >= 0 && (time.duration === null || (isFiniteNumber(time.duration) && time.duration >= 0))));
    if (!timeOk) fail(`invalid time ${event.id}`);
    if (event.sourceRef !== undefined && !validSourceRef(event.sourceRef, sourceIds)) fail(`invalid source ref ${event.id}`);
    if (event.kind === "note") { noteIds.add(event.id); const pitch = event.pitch; if (!isObject(pitch) || !isSafeInteger(pitch.midi) || (pitch.midi as number) < 0 || (pitch.midi as number) > 127 || !isFiniteNumber(pitch.cents) || (pitch.spelling !== undefined && typeof pitch.spelling !== "string")) fail(`invalid pitch ${event.id}`); }
    else if (event.kind === "rest") { if ("pitch" in event) fail(`rest has pitch ${event.id}`); }
    else fail(`invalid kind ${event.id}`);
    if (event.confidence !== undefined && (!isFiniteNumber(event.confidence) || event.confidence < 0 || event.confidence > 1)) fail(`invalid confidence ${event.id}`);
  }
  const annotations = value.annotations;
  if (!Array.isArray(annotations)) fail("annotations must be an array");
  else for (const annotation of annotations) if (!isObject(annotation) || !["line-break", "barline", "text"].includes(annotation.kind as string) || (annotation.beforeEventId !== undefined && (!isNonEmptyString(annotation.beforeEventId) || !eventIds.has(annotation.beforeEventId))) || (annotation.text !== undefined && typeof annotation.text !== "string")) fail("invalid annotation");
  const lyrics = value.lyrics, lyricIds = new Set<string>();
  if (!Array.isArray(lyrics)) fail("lyrics must be an array");
  else for (const lyric of lyrics) {
    if (!isObject(lyric) || !isNonEmptyString(lyric.id) || lyricIds.has(lyric.id) || typeof lyric.text !== "string" || !Array.isArray(lyric.eventIds) || !["unassigned", "manual", "imported"].includes(lyric.alignment as string)) { fail("invalid lyric"); continue; }
    lyricIds.add(lyric.id); const refs = new Set<string>();
    for (const id of lyric.eventIds) { if (!isNonEmptyString(id) || refs.has(id) || !noteIds.has(id)) fail("invalid lyric event ref"); refs.add(id); }
    if (lyric.alignment === "unassigned" && lyric.eventIds.length) fail("unassigned lyric references events");
    if (lyric.sourceRef !== undefined && !validSourceRef(lyric.sourceRef, sourceIds)) fail("invalid lyric source ref");
  }
  const tempos = value.tempoMap, meters = value.meterMap;
  if (!Array.isArray(tempos)) fail("tempoMap must be an array"); if (!Array.isArray(meters)) fail("meterMap must be an array");
  if (base !== "quarter" && ((Array.isArray(tempos) && tempos.length) || (Array.isArray(meters) && meters.length))) fail("tempo/meter require quarter time");
  if (Array.isArray(tempos)) { let previous: Fraction | null = null; for (const tempo of tempos) { if (!isObject(tempo) || !isFraction(tempo.at) || !isFiniteNumber(tempo.bpm) || tempo.bpm <= 0) fail("invalid tempo"); else { if (previous && fractionCompare(tempo.at, previous) <= 0) fail("tempoMap must be strictly increasing"); previous = tempo.at; } } }
  if (Array.isArray(meters)) { let previous: Fraction | null = null; for (const meter of meters) { if (!isObject(meter) || !isFraction(meter.at) || !isSafeInteger(meter.beats) || (meter.beats as number) <= 0 || !isSafeInteger(meter.beatType) || (meter.beatType as number) <= 0) fail("invalid meter"); else { if (previous && fractionCompare(meter.at, previous) <= 0) fail("meterMap must be strictly increasing"); previous = meter.at; } } }
  return { valid: errors.length === 0, errors };
}
export function validateNoteSequence(value: unknown): { valid: boolean; errors: string[] } { try { return validate(value); } catch (error) { return { valid: false, errors: [`validator rejected malformed value: ${error instanceof Error ? error.message : "unknown error"}`] }; } }
