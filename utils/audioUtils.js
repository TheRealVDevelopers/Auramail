
/**
 * Decodes a base64 string into a Uint8Array.
 * @param {string} base64 The base64 encoded string.
 * @returns {Uint8Array} The decoded byte array.
 */
export function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM audio data into an AudioBuffer for playback.
 * @param {Uint8Array} data The raw PCM audio data as a Uint8Array.
 * @param {AudioContext} ctx The AudioContext to use for creating the buffer.
 * @param {number} sampleRate The sample rate of the audio (e.g., 24000 for Gemini TTS).
 * @param {number} numChannels The number of audio channels (e.g., 1 for mono).
 * @returns {Promise<AudioBuffer>} A promise that resolves to an AudioBuffer.
 */
export async function decodeAudioData(
  data,
  ctx,
  sampleRate,
  numChannels,
) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
