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
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { INITIAL_SYSTEM_PROMPT, SUPPORTED_LANGUAGES } from '../constants';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail, markEmailAsRead } from '../services/emailService';
import { speakWithBrowserTTS } from '../utils/audioUtils';
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

type ChatbotStatus = 'IDLE' | 'SPEAKING' | 'LISTENING' | 'PROCESSING' | 'AWAITING_USER_GESTURE';

const Chatbot: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const t = useTranslations();
    const [transcript, setTranscript] = useState<Transcript[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [chatbotStatus, setChatbotStatus] = useState<ChatbotStatus>('AWAITING_USER_GESTURE');
    const [isMuted, setIsMuted] = useState(false);
    
    const [composeState, setComposeState] = useState<{
        active: boolean;
        step: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '';
        draft: Partial<Email>;
        fieldToChange: 'recipient' | 'subject' | 'body' | '';
    }>({ active: false, step: '', draft: {}, fieldToChange: '' });
    
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const hasSpokenWelcomeRef = useRef(false); // To ensure welcome message is spoken only once per session

    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

    // --- VUI Core Functions ---

    const initAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                console.log('[AUDIO] AudioContext created.');
            } catch (error) {
                console.error('[AUDIO] Failed to create AudioContext:', error);
                return;
            }
        }
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume().catch(err => console.error('[AUDIO] Failed to resume AudioContext:', err));
        }
    }, []);

    const playBeep = useCallback((type: 'start' | 'end' = 'start') => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            console.warn('[BEEP] AudioContext not available or closed, cannot play beep.');
            return;
        }
        const context = audioContextRef.current;

        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.frequency.value = type === 'start' ? 880 : 660;
        oscillator.type = 'sine';

        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
    }, []);

    // Refs for functions to handle circular dependencies
    const startSpeakingRef = useRef<((text: string, onComplete?: () => void) => Promise<void>)>(async () => {});
    const startListeningRef = useRef<(() => void)>(() => {});
    const stopListeningRef = useRef<(() => void)>(() => {});
    const stopSpeakingRef = useRef<(() => void)>(() => {});
    const processUserSpeechRef = useRef<((text: string) => Promise<void>)>(async () => {});

    const stopSpeaking = useCallback(() => {
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
        if (chatbotStatus === 'SPEAKING') {
            setChatbotStatus('IDLE');
        }
    }, [chatbotStatus]);

    const startSpeaking = useCallback(async (text: string, onComplete?: () => void) => {
        if (isMuted) {
            onComplete?.();
            return;
        }

        stopSpeakingRef.current(); // Stop any ongoing speech
        setChatbotStatus('SPEAKING');

        // Add to transcript
        setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);

        // Ensure AudioContext is initialized and resumed for beep sounds
        initAudioContext();

        speakWithBrowserTTS(text, state.currentLanguage, () => {
            console.log('[TTS] Finished speaking.');
            // After speaking, wait 2 seconds, play end beep, then start listening
            setTimeout(() => {
                playBeep('end');
                setTimeout(() => {
                    if (!composeStateRef.current.active) { // Only restart listening if not in compose mode
                        startListeningRef.current();
                    } else {
                        setChatbotStatus('IDLE'); // If in compose mode, go idle
                    }
                }, 1000); // 1 second after beep
            }, 2000); // 2 seconds after speaking
            onComplete?.();
        });
    }, [isMuted, state.currentLanguage, playBeep, initAudioContext]);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        if (chatbotStatus === 'LISTENING') {
            setChatbotStatus('IDLE');
        }
    }, [chatbotStatus]);

    const startListening = useCallback(() => {
        if (chatbotStatus === 'LISTENING') {
            console.log('[STT] Already listening.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            startSpeakingRef.current("Voice recognition is not supported in this browser.");
            return;
        }

        initAudioContext(); // Ensure AudioContext is ready for beep

        if (!recognitionRef.current) {
            recognitionRef.current = new SpeechRecognition();
            const recognition = recognitionRef.current;
            recognition.continuous = false;
            recognition.interimResults = true; // Get interim results for silence detection
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                // Reset silence timer on speech activity
                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                }
                silenceTimerRef.current = setTimeout(() => {
                    console.log('[STT] Silence detected, stopping recognition.');
                    recognition.stop(); // Stop recognition after 3-5 seconds of silence
                    playBeep('end'); // Play cut down sound
                }, 4000); // 4 seconds of silence (average of 3-5)

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
                    console.log('[STT] Final transcript received, processing:', final.trim());
                    processUserSpeechRef.current(final.trim());
                }
            };

            recognition.onerror = (event) => {
                console.error("Speech recognition error", event.error);
                setChatbotStatus('IDLE');
                if (event.error !== 'no-speech') {
                    startSpeakingRef.current("Sorry, there was a recognition error. Please try again.", () => {
                        // After error message, restart listening
                        setTimeout(() => {
                            if (!composeStateRef.current.active) startListeningRef.current();
                        }, 1000);
                    });
                } else {
                    // If no speech, just restart listening after a short delay
                    setTimeout(() => {
                        if (!composeStateRef.current.active) startListeningRef.current();
                    }, 1000);
                }
            };

            recognition.onstart = () => {
                console.log('[STT] Recognition started.');
                setChatbotStatus('LISTENING');
                // Start initial silence timer
                silenceTimerRef.current = setTimeout(() => {
                    console.log('[STT] Initial silence timer started.');
                    recognition.stop();
                    playBeep('end'); // Play cut down sound
                }, 4000); // 4 seconds of silence
            };

            recognition.onend = () => {
                console.log('[STT] Recognition ended.');
                setChatbotStatus('IDLE');
                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
                // If not composing and not currently speaking, restart listening after a short delay
                // This handles cases where recognition ends naturally (e.g., user stopped speaking)
                if (!composeStateRef.current.active && chatbotStatus !== 'SPEAKING') {
                    setTimeout(() => startListeningRef.current(), 1000);
                }
            };
        }

        recognitionRef.current.lang = state.currentLanguage;
        console.log(`[STT] Setting recognition language to: ${state.currentLanguage}`);
        recognitionRef.current.start();
        playBeep('start'); // Play beep when mic turns on
    }, [chatbotStatus, state.currentLanguage, playBeep, initAudioContext]);

    const processUserSpeech = useCallback(async (text: string) => {
        if (!text || text.length < 2) {
            if (!composeStateRef.current.active) {
                startSpeakingRef.current(t('didntUnderstand'), () => {
                    setTimeout(() => startListeningRef.current(), 1000);
                });
            }
            return;
        }
        setLiveTranscript(''); // Clear live transcript once final speech is processed
        setChatbotStatus('PROCESSING');

        // Add user's speech to transcript
        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);

        // --- Chatbot Logic ---
        let aiResponse = '';
        const lowerText = text.toLowerCase();

        if (composeStateRef.current.active) {
            // Handle email composition steps
            // This logic needs to be re-implemented based on the original handleComposeInput
            aiResponse = "Email composition is not yet fully re-implemented in this new chatbot version.";
        } else if (lowerText.includes(t('help').toLowerCase())) {
            aiResponse = t('welcomeMessage');
        } else if (lowerText.includes(t('inbox').toLowerCase())) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.INBOX });
            aiResponse = t('openingFolderUnreadCount', { folder: t('inbox'), count: 0 }); // Placeholder count
        } else if (lowerText.includes(t('compose').toLowerCase())) {
            setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
            aiResponse = t('composeRecipientPrompt');
        } else if (lowerText.includes(t('logout').toLowerCase())) {
            aiResponse = t('signingOut');
            setTimeout(() => auth.signOut(), 1000);
        } else if (lowerText.match(/english|switch to english|change to english|அங்கிலம்/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'en-US' });
            aiResponse = 'Language switched to English.';
        } else if (lowerText.match(/hindi|switch to hindi|change to hindi|हिन्दी|हिंदी/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'hi-IN' });
            aiResponse = 'भाषा हिन्दी में बदल दी गई है।';
        } else if (lowerText.match(/tamil|switch to tamil|change to tamil|தமிழ்/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'ta-IN' });
            aiResponse = 'மொழி தமிழுக்கு மாற்றப்பட்டது.';
        }
        else {
            aiResponse = t('didntUnderstand');
        }

        startSpeakingRef.current(aiResponse); // startSpeaking will handle the post-speaking flow
    }, [dispatch, t]);

    // --- Effects ---

    // Assign functions to refs after they are stable
    useEffect(() => { stopSpeakingRef.current = stopSpeaking; }, [stopSpeaking]);
    useEffect(() => { startSpeakingRef.current = startSpeaking; }, [startSpeaking]);
    useEffect(() => { stopListeningRef.current = stopListening; }, [stopListening]);
    useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
    useEffect(() => { processUserSpeechRef.current = processUserSpeech; }, [processUserSpeech]);

    // Initial setup and welcome message
    useEffect(() => {
        if (!hasSpokenWelcomeRef.current && state.isChatbotOpen) {
            hasSpokenWelcomeRef.current = true;
            console.log('[INIT] Speaking welcome message.');
            startSpeakingRef.current(t('welcomeMessage'));
        }
    }, [state.isChatbotOpen, t]);

    // Scroll to bottom of transcript
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, liveTranscript]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => { 
            stopSpeakingRef.current();
            stopListeningRef.current();
        };
    }, []);

    // --- UI Handlers ---

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (text) {
            setInputValue('');
            processUserSpeechRef.current(text);
        }
    };
    
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
        if (chatbotStatus === 'SPEAKING') return { text: 'Speaking...', icon: <SpeakerIcon className="w-5 h-5 text-blue-600" /> };
        if (chatbotStatus === 'LISTENING') return { text: 'Listening...', icon: <MicIcon className="w-5 h-5 text-red-500 animate-pulse" /> };
        if (chatbotStatus === 'PROCESSING') return { text: 'Thinking...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin" /> };
        return { text: 'Ready', icon: <MicIcon className="w-5 h-5 text-blue-600" /> };
    };
    const statusInfo = getStatusInfo();


    return (
        <div 
            className="fixed flex flex-col bg-white rounded-xl shadow-2xl border-2 border-blue-500" 
            style={{ left: position.x, top: position.y, width: '400px', height: '500px' }}
            onClick={initAudioContext} // User gesture to enable AudioContext
        >
            <header 
                className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-t-xl border-b border-blue-300 cursor-move"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center space-x-2">
                    {statusInfo.icon}
                    <div>
                        <h2 className="text-sm font-bold text-white">VoxMail Assistant</h2>
                        <p className="text-xs text-blue-100">{composeState.active ? `Composing: ${composeState.step}` : statusInfo.text}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsMuted(prev => !prev)} className="p-2 rounded-full hover:bg-blue-400 bg-blue-600 text-white transition-colors" title={isMuted ? 'Unmute' : 'Mute'}>
                        {isMuted ? <SpeakerOffIcon className="w-5 h-5" /> : <SpeakerIcon className="w-5 h-5" />}
                    </button>
                    <button onClick={chatbotStatus === 'LISTENING' ? stopListeningRef.current : startListeningRef.current} className={`p-2 rounded-full transition-colors ${chatbotStatus === 'LISTENING' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`} title={chatbotStatus === 'LISTENING' ? 'Stop Listening' : 'Start Listening'}>
                        {chatbotStatus === 'LISTENING' ? <PauseIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-2 rounded-full hover:bg-blue-400 bg-blue-600 text-white font-bold text-lg transition-colors" title="Close">
                        ×
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gradient-to-b from-blue-50 to-indigo-50 relative rounded-b-lg">
                {transcript.map((item) => (
                    <div key={item.id} className={`my-3 flex ${item.isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`px-4 py-3 rounded-2xl max-w-xs text-sm shadow-md ${item.isUser ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-br-none' : 'bg-white text-gray-800 border border-blue-200 rounded-bl-none'}`}>
                            {item.text}
                        </div>
                    </div>
                ))}
                {liveTranscript && (
                    <div className="my-3 flex justify-end">
                        <div className={`px-4 py-3 rounded-2xl max-w-xs text-sm bg-gradient-to-r from-blue-400 to-indigo-400 text-white opacity-90 rounded-br-none shadow-md`}>
                            {liveTranscript}
                        </div>
                    </div>
                )}
                <div ref={transcriptEndRef} />
            </div>
            <form onSubmit={handleTextSubmit} id="chatbot-form" className="p-3 border-t border-blue-200 bg-white rounded-b-xl">
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)} 
                        placeholder={chatbotStatus === 'LISTENING' ? 'Listening...' : 'Type a message or command...'}
                        className="flex-1 w-full bg-blue-50 border-2 border-blue-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 rounded-full" 
                        disabled={chatbotStatus === 'LISTENING'}
                    />
                    <button type="submit" className="p-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full hover:from-blue-600 hover:to-indigo-600 shadow-md transition-all">
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;