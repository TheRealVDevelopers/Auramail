// Add type definitions for the Web Speech API to fix TypeScript errors.
// This is necessary because the API is not yet a W3C standard.
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    grammars: any;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onaudioend: ((ev: Event) => any) | null;
    onaudiostart: ((ev: Event) => any) | null;
    onend: ((ev: Event) => any) | null;
    onerror: ((ev: any) => any) | null;
    onnomatch: ((ev: any) => any) | null;
    onresult: ((ev: any) => any) | null;
    onsoundend: ((ev: Event) => any) | null;
    onsoundstart: ((ev: Event) => any) | null;
    onspeechend: ((ev: Event) => any) | null;
    onspeechstart: ((ev: Event) => any) | null;
    onstart: ((ev: Event) => any) | null;
    serviceURI: string;
    abort(): void;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
        responsiveVoice: any;
    }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration, FunctionCall, Modality } from '@google/genai';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { INITIAL_SYSTEM_PROMPT, SUPPORTED_LANGUAGES } from '../constants';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail, markEmailAsRead } from '../services/emailService';
import { useTranslations } from '../utils/translations';

const EmailPreview: React.FC<{ draft: Partial<Email> }> = ({ draft }) => (
    <div className="border border-gray-300 rounded-md p-3 my-1 bg-white text-gray-800">
        <p className="text-xs text-gray-500">PREVIEW</p>
        <div className="mt-2 text-sm space-y-1">
            <p><span className="font-semibold">To:</span> {draft.recipient}</p>
            <p><span className="font-semibold">Subject:</span> {draft.subject}</p>
            <hr className="my-2"/>
            <p className="whitespace-pre-wrap">{draft.body}</p>
        </div>
    </div>
);


