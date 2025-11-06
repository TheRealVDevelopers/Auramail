// This file is reserved for audio utility functions.

// A cache to hold the voices once they are loaded.
let voices: SpeechSynthesisVoice[] = [];

// Wait for voices to be available across browsers reliably
const waitForVoices = (): Promise<SpeechSynthesisVoice[]> => {
    return new Promise((resolve) => {
        const tryLoad = () => {
            const list = window.speechSynthesis.getVoices();
            if (list && list.length > 0) {
                voices = list;
                resolve(list);
                return true;
            }
            return false;
        };

        if (tryLoad()) return; // already loaded

        // Some browsers fire onvoiceschanged later
        const handler = () => {
            if (tryLoad()) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
        window.speechSynthesis.onvoiceschanged = handler;

        // Fallback timeout in case the event never fires
        setTimeout(() => {
            if (!tryLoad()) {
                console.warn('[TTS] Voices did not load in time; proceeding with whatever is available.');
                resolve(voices);
            }
        }, 2000);
    });
};

const normalizeLang = (lang: string) => lang.toLowerCase();

// Heuristic selector that strictly matches language first, then base language.
const selectVoiceForLang = (list: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined => {
    if (!list || list.length === 0) return undefined;
    const langLower = normalizeLang(lang);
    const base = langLower.split('-')[0];

    const byExactLang = list.filter(v => normalizeLang(v.lang) === langLower);
    const byBaseLang = list.filter(v => normalizeLang(v.lang).startsWith(base));

    // Prefer engines: Google > Microsoft > Natural/Neural > others
    const sortByPreference = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) => {
        const rank = (name: string) => {
            const n = name.toLowerCase();
            if (n.includes('google')) return 5;
            if (n.includes('microsoft')) return 4;
            if (n.includes('natural') || n.includes('neural') || n.includes('online')) return 3;
            return 1;
        };
        return rank(b.name) - rank(a.name);
    };

    if (byExactLang.length > 0) {
        return byExactLang.sort(sortByPreference)[0];
    }

    if (byBaseLang.length > 0) {
        // Also try names that explicitly mention the language in English/local script
        const languageNameHints: Record<string, RegExp> = {
            en: /(english|en\b|us|uk|india)/i,
            hi: /(hindi|हिंदी|हिन्दी|hi\b|india)/i,
            ta: /(tamil|தமிழ்|ta\b|india)/i,
        };
        const hint = languageNameHints[base];
        const hinted = hint ? byBaseLang.filter(v => hint.test(v.name)) : [];
        if (hinted.length > 0) return hinted.sort(sortByPreference)[0];
        return byBaseLang.sort(sortByPreference)[0];
    }

    // Never cross language families; return undefined to let browser pick by utterance.lang
    return undefined;
};

export const speakWithBrowserTTS = async (text: string, lang: string, onComplete?: () => void) => {
    if (!('speechSynthesis' in window)) {
        console.error('[TTS] Browser speechSynthesis not supported.');
        onComplete?.();
        return;
    }

    const availableVoices = voices.length > 0 ? voices : await waitForVoices();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang; // always set requested language
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const selectedVoice = selectVoiceForLang(availableVoices, lang);
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`[TTS] Using voice: ${selectedVoice.name} (${selectedVoice.lang}) for ${lang}`);
    } else {
        // Keep lang on utterance to force the browser to choose a compatible voice if possible.
        console.warn(`[TTS] No dedicated voice found for ${lang}. Falling back to browser selection with utterance.lang=${lang}.`);
    }

    utterance.onend = () => {
        console.log(`[TTS] Finished speaking in ${lang}`);
        onComplete?.();
    };

    utterance.onerror = (event) => {
        console.error('[TTS] SpeechSynthesisUtterance error:', event);
        onComplete?.();
    };

    try {
        // Clear any queued or stuck utterances first
        if (speechSynthesis.speaking || speechSynthesis.pending) {
            speechSynthesis.cancel();
        }
        // Attempt to speak
        speechSynthesis.speak(utterance);

        // Autoplay watchdog: if not actually speaking shortly after, retry on first gesture
        const checkDelay = 800;
        const retryOnGesture = () => {
            try {
                // Cancel any remnants and retry speak
                speechSynthesis.cancel();
                // Some browsers require resume before speak
                if (speechSynthesis.paused) {
                    speechSynthesis.resume();
                }
                speechSynthesis.speak(utterance);
            } catch (e) {
                console.warn('[TTS] Gesture retry failed:', e);
            } finally {
                window.removeEventListener('pointerdown', retryOnGesture, true);
                window.removeEventListener('touchstart', retryOnGesture, true);
                window.removeEventListener('keydown', retryOnGesture, true);
                window.removeEventListener('click', retryOnGesture, true);
            }
        };

        window.setTimeout(() => {
            const blocked = !speechSynthesis.speaking && !speechSynthesis.pending;
            if (blocked) {
                // Attach one-time gesture listeners to trigger speak
                window.addEventListener('pointerdown', retryOnGesture, true);
                window.addEventListener('touchstart', retryOnGesture, true);
                window.addEventListener('keydown', retryOnGesture, true);
                window.addEventListener('click', retryOnGesture, true);
                console.warn('[TTS] Likely blocked by autoplay. Will retry on first user gesture.');
            }
        }, checkDelay);
    } catch (e) {
        console.error('[TTS] Failed to initiate speech:', e);
        onComplete?.();
    }
};