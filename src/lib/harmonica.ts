export type Breath = "B" | "D";
export type Key = "C" | "G" | "A" | "D" | "F" | "Bb";

// Richter major-diatonic layout. Notes are display context only; capture does not identify them.
const C_LAYOUT: Record<Breath, readonly string[]> = {
  B: ["C4", "E4", "G4", "C5", "E5", "G5", "C6", "E6", "G6", "C7"],
  D: ["D4", "G4", "B4", "D5", "F5", "A5", "B5", "D6", "F6", "A6"],
};

// Standard G/A/Bb harps start below C; low/high variants are deliberately out of scope.
const SEMITONES: Record<Key, number> = {
  C: 0,
  G: -5,
  A: -3,
  D: 2,
  F: 5,
  Bb: -2,
};
const CHROMATIC = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function noteFor(key: Key, hole: number, breath: Breath): string {
  const raw = C_LAYOUT[breath][hole - 1];
  if (!raw) throw new Error(`Invalid hole: ${hole}`);
  const match = /^([A-G])(#?)(\d)$/.exec(raw);
  if (!match) throw new Error(`Unexpected note: ${raw}`);
  const index = CHROMATIC.indexOf(`${match[1]}${match[2]}`);
  const midi = (Number(match[3]) + 1) * 12 + index + SEMITONES[key];
  const octave = Math.floor(midi / 12) - 1;
  const note = CHROMATIC[midi % 12];
  return key === "Bb" && note === "A#"
    ? `Bb${octave}`
    : note === "A#"
      ? `A#${octave}`
      : `${note}${octave}`;
}

export function midiFor(key: Key, hole: number, breath: Breath): number {
  const note = noteFor(key, hole, breath);
  const match = /^([A-G])(#|b)?(\d)$/.exec(note);
  if (!match) throw new Error(`Unexpected note: ${note}`);
  const names: Record<string, number> = {
    C: 0,
    "C#": 1,
    D: 2,
    "D#": 3,
    E: 4,
    F: 5,
    "F#": 6,
    G: 7,
    "G#": 8,
    A: 9,
    "A#": 10,
    B: 11,
    Bb: 10,
  };
  return (Number(match[3]) + 1) * 12 + names[`${match[1]}${match[2] ?? ""}`];
}

export function isConsecutiveHoles(holes: readonly number[]): boolean {
  if (
    holes.length === 0 ||
    holes.some((hole) => !Number.isInteger(hole) || hole < 1 || hole > 10)
  )
    return false;
  const sorted = [...new Set(holes)].sort((a, b) => a - b);
  return (
    sorted.length === holes.length &&
    sorted.every((hole, index) => index === 0 || hole === sorted[index - 1] + 1)
  );
}
