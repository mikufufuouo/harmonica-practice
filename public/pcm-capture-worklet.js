class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.offset = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let position = 0;
    while (position < channel.length) {
      const count = Math.min(this.buffer.length - this.offset, channel.length - position);
      this.buffer.set(channel.subarray(position, position + count), this.offset);
      this.offset += count; position += count;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