const Chatbot: React.FC = () => {
    const aiRef = useRef<GoogleGenAI | null>(null);
    const { state, dispatch } = useAppContext();
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const t = useTranslations();
    const [transcript, setTranscript] = useState<Transcript[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [chatbotStatus, setChatbotStatus] = useState<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
    const [isMuted, setIsMuted] = useState(false);
    const [shouldRestartListening, setShouldRestartListening] = useState(false);
    const [needsUserGesture, setNeedsUserGesture] = useState(true); // Start with need for user gesture
    
    const [composeState, setComposeState] = useState<{
        active: boolean;
        step: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '';
        draft: Partial<Email>;
        fieldToChange: 'recipient' | 'subject' | 'body' | '';
    }>({ active: false, step: '', draft: {}, fieldToChange: '' });
    
    // Refs for async operations and cleanup
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const welcomeSpoken = useRef(false);
    const welcomeMessageShown = useRef(false);
    
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

    const getAiClient = useCallback(() => {
        if (!aiRef.current) {
            // Try multiple sources for API key
            const apiKey = process.env.GEMINI_API_KEY 
                || process.env.API_KEY 
                || (window as any).__GEMINI_API_KEY__ 
                || (window as any).AI_STUDIO_API_KEY;
                
            if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
                throw new Error('Gemini API key not configured');
            }
            aiRef.current = new GoogleGenAI({ apiKey });
        }
        return aiRef.current;
    }, []);

    // Add voice diagnostics function
    const logVoiceDiagnostics = useCallback(() => {
        console.log('[VOICE] === Voice Diagnostics ===');
        
        // Check browser voices
        if ('speechSynthesis' in window) {
            const voices = speechSynthesis.getVoices();
            console.log(`[VOICE] Available browser voices: ${voices.length}`);
            
            // Check for specific language voices
            const hindiVoices = voices.filter(v => v.lang === 'hi-IN');
            const kannadaVoices = voices.filter(v => v.lang === 'kn-IN');
            const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
            
            console.log(`[VOICE] Hindi voices: ${hindiVoices.length}`, hindiVoices.map(v => v.name));
            console.log(`[VOICE] Kannada voices: ${kannadaVoices.length}`, kannadaVoices.map(v => v.name));
            console.log(`[VOICE] English voices: ${englishVoices.length}`, englishVoices.slice(0, 3).map(v => v.name));
            
            // Check for Google voices specifically
            const googleHindiVoices = voices.filter(v => v.lang === 'hi-IN' && v.name.includes('Google'));
            const googleKannadaVoices = voices.filter(v => v.lang === 'kn-IN' && v.name.includes('Google'));
            
            console.log(`[VOICE] Google Hindi voices: ${googleHindiVoices.length}`, googleHindiVoices.map(v => v.name));
            console.log(`[VOICE] Google Kannada voices: ${googleKannadaVoices.length}`, googleKannadaVoices.map(v => v.name));
            
            // If no voices are found, listen for the voiceschanged event
            if (voices.length === 0) {
                console.log('[VOICE] No voices available yet, waiting for voiceschanged event');
                const voicesChangedHandler = () => {
                    console.log('[VOICE] Voices changed event fired');
                    const newVoices = speechSynthesis.getVoices();
                    console.log(`[VOICE] Now available browser voices: ${newVoices.length}`);
                    
                    const newHindiVoices = newVoices.filter(v => v.lang === 'hi-IN');
                    const newKannadaVoices = newVoices.filter(v => v.lang === 'kn-IN');
                    
                    console.log(`[VOICE] Now Hindi voices: ${newHindiVoices.length}`, newHindiVoices.map(v => v.name));
                    console.log(`[VOICE] Now Kannada voices: ${newKannadaVoices.length}`, newKannadaVoices.map(v => v.name));
                    
                    // Remove the event listener
                    speechSynthesis.removeEventListener('voiceschanged', voicesChangedHandler);
                };
                
                speechSynthesis.addEventListener('voiceschanged', voicesChangedHandler);
                
                // Set a timeout to remove the listener if it doesn't fire
                setTimeout(() => {
                    speechSynthesis.removeEventListener('voiceschanged', voicesChangedHandler);
                }, 5000);
            }
        } else {
            console.log('[VOICE] Browser speechSynthesis not supported');
        }
        
        // Check ResponsiveVoice
        const hasResponsiveVoice = typeof (window as any).responsiveVoice !== 'undefined';
        console.log(`[VOICE] ResponsiveVoice available: ${hasResponsiveVoice}`);
        
        if (hasResponsiveVoice) {
            // Check available voices in ResponsiveVoice
            try {
                const responsiveVoices = (window as any).responsiveVoice.getVoices();
                console.log(`[VOICE] ResponsiveVoice voices:`, responsiveVoices);
                
                // Check if specific voices are available
                const hindiFemaleVoice = responsiveVoices.find((v: any) => v.name === 'Hindi Female');
                console.log(`[VOICE] ResponsiveVoice Hindi Female voice available:`, hindiFemaleVoice);
            } catch (error) {
                console.error('[VOICE] Error getting ResponsiveVoice voices:', error);
            }
        }
        
        // Check Puter.js
        const hasPuter = typeof (window as any).puter !== 'undefined';
        console.log(`[VOICE] Puter.js available: ${hasPuter}`);
        
        console.log('[VOICE] === End Voice Diagnostics ===');
    }, []);

    const playBeep = useCallback(() => {
        if (!audioContextRef.current) return;
        const context = audioContextRef.current;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
    }, []);

    const stopSpeaking = useCallback(() => {
        currentAudioSourceRef.current?.stop();
        currentAudioSourceRef.current = null;
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }, []);

    const fallbackSpeak = useCallback((text: string, onComplete?: () => void) => {
        const currentLang = state.currentLanguage;
        console.log(`[TTS] Current language: ${currentLang}, Text:`, text);
        
        // Browser TTS helper function with voice availability check
        const useBrowserTTS = (retryCount = 0) => {
            try {
                speechSynthesis.cancel();
                
                // Check if voices are available
                const voices = speechSynthesis.getVoices();
                if (voices.length === 0 && retryCount < 5) {
                    console.log(`[TTS] No voices available yet, retrying in 500ms (attempt ${retryCount + 1})`);
                    setTimeout(() => useBrowserTTS(retryCount + 1), 500);
                    return;
                }
                
                setTimeout(() => {
                    const utterance = new SpeechSynthesisUtterance(text);
                    
                    // Set language based on current app language
                    if (currentLang === 'hi-IN') {
                        utterance.lang = 'hi-IN';
                        console.log('[TTS] Set utterance language to hi-IN');
                    } else if (currentLang === 'kn-IN') {
                        utterance.lang = 'kn-IN';
                        console.log('[TTS] Set utterance language to kn-IN');
                    } else {
                        utterance.lang = 'en-US';
                        console.log('[TTS] Set utterance language to en-US');
                    }
                    
                    // Try to find a specific voice for the language
                    if (voices.length > 0) {
                        let voice = null;
                        if (currentLang === 'hi-IN') {
                            // Prefer Google Hindi voices
                            voice = voices.find(v => v.lang === 'hi-IN' && v.name.includes('Google')) || 
                                   voices.find(v => v.lang === 'hi-IN');
                        } else if (currentLang === 'kn-IN') {
                            // Prefer Google Kannada voices
                            voice = voices.find(v => v.lang === 'kn-IN' && v.name.includes('Google')) || 
                                   voices.find(v => v.lang === 'kn-IN');
                        } else {
                            // For English, prefer default English voices
                            voice = voices.find(v => v.lang.startsWith('en-') && v.default) || 
                                   voices.find(v => v.lang.startsWith('en-'));
                        }
                        
                        if (voice) {
                            utterance.voice = voice;
                            console.log(`[TTS] Using voice: ${voice.name} (${voice.lang})`);
                        } else {
                            console.log(`[TTS] No specific voice found for ${currentLang}, using default voice`);
                        }
                    }
                    
                    utterance.volume = 1.0;
                    utterance.rate = 0.9;
                    utterance.pitch = 1.0;
                    
                    utterance.onend = () => {
                        console.log("[TTS] Browser TTS completed");
                        onComplete?.();
                    };
                    
                    utterance.onerror = (error) => {
                        console.error("[TTS] Speech synthesis error:", error);
                        onComplete?.();
                    };
                    
                    console.log(`[TTS] Using browser TTS for ${currentLang}:`, text);
                    speechSynthesis.speak(utterance);
                }, 100);
            } catch (error) {
                console.error("[TTS] Failed to use browser TTS:", error);
                onComplete?.();
            }
        };
        
        try {
            // Check if ResponsiveVoice is available
            const hasResponsiveVoice = typeof (window as any).responsiveVoice !== 'undefined';
            console.log(`[TTS] ResponsiveVoice available: ${hasResponsiveVoice}`);
            
            // Use ResponsiveVoice for Hindi and Kannada, browser TTS for English
            if (hasResponsiveVoice && (currentLang === 'hi-IN' || currentLang === 'kn-IN')) {
                // Use ResponsiveVoice for Hindi and Kannada
                console.log(`[TTS] Using ResponsiveVoice for ${currentLang}:`, text);
                
                (window as any).responsiveVoice.cancel(); // Stop any ongoing speech
                
                // Map language to ResponsiveVoice voice name
                // For both Hindi and Kannada, we use 'Hindi Female' as it's optimized for Indian languages
                const voiceName = 'Hindi Female';
                console.log(`[TTS] ResponsiveVoice voice: ${voiceName}`);
                
                // Add a check to see if the voice is supported
                if (typeof (window as any).responsiveVoice.voiceSupport === 'function') {
                    const isVoiceSupported = (window as any).responsiveVoice.voiceSupport(voiceName);
                    console.log(`[TTS] Voice ${voiceName} supported: ${isVoiceSupported}`);
                } else {
                    console.log('[TTS] voiceSupport function not available in ResponsiveVoice');
                }
                
                // Add specific handling for Kannada
                if (currentLang === 'kn-IN') {
                    console.log('[TTS] Special Kannada handling - checking alternative voices');
                    // Try to get a list of available voices
                    if (typeof (window as any).responsiveVoice.getVoices === 'function') {
                        try {
                            const voices = (window as any).responsiveVoice.getVoices();
                            console.log('[TTS] Available ResponsiveVoice voices:', voices);
                            // Look for any voice that might work for Kannada
                            const kannadaVoices = voices.filter((v: any) => 
                                v.name.toLowerCase().includes('hindi') || 
                                v.name.toLowerCase().includes('india') ||
                                v.name.toLowerCase().includes('female')
                            );
                            console.log('[TTS] Potential Kannada voices:', kannadaVoices);
                        } catch (error) {
                            console.error('[TTS] Error getting ResponsiveVoice voices:', error);
                        }
                    }
                }
                
                (window as any).responsiveVoice.speak(text, voiceName, {
                    rate: 0.9,
                    pitch: 1.0,
                    volume: 1.0,
                    onend: () => {
                        console.log("[TTS] ResponsiveVoice TTS completed");
                        onComplete?.();
                    },
                    onerror: (error: any) => {
                        console.error("[TTS] ResponsiveVoice error:", error);
                        // Fallback to browser TTS
                        useBrowserTTS();
                    }
                });
            } else {
                // Use browser's native speech synthesis for English or when ResponsiveVoice unavailable
                console.log(`[TTS] Using browser TTS (language: ${currentLang})`);
                useBrowserTTS();
            }
        } catch (error) {
            console.error("[TTS] Failed to use TTS:", error);
            useBrowserTTS();
        }
    }, [state.currentLanguage]);

    const speak = useCallback(async (text: string | React.ReactNode, onComplete?: () => void, skipTranscript = false) => {
        const textToSpeak = typeof text === 'string' ? text : ' '; // Only speak string content
        
        // Only add to transcript if not skipped
        if (!skipTranscript) {
            setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
        }
        
        stopSpeaking();
        
        const handleEnd = () => {
            setChatbotStatus(isListening ? 'LISTENING' : 'IDLE');
            playBeep();
            onComplete?.();
        };

        if (isMuted || typeof text !== 'string') {
            handleEnd();
            return;
        }

        setChatbotStatus('SPEAKING');

        // Ensure AudioContext is initialized
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            } catch (error) {
                console.error("Failed to initialize AudioContext:", error);
                // Fallback to browser speech synthesis
                fallbackSpeak(textToSpeak, handleEnd);
                return;
            }
        }

        // Use Gemini API for Kannada TTS, ResponsiveVoice for Hindi, browser TTS for English
        const currentLang = state.currentLanguage;
        if (currentLang === 'kn-IN') {
            // Use Gemini API for Kannada
            console.log(`[TTS] Using Gemini API for ${currentLang}:`, textToSpeak);
            try {
                const ai = getAiClient();
                
                // Call Gemini API for TTS
                const response = await ai.models.generateContent({
                    model: "gemini-1.5-flash",
                    contents: [{
                        role: "user",
                        parts: [{
                            text: `Please convert the following text to speech in Kannada language: ${textToSpeak}`
                        }]
                    }],
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Aoede"
                                }
                            }
                        }
                    }
                });

                // Extract audio data from response
                const candidates = response.candidates;
                if (candidates && candidates.length > 0) {
                    const parts = candidates[0].content.parts;
                    if (parts && parts.length > 0) {
                        const inlineData = parts[0].inlineData;
                        if (inlineData && inlineData.data) {
                            // Convert base64 to blob and play
                            const audioData = atob(inlineData.data);
                            const buffer = new ArrayBuffer(audioData.length);
                            const view = new Uint8Array(buffer);
                            for (let i = 0; i < audioData.length; i++) {
                                view[i] = audioData.charCodeAt(i);
                            }
                            
                            const blob = new Blob([view], { type: 'audio/wav' });
                            const url = URL.createObjectURL(blob);
                            const audio = new Audio(url);
                            
                            audio.onended = () => {
                                URL.revokeObjectURL(url);
                                handleEnd();
                            };
                            
                            audio.onerror = (error) => {
                                console.error("[TTS] Audio playback error:", error);
                                URL.revokeObjectURL(url);
                                fallbackSpeak(textToSpeak, handleEnd);
                            };
                            
                            audio.play().catch(error => {
                                console.error("[TTS] Failed to play audio:", error);
                                fallbackSpeak(textToSpeak, handleEnd);
                            });
                            
                            return;
                        }
                    }
                }
                
                console.warn("Gemini TTS did not return audio data, using fallback TTS");
                fallbackSpeak(textToSpeak, handleEnd);
                return;
            } catch (error) {
                console.error("Gemini TTS API error:", error);
                fallbackSpeak(textToSpeak, handleEnd);
                return;
            }
        } else if (currentLang === 'hi-IN') {
            // Use ResponsiveVoice for Hindi
            console.log(`[TTS] Using ResponsiveVoice for ${currentLang}:`, textToSpeak);
            fallbackSpeak(textToSpeak, handleEnd);
            return;
        } else {
            // For English, use browser TTS directly
            console.log("[TTS] Using browser TTS for English");
            fallbackSpeak(textToSpeak, handleEnd);
            return;
        }
    }, [isMuted, isListening, playBeep, stopSpeaking, state.currentLanguage, fallbackSpeak, getAiClient]);

    const functionDeclarations: FunctionDeclaration[] = [
        {
            name: 'open_folder',
            description: 'Opens a specific email folder (Inbox, Sent, Spam, Trash).',
            parameters: {
                type: Type.OBJECT,
                properties: { folder_name: { type: Type.STRING, enum: Object.values(Folder) } },
                required: ['folder_name'],
            },
        },
        {
            name: 'start_interactive_composition',
            description: 'Starts a step-by-step conversational process to compose a new email.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'select_email',
            description: 'Selects an email from the list. The user must provide the ID.',
            parameters: {
                type: Type.OBJECT,
                properties: { email_id: { type: Type.STRING } },
                required: ['email_id'],
            }
        },
        {
            name: 'read_email_by_index',
            description: 'Reads the content of a specific email from the current list aloud, based on its position (e.g., 1 for the first, 2 for the second).',
            parameters: {
                type: Type.OBJECT,
                properties: { index: { type: Type.NUMBER, description: 'The 1-based index of the email in the list.' } },
                required: ['index'],
            },
        },
        {
            name: 'stop_reading',
            description: 'Immediately stops the chatbot from speaking the current message.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'delete_selected_email',
            description: 'Deletes the currently selected email.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'mark_selected_as_spam',
            description: 'Moves the currently selected email to Spam.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'logout',
            description: 'Logs the user out of the application.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'change_language',
            description: 'Changes the application and chatbot language.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    language_code: {
                        type: Type.STRING,
                        description: 'The language code to switch to.',
                        enum: SUPPORTED_LANGUAGES.map(l => l.code),
                    },
                },
                required: ['language_code'],
            },
        },
    ];

    const tools = [{ functionDeclarations }];
    
    const handleFunctionCall = useCallback(async (fc: FunctionCall) => {
        setChatbotStatus('PROCESSING');
        const { name, args } = fc;
        const { userProfile, selectedEmail } = state;
        let resultText = t('done');
        
        switch (name) {
            case 'open_folder': {
                const folder = args.folder_name as Folder;
                if (folder && Object.values(Folder).includes(folder)) {
                    dispatch({ type: 'SELECT_FOLDER', payload: folder });
                    const count = userProfile ? await getUnreadCount(userProfile.uid, folder) : 0;
                    resultText = t('openingFolderUnreadCount', { folder: t(folder.toLowerCase() as keyof ReturnType<typeof useTranslations>), count });
                }
                break;
            }
            case 'start_interactive_composition': {
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                speak(t('composeRecipientPrompt'));
                return ''; // Don't return text to speak, `speak` is called directly
            }
            case 'select_email': {
                if (args.email_id) dispatch({ type: 'SELECT_EMAIL', payload: args.email_id as string });
                break;
            }
            case 'read_email_by_index': {
                const index = args.index as number;
                if (index && index > 0 && state.emails.length >= index) {
                    const emailToRead = state.emails[index - 1];
                    dispatch({ type: 'SELECT_EMAIL', payload: emailToRead.id });
                    if (!emailToRead.read && userProfile) {
                        markEmailAsRead(userProfile.uid, emailToRead.id).catch(err => console.error("Chatbot failed to mark as read:", err));
                        dispatch({ type: 'MARK_AS_READ', payload: emailToRead.id });
                    }
                    const bodyText = emailToRead.body.replace(/<[^>]*>?/gm, '\n');
                    const textToSpeak = `${t('readingEmailFrom', { sender: emailToRead.sender })}. ${t('subject')}: ${emailToRead.subject}. ${t('bodyStartsNow')}. ${bodyText}`;
                    speak(textToSpeak);
                    return '';
                } else {
                    resultText = t('emailNotFoundAtIndex', { index });
                }
                break;
            }
            case 'stop_reading': {
                stopSpeaking();
                setChatbotStatus('IDLE');
                resultText = t('stopped');
                break;
            }
            case 'delete_selected_email': {
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: selectedEmail.id });
                }
                break;
            }
            case 'mark_selected_as_spam': {
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: selectedEmail.id });
                }
                break;
            }
            case 'logout': {
                auth.signOut().catch(error => console.error("Logout from chatbot failed", error));
                resultText = t('signingOut');
                break;
            }
            case 'change_language': {
                const langCode = args.language_code as string;
                const supported = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
                if (supported) {
                    dispatch({ type: 'SET_LANGUAGE', payload: langCode });
                    resultText = t('languageSwitched', { language: supported.name });
                } else {
                    resultText = t('languageNotSupported', { langCode });
                }
                break;
            }
            default:
                console.warn(`Unknown function call: ${name}`);
                resultText = t('functionNotRecognized', { name });
        }

        return resultText;
    }, [dispatch, state, speak, t, stopSpeaking]);

    const handleComposeInput = useCallback(async (text: string) => {
        setTranscript(prev => [...prev, { id: `user-compose-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');
        
        let updatedDraft = { ...composeStateRef.current.draft };
        // FIX: Add explicit types to prevent TS from widening them to `string`.
        let nextStep: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '' = composeStateRef.current.step;
        let nextFieldToChange: 'recipient' | 'subject' | 'body' | '' = composeStateRef.current.fieldToChange;
        let shouldContinue = true;

        switch (composeStateRef.current.step) {
            case 'recipient': {
                let recipientValue = text.trim();
                const lowerText = text.toLowerCase();
                // Only parse as an email if it sounds like one, otherwise preserve original text for usernames
                if (lowerText.includes(' at ') || lowerText.includes(' dot ')) {
                    recipientValue = lowerText.split(' ').map(word => word === 'at' ? '@' : word === 'dot' ? '.' : word).join('');
                }
                updatedDraft.recipient = recipientValue;
                nextStep = 'subject';
                speak(t('composeGotItSubject'));
                break;
            }
            case 'subject':
                updatedDraft.subject = text;
                nextStep = 'body';
                speak(t('composeGreatBody'));
                break;
            case 'body':
                updatedDraft.body = text;
                nextStep = 'confirm';
                setTranscript(prev => [...prev, {
                    id: `ai-preview-${Date.now()}`,
                    text: <EmailPreview draft={updatedDraft} />,
                    isUser: false, timestamp: Date.now(),
                }]);
                speak(t('composePreview'));
                break;
            case 'confirm':
                const lowerText = text.toLowerCase();
                if (lowerText.includes(t('send').toLowerCase())) {
                    if (state.userProfile) {
                        const emailToSend = { 
                            ...updatedDraft, 
                            sender: state.userProfile.name || state.userProfile.email || 'You', 
                            senderEmail: state.userProfile.email || '', 
                            timestamp: new Date().toLocaleString(), 
                            read: true, 
                            folder: Folder.SENT 
                        };
                        const result = await sendEmail(state.userProfile.uid, emailToSend);
                        await speak(result.message);
                        if (result.success) dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
                    }
                    shouldContinue = false;
                } else if (lowerText.includes(t('change').toLowerCase())) {
                    nextStep = 'change_prompt';
                    speak(t('composeChangePrompt'));
                } else { 
                    speak(t('composeCanceled'));
                    shouldContinue = false;
                }
                break;
            case 'change_prompt':
                const changeLowerText = text.toLowerCase();
                if (changeLowerText.includes(t('recipient').toLowerCase())) nextFieldToChange = 'recipient';
                else if (changeLowerText.includes(t('subject').toLowerCase())) nextFieldToChange = 'subject';
                else if (changeLowerText.includes(t('body').toLowerCase())) nextFieldToChange = 'body';

                if (nextFieldToChange) {
                    nextStep = 'change_field';
                    speak(t('composeNewValuePrompt', { field: t(nextFieldToChange) }));
                } else {
                    speak(t('composeDidntUnderstandChange'));
                }
                break;
            case 'change_field':
                const fieldToChange = composeStateRef.current.fieldToChange;
                if (fieldToChange) {
                    let newValue = text;
                    if (fieldToChange === 'recipient') {
                        newValue = text.toLowerCase().split(' ').map(word => word === 'at' ? '@' : word === 'dot' ? '.' : word).join('');
                    }
                    updatedDraft[fieldToChange] = newValue;
                    nextStep = 'confirm';
                    nextFieldToChange = '';
                    setTranscript(prev => [...prev, {
                        id: `ai-preview-updated-${Date.now()}`,
                        text: <EmailPreview draft={updatedDraft} />,
                        isUser: false, timestamp: Date.now(),
                    }]);
                    speak(t('composeUpdatedPreview'));
                }
                break;
        }
        
        // FIX: Explicitly type `newState` to prevent the ternary operator from widening the types of `step` and `fieldToChange` to `string`.
        const newState: typeof composeState = shouldContinue 
            ? { active: true, step: nextStep, draft: updatedDraft, fieldToChange: nextFieldToChange }
            : { active: false, step: '', draft: {}, fieldToChange: '' };
        
        setComposeState(newState);

    }, [state.userProfile, dispatch, speak, t]);

    const processTranscript = useCallback(async (text: string) => {
        if (!text || text.length < 2) return; // Filter noise
        setLiveTranscript('');

        if (composeStateRef.current.active) {
            await handleComposeInput(text);
            return;
        }

        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');

        const lowerText = text.toLowerCase();
        
        // Multilingual keyword-based command matching
        try {
            let response = '';
            let action: (() => void) | null = null;
            
            // Open Inbox commands (English, Hindi, Kannada)
            if (lowerText.match(/inbox|इनबॉक्स|ಇನ್‌ಬಾಕ್ಸ್/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.INBOX });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.INBOX) : 0;
                response = t('openingFolderUnreadCount', { folder: t('inbox'), count });
            }
            // Open Sent commands (English, Hindi, Kannada)
            else if (lowerText.match(/sent|भेजा|sent items|भेजे गए|ಕಳುಹಿಸಲಾಗಿದೆ/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.SENT) : 0;
                response = t('openingFolderUnreadCount', { folder: t('sent'), count });
            }
            // Open Drafts commands (English, Hindi, Kannada)
            else if (lowerText.match(/draft|ड्राफ्ट|ಡ್ರಾಫ್ಟ್/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.DRAFTS });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.DRAFTS) : 0;
                response = t('openingFolderUnreadCount', { folder: t('drafts'), count });
            }
            // Open Spam commands (English, Hindi, Kannada)
            else if (lowerText.match(/spam|junk|स्पैम|ಸ್ಪ್ಯಾಮ್/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.SPAM });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.SPAM) : 0;
                response = t('openingFolderUnreadCount', { folder: t('spam'), count });
            }
            // Open Trash commands (English, Hindi, Kannada)
            else if (lowerText.match(/trash|bin|कचरा|ಕಸದ/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.TRASH });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.TRASH) : 0;
                response = t('openingFolderUnreadCount', { folder: t('trash'), count });
            }
            // Compose email commands (English, Hindi, Kannada)
            else if (lowerText.match(/compose|new email|write|send|नया ईमेल|लिखो|भेजो|ಹೊಸ ಇಮೇಲ್|ಬರೆಯಿರಿ|ಕಳುಹಿಸಿ/)) {
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                response = t('composeRecipientPrompt');
            }
            // Read first email (English, Hindi, Kannada)
            else if (lowerText.match(/read|open|पढ़ो|खोलो|ಓದಿ|�ೆರೆಯಿರಿ/) && lowerText.match(/first|1st|one|1|पहला|पहली|ಮೊದಲ/)) {
                if (state.emails.length >= 1) {
                    const email = state.emails[0];
                    dispatch({ type: 'SELECT_EMAIL', payload: email.id });
                    if (!email.read && state.userProfile) {
                        markEmailAsRead(state.userProfile.uid, email.id);
                        dispatch({ type: 'MARK_AS_READ', payload: email.id });
                    }
                    response = `${t('readingEmailFrom', { sender: email.sender })}. ${t('subject')}: ${email.subject}. ${t('bodyStartsNow')}. ${email.body.replace(/<[^>]*>?/gm, '')}`;
                } else {
                    response = t('emailNotFoundAtIndex', { index: 1 });
                }
            }
            // Read second email (English, Hindi, Kannada)
            else if (lowerText.match(/read|open|पढ़ो|खोलो|ಓದಿ|�ೆರೆಯಿರಿ/) && lowerText.match(/second|2nd|two|2|दूसरा|दूसरी|ಎರಡನೇ/)) {
                if (state.emails.length >= 2) {
                    const email = state.emails[1];
                    dispatch({ type: 'SELECT_EMAIL', payload: email.id });
                    if (!email.read && state.userProfile) {
                        markEmailAsRead(state.userProfile.uid, email.id);
                        dispatch({ type: 'MARK_AS_READ', payload: email.id });
                    }
                    response = `${t('readingEmailFrom', { sender: email.sender })}. ${t('subject')}: ${email.subject}. ${t('bodyStartsNow')}. ${email.body.replace(/<[^>]*>?/gm, '')}`;
                } else {
                    response = t('emailNotFoundAtIndex', { index: 2 });
                }
            }
            // Read third email (English, Hindi, Kannada)
            else if (lowerText.match(/read|open|पढ़ो|खोलो|ಓದಿ|�ೆರೆಯಿರಿ/) && lowerText.match(/third|3rd|three|3|तीसरा|तीसरी|ಮೂರನೇ/)) {
                if (state.emails.length >= 3) {
                    const email = state.emails[2];
                    dispatch({ type: 'SELECT_EMAIL', payload: email.id });
                    if (!email.read && state.userProfile) {
                        markEmailAsRead(state.userProfile.uid, email.id);
                        dispatch({ type: 'MARK_AS_READ', payload: email.id });
                    }
                    response = `${t('readingEmailFrom', { sender: email.sender })}. ${t('subject')}: ${email.subject}. ${t('bodyStartsNow')}. ${email.body.replace(/<[^>]*>?/gm, '')}`;
                } else {
                    response = t('emailNotFoundAtIndex', { index: 3 });
                }
            }
            // Delete email commands (English, Hindi, Kannada)
            else if (lowerText.match(/delete|remove|हटाओ|मिटाओ|ಅಳಿಸಿ/) && state.selectedEmail) {
                if (state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: state.selectedEmail.id });
                    response = state.currentLanguage === 'hi-IN' ? 'ईमेल कचरे में भेज दिया गया।' : 
                               state.currentLanguage === 'kn-IN' ? 'ಇಮೇಲ್ ಅನ್ನು ಕಸದ ಬುಟ್ಟಿಗೆ ಸರಿಸಲಾಗಿದೆ.' : 
                               'Email moved to trash.';
                }
            }
            // Mark as spam commands (English, Hindi, Kannada)
            else if (lowerText.match(/spam|junk|स्पैम|ಸ್ಪ್ಯಾಮ್/) && state.selectedEmail && !lowerText.match(/open|folder/)) {
                if (state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: state.selectedEmail.id });
                    response = state.currentLanguage === 'hi-IN' ? 'ईमेल को स्पैम चिह्नित किया गया।' : 
                               state.currentLanguage === 'kn-IN' ? 'ಇಮೇಲ್ ಅನ್ನು ಸ್ಪ್ಯಾಮ್ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ.' : 
                               'Email marked as spam.';
                }
            }
            // Logout commands (English, Hindi, Kannada)
            else if (lowerText.match(/logout|log out|sign out|बाहर निकलो|लॉग आउट|ಲಾಗ್ ಔಟ್|ಸೈನ್ ಔಟ್/)) {
                response = t('signingOut');
                setTimeout(() => auth.signOut(), 1000);
            }
            // Change to English (any language)
            else if (lowerText.match(/english|अंग्रेजी|ಇಂಗ್ಲಿಷ್/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'en-US' });
                response = 'Language switched to English.';
            }
            // Change to Hindi (any language)
            else if (lowerText.match(/hindi|हिन्दी|हिंदी|ಹಿಂದಿ/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'hi-IN' });
                response = 'भाषा हिन्दी में बदल दी गई है।';
            }
            // Change to Kannada (any language)
            else if (lowerText.match(/kannada|कन्नड़|ಕನ್ನಡ/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'kn-IN' });
                response = 'ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ.';
            }
            // Help command (English, Hindi, Kannada)
            else if (lowerText.match(/help|what can|commands|मदद|सहायता|ಸಹಾಯ/)) {
                response = t('welcomeMessage');
            }
            // Unknown command - respond in current language
            else {
                if (state.currentLanguage === 'hi-IN') {
                    response = "मुझे समझ नहीं आया। कृपया 'इनबॉक्स खोलो', 'पहला ईमेल पढ़ो', 'नया ईमेल लिखो', या 'मदद' कहें।";
                } else if (state.currentLanguage === 'kn-IN') {
                    response = "ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು 'ಇನ್‌ಬಾಕ್ಸ್ ತೆರೆಯಿರಿ', 'ಮೊದಲ ಇಮೇಲ್ ಓದಿ', 'ಹೊಸ ಇಮೇಲ್ ಬರೆಯಿರಿ', ಅಥವಾ 'ಸಹಾಯ' ಎಂದು ಹೇಳಿ.";
                } else {
                    response = "I didn't understand that. Try saying 'open inbox', 'read first email', 'compose email', or 'help'.";
                }
            }

            // Speak the response
            if (response) {
                await speak(response, () => {
                    setShouldRestartListening(true);
                });
            }

        } catch (error) {
            console.error("Command processing error:", error);
            await speak("Sorry, I encountered an error processing your request.", () => {
                setShouldRestartListening(true);
            });
        } finally {
            if (!composeStateRef.current.active) {
                setChatbotStatus('IDLE');
            }
        }
    }, [state.currentFolder, state.emails, state.selectedEmail, state.currentLanguage, state.userProfile, handleComposeInput, speak, dispatch, t]);

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (text) {
            setInputValue('');
            await processTranscript(text);
        }
    };
    
    // Handle user clicking to enable voice - this provides the required user gesture
    const handleEnableVoice = useCallback(() => {
        // Prevent multiple calls
        if (!needsUserGesture) {
            console.log('[ENABLE] Already enabled, ignoring');
            return;
        }
        
        console.log('[ENABLE] User clicked to enable voice');
        setNeedsUserGesture(false);
        
        // Initialize AudioContext
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                console.log('[ENABLE] AudioContext created');
            } catch (error) {
                console.error('[ENABLE] Failed to create AudioContext:', error);
            }
        }
        
        // Resume if suspended
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
                console.log('[ENABLE] AudioContext resumed');
            });
        }
        
        // Log voice diagnostics when enabling voice
        logVoiceDiagnostics();
        
        // Get welcome message - DON'T add to transcript again (already shown)
        const welcomeText = t('welcomeMessage');
        console.log('[ENABLE] Speaking welcome (not adding to transcript):', welcomeText);
        
        // Use speechSynthesis with proper error handling
        try {
            speechSynthesis.cancel(); // Clear any pending
            
            const utterance = new SpeechSynthesisUtterance(welcomeText);
            utterance.volume = 1.0;
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            
            utterance.onstart = () => {
                console.log('[ENABLE] Speech started');
                setChatbotStatus('SPEAKING');
            };
            
            utterance.onend = () => {
                console.log('[ENABLE] Speech ended, playing beep');
                setChatbotStatus('IDLE');
                
                // Play beep
                if (audioContextRef.current) {
                    const context = audioContextRef.current;
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    oscillator.connect(gain);
                    gain.connect(context.destination);
                    oscillator.frequency.value = 880;
                    gain.gain.setValueAtTime(0, context.currentTime);
                    gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.05);
                    gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
                    oscillator.start();
                    oscillator.stop(context.currentTime + 0.2);
                }
                
                // Start listening after beep
                setTimeout(() => {
                    console.log('[ENABLE] Starting voice recording');
                    setShouldRestartListening(true);
                }, 400);
            };
            
            utterance.onerror = (event) => {
                console.error('[ENABLE] Speech error:', event);
                setChatbotStatus('IDLE');
                // Still try to start listening
                setTimeout(() => {
                    setShouldRestartListening(true);
                }, 400);
            };
            
            console.log('[ENABLE] Calling speechSynthesis.speak()');
            speechSynthesis.speak(utterance);
        } catch (error) {
            console.error('[ENABLE] Failed to speak:', error);
            // Fallback: just start listening
            setTimeout(() => {
                setShouldRestartListening(true);
            }, 400);
        }
    }, [t, needsUserGesture, logVoiceDiagnostics]); // Add logVoiceDiagnostics as dependency
    
    const toggleListening = useCallback(() => {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speak("Voice recognition is not supported in this browser.");
            return;
        }

        if (!recognitionRef.current) {
            recognitionRef.current = new SpeechRecognition();
            const recognition = recognitionRef.current;
            recognition.continuous = false;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let interim = '';
                let final = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }
                setLiveTranscript(interim);
                if (final.trim()) {
                    processTranscript(final.trim());
                }
            };
            recognition.onerror = (event) => {
                console.error("Speech recognition error", event.error);
                if(event.error !== 'no-speech') {
                    speak("Sorry, there was a recognition error.");
                }
            };
            recognition.onstart = () => {
                setIsListening(true);
                setChatbotStatus('LISTENING');
            };
            recognition.onend = () => {
                setIsListening(false);
                setChatbotStatus('IDLE');
            };
        }

        recognitionRef.current.lang = state.currentLanguage;
        recognitionRef.current.start();

    }, [isListening, state.currentLanguage, speak, processTranscript]);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, liveTranscript]);
    
    useEffect(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
    }, []);

    // Show welcome message in transcript once - ONLY display, don't speak
    useEffect(() => {
        if (!welcomeMessageShown.current) {
            welcomeMessageShown.current = true;
            console.log('[INIT] Showing welcome message in transcript');
            const welcomeMsg = t('welcomeMessage');
            console.log('[INIT] Welcome message text:', welcomeMsg);
            setTranscript([{ 
                id: `ai-welcome-${Date.now()}`, 
                text: welcomeMsg, 
                isUser: false, 
                timestamp: Date.now() 
            }]);
            
            // Log voice diagnostics on initialization
            logVoiceDiagnostics();
        }
    }, []); // Run once on mount
    
    useEffect(() => {
        return () => { 
            stopSpeaking();
            recognitionRef.current?.stop();
            audioContextRef.current?.close().catch(console.error);
        };
    }, [stopSpeaking]);

    // Auto-restart listening effect
    useEffect(() => {
        if (shouldRestartListening && !isListening && !composeStateRef.current.active) {
            console.log('Auto-restarting voice recording');
            setShouldRestartListening(false);
            // Small delay before restarting to ensure clean state
            const timer = setTimeout(() => {
                toggleListening();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [shouldRestartListening, isListening, toggleListening]);

    const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };
    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    };
    const handleMouseUp = () => setIsDragging(false);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragStart]);
    
    const getStatusInfo = () => {
        switch (chatbotStatus) {
            case 'LISTENING': return { text: 'Active & Listening', icon: <MicIcon className="w-5 h-5 text-red-500 animate-pulse" /> };
            case 'PROCESSING': return { text: 'Thinking...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin" /> };
            case 'SPEAKING': return { text: 'Speaking...', icon: <SpeakerIcon className="w-5 h-5 text-blue-600" /> };
            default: return { text: 'Ready', icon: <MicIcon className="w-5 h-5 text-blue-600" /> };
        }
    };
    const statusInfo = getStatusInfo();


    return (
        <div 
            className="fixed flex flex-col bg-white rounded-lg shadow-2xl border border-gray-200" 
            style={{ left: position.x, top: position.y, width: '400px', height: '500px' }}
            onClick={(e) => {
                // If user needs to enable voice and clicks anywhere (except draggable header), enable it
                if (needsUserGesture && !(e.target as HTMLElement).closest('header')) {
                    console.log('[CLICK] User clicked chatbot, enabling voice');
                    handleEnableVoice();
                }
            }}
        >
            <header 
                className="flex items-center justify-between p-3 bg-gray-100 rounded-t-lg border-b border-gray-200 cursor-move"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center space-x-2">
                    {statusInfo.icon}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-800">VoxMail Assistant</h2>
                        <p className="text-xs text-gray-500">{composeState.active ? `Composing: ${composeState.step}` : statusInfo.text}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsMuted(prev => !prev)} className="p-1 rounded-full hover:bg-gray-200" title={isMuted ? 'Unmute' : 'Mute'}>
                        {isMuted ? <SpeakerOffIcon className="w-5 h-5 text-gray-700" /> : <SpeakerIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={toggleListening} className="p-1 rounded-full hover:bg-gray-200" title={isListening ? 'Stop Listening' : 'Start Listening'}>
                        {isListening ? <PauseIcon className="w-5 h-5 text-red-500" /> : <MicIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-1 rounded-full hover:bg-gray-200 text-gray-700 font-bold text-lg" title="Close">
                        ×
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50 relative">
                {/* Show enable voice overlay if user gesture is needed */}
                {needsUserGesture && (
                    <div className="absolute inset-0 bg-blue-50 bg-opacity-95 flex items-center justify-center z-10 cursor-pointer"
                         onClick={handleEnableVoice}>
                        <div className="text-center p-6">
                            <div className="mb-4">
                                <SpeakerIcon className="w-16 h-16 mx-auto text-blue-600 animate-pulse" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2">🎤 Voice Assistant Ready</h3>
                            <p className="text-sm text-gray-600 mb-4">Click anywhere to start</p>
                            <div className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg animate-bounce">
                                Click to Enable
                            </div>
                        </div>
                    </div>
                )}
                {transcript.map((item) => (
                    <div key={item.id} className={`my-2 flex ${item.isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`px-4 py-2 rounded-lg max-w-xs text-sm ${item.isUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            {item.text}
                        </div>
                    </div>
                ))}
                {liveTranscript && (
                    <div className="my-2 flex justify-end">
                        <div className={`px-4 py-2 rounded-lg max-w-xs text-sm bg-blue-300 text-white opacity-90`}>
                            {liveTranscript}
                        </div>
                    </div>
                )}
                <div ref={transcriptEndRef} />
            </div>
            <form onSubmit={handleTextSubmit} id="chatbot-form" className="p-3 border-t border-gray-200 bg-white rounded-b-lg">
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={isListening ? 'Listening...' : 'Type a message or command...'}
                        className="flex-1 w-full bg-gray-100 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isListening}
                    />
                    <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300">
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;