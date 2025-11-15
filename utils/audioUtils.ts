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

    if (!text || text.trim().length === 0) {
        console.warn('[TTS] Empty text provided, skipping speech');
        onComplete?.();
        return;
    }

    const availableVoices = voices.length > 0 ? voices : await waitForVoices();

    // Wait a bit to ensure any previous speech is fully cancelled
    await new Promise(resolve => setTimeout(resolve, 100));

    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = lang; // always set requested language
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const selectedVoice = selectVoiceForLang(availableVoices, lang);
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`[TTS] Using voice: ${selectedVoice.name} (${selectedVoice.lang}) for ${lang}`);
    } else {
        // Keep lang on utterance to force the browser to choose a compatible voice if possible.
        console.warn(`[TTS] No dedicated voice found for ${lang}. Falling back to browser selection with utterance.lang=${lang}.`);
    }

    let isCompleted = false;
    const complete = () => {
        if (isCompleted) return;
        isCompleted = true;
        console.log(`[TTS] Finished speaking in ${lang}`);
        onComplete?.();
    };

    utterance.onend = (event) => {
        console.log(`[TTS] Speech ended normally`);
        complete();
    };

    utterance.onerror = (event) => {
        // Don't treat 'interrupted' as a fatal error - it just means speech was cancelled
        if (event.error === 'interrupted') {
            console.log('[TTS] Speech was interrupted (cancelled)');
            complete();
        } else {
            console.error('[TTS] SpeechSynthesisUtterance error:', event.error, event);
            complete();
        }
    };

    try {
        // Cancel any ongoing speech first, but wait for it to fully stop
        if (speechSynthesis.speaking || speechSynthesis.pending) {
            speechSynthesis.cancel();
            // Give it a moment to fully cancel
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // Attempt to speak
        speechSynthesis.speak(utterance);
        console.log(`[TTS] Started speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        // Autoplay watchdog: if not actually speaking shortly after, retry on first gesture
        const checkDelay = 800;
        let retryAttached = false;
        const retryOnGesture = () => {
            if (isCompleted) return;
            try {
                // Only retry if speech hasn't started
                if (!speechSynthesis.speaking && !speechSynthesis.pending) {
                    console.log('[TTS] Retrying speech on user gesture');
                    speechSynthesis.cancel();
                    // Create a new utterance for retry
                    const retryUtterance = new SpeechSynthesisUtterance(text.trim());
                    retryUtterance.lang = lang;
                    retryUtterance.rate = 1.0;
                    retryUtterance.pitch = 1.0;
                    retryUtterance.volume = 1.0;
                    if (selectedVoice) {
                        retryUtterance.voice = selectedVoice;
                    }
                    retryUtterance.onend = () => complete();
                    retryUtterance.onerror = (e) => {
                        if (e.error !== 'interrupted') {
                            console.error('[TTS] Retry error:', e.error);
                        }
                        complete();
                    };
                    speechSynthesis.speak(retryUtterance);
                }
            } catch (e) {
                console.warn('[TTS] Gesture retry failed:', e);
            } finally {
                if (retryAttached) {
                    window.removeEventListener('pointerdown', retryOnGesture, true);
                    window.removeEventListener('touchstart', retryOnGesture, true);
                    window.removeEventListener('keydown', retryOnGesture, true);
                    window.removeEventListener('click', retryOnGesture, true);
                }
            }
        };

        window.setTimeout(() => {
            const blocked = !speechSynthesis.speaking && !speechSynthesis.pending && !isCompleted;
            if (blocked && !retryAttached) {
                retryAttached = true;
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
        complete();
    }
};