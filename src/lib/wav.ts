export function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

export function wavHeaderInfo(buffer: ArrayBuffer): { sampleRate: number; samples: number; dataBytes: number } {
  const view = new DataView(buffer);
  const text = (at: number, length: number) => String.fromCharCode(...new Uint8Array(buffer, at, length));
  if (buffer.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(36, 4) !== 'data') throw new Error('Not a simple PCM WAV');
  const dataBytes = view.getUint32(40, true);
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16 || dataBytes + 44 !== buffer.byteLength) throw new Error('Unexpected WAV format');
  return { sampleRate: view.getUint32(24, true), samples: dataBytes / 2, dataBytes };
}
