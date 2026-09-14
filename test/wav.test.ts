import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMonoWav, wavHeaderInfo } from '../src/lib/wav.ts';

test('encodes a mono PCM16 WAV with an accurate header and length', async () => {
  const wav = encodeMonoWav(new Float32Array([0, -1, 1, 0.5]), 48_000);
  const info = wavHeaderInfo(await wav.arrayBuffer());
  assert.deepEqual(info, { sampleRate: 48_000, samples: 4, dataBytes: 8 });
});
