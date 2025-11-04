// This file is reserved for audio utility functions.

// A variable to hold the voices once they are loaded.
let voices: SpeechSynthesisVoice[] = [];

// A promise that resolves when the voices are loaded.
const voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (voices.length > 0) {
        return resolve(voices);
    }
    speechSynthesis.onvoiceschanged = () => {
        voices = speechSynthesis.getVoices();
        resolve(voices);
    };
    // In some browsers, onvoiceschanged is not fired, so we check manually.
    voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
        resolve(voices);
    }
});

export const speakWithBrowserTTS = async (text: string, lang: string, onComplete?: () => void) => {
    if (!('speechSynthesis' in window)) {
        console.error('[TTS] Browser speechSynthesis not supported.');
        onComplete?.();
        return;
    }

    const availableVoices = await voicesPromise;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Find a suitable voice
    let selectedVoice = availableVoices.find(v => v.lang === lang && v.name.includes('Google'));
    if (!selectedVoice) {
        selectedVoice = availableVoices.find(v => v.lang === lang);
    }
    
    // For Tamil, try to find any voice that supports it
    if (lang === 'ta-IN' && !selectedVoice) {
        // Try to find any Tamil voice, even with different locale
        selectedVoice = availableVoices.find(v => v.lang.startsWith('ta'));
        console.log(`[TTS] Found Tamil voice with different locale: ${selectedVoice?.name}`);
    }
    
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`[TTS] Using voice: ${selectedVoice.name} for language: ${lang}`);
    } else {
        console.warn(`[TTS] No voice found for lang: ${lang}. Using browser default.`);
        // Even without a specific voice, the browser might still be able to synthesize
        // Set the language on the utterance so the browser can try its best
        utterance.lang = lang;
    }

    utterance.onend = () => {
        console.log(`[TTS] Finished speaking in ${lang}`);
        onComplete?.();
    };

    utterance.onerror = (event) => {
        console.error('[TTS] SpeechSynthesisUtterance error:', event);
        onComplete?.();
    };

    speechSynthesis.speak(utterance);
};