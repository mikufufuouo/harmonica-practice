import type { Breath, Key } from "../lib/harmonica.ts";

export type Fraction = { numerator: number; denominator: number };
export type Pitch = { midi: number; cents: number; spelling?: string };
export type EventTime =
  | null
  | { unit: "quarter"; start: Fraction; duration: Fraction | null }
  | { unit: "second"; start: number; duration: number | null };
export type SourceRef = {
  sourceId: string;
  line?: number;
  column?: number;
  token?: string;
  region?: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
export type SequenceEvent =
  | {
      id: string;
      trackId: string;
      voiceId: string;
      order: number;
      time: EventTime;
      kind: "note";
      pitch: Pitch;
      tieGroupId?: string;
      sourceRef?: SourceRef;
      confidence?: number;
    }
  | {
      id: string;
      trackId: string;
      voiceId: string;
      order: number;
      time: EventTime;
      kind: "rest";
      tieGroupId?: string;
      sourceRef?: SourceRef;
      confidence?: number;
    };
export type NoteSequence = {
  schemaVersion: 1;
  id: string;
  title: string;
  timeBase: "unmetered" | "quarter" | "second";
  tracks: { id: string; name: string }[];
  events: SequenceEvent[];
  tempoMap: { at: Fraction; bpm: number }[];
  meterMap: { at: Fraction; beats: number; beatType: number }[];
  annotations: {
    kind: "line-break" | "barline" | "text";
    beforeEventId?: string;
    text?: string;
  }[];
  lyrics: {
    id: string;
    text: string;
    eventIds: string[];
    alignment: "unassigned" | "manual" | "imported";
    sourceRef?: SourceRef;
  }[];
  sources: {
    id: string;
    format:
      | "bd"
      | "midi"
      | "musicxml"
      | "jianpu"
      | "audio"
      | "image"
      | "native";
    rawText?: string;
    instrument?: { key: Key; layout: "richter-major" };
  }[];
};
export type ImportDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line: number;
  column: number;
  token: string;
};
export type FingeringCandidate = {
  hole: number;
  breath: Breath;
  label: string;
  technique: "natural";
};
export type FingeringItem = {
  eventId: string;
  status: "mapped" | "ambiguous" | "unplayable" | "rest";
  candidates: FingeringCandidate[];
  preferred?: FingeringCandidate;
  reason?: string;
};
export type FingeringPlan = {
  targetKey: Key;
  transposeSemitones: number;
  items: FingeringItem[];
};
