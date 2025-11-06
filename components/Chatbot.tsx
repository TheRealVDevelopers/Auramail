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
    const receivedFinalRef = useRef(false);
    const chatbotStatusRef = useRef<ChatbotStatus>(chatbotStatus);

    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);
    
    // Keep status ref in sync
    useEffect(() => { chatbotStatusRef.current = chatbotStatus; }, [chatbotStatus]);

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
        stopListeningRef.current();
        setChatbotStatus('SPEAKING');

        // Add to transcript
        setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);

        // Ensure AudioContext is initialized and resumed for beep sounds
        initAudioContext();

        speakWithBrowserTTS(text, state.currentLanguage, () => {
            console.log('[TTS] Finished speaking.');
            // Exit SPEAKING state immediately so mic can start later
            setChatbotStatus('IDLE');
            chatbotStatusRef.current = 'IDLE';
            // After speaking: wait 3s -> beep -> wait 1s -> mic ON
            setTimeout(() => {
                if (chatbotStatusRef.current === 'IDLE') {
                    playBeep('end');
                    setTimeout(() => {
                        if (!composeStateRef.current.active && chatbotStatusRef.current === 'IDLE') {
                            startListeningRef.current();
                        }
                    }, 1000);
                }
            }, 3000);
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
        // Use ref to check current status to avoid stale closures
        if (chatbotStatusRef.current === 'SPEAKING') {
            console.log('[STT] Blocked: still speaking.');
            return;
        }
        if (chatbotStatusRef.current === 'LISTENING') {
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
                }, 5000);

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
                    receivedFinalRef.current = true;
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
                }, 5000);
            };

            recognition.onend = () => {
                console.log('[STT] Recognition ended.');
                setChatbotStatus('IDLE');
                chatbotStatusRef.current = 'IDLE';
                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
                // Only handle no-speech case, don't auto-restart
                if (!composeStateRef.current.active && chatbotStatusRef.current !== 'SPEAKING') {
                    if (!receivedFinalRef.current) {
                        // User didn't say anything, prompt them
                        startSpeakingRef.current(t('didntUnderstand'));
                    }
                    // Otherwise, startSpeaking will handle the cycle via its completion callback
                }
            };
        }

        recognitionRef.current.lang = state.currentLanguage;
        console.log(`[STT] Setting recognition language to: ${state.currentLanguage}`);
        receivedFinalRef.current = false;
        setChatbotStatus('LISTENING');
        chatbotStatusRef.current = 'LISTENING';
        playBeep('start');
        setTimeout(() => {
            if (recognitionRef.current) {
                recognitionRef.current.start();
            }
        }, 1000);
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

        // --- Intelligent Chatbot Logic ---
        // Multilingual command recognition: understand all 3 languages, respond in selected language
        let aiResponse = '';
        const lowerText = text.toLowerCase();

        // Helper to get response in current language
        const getResponse = (responses: { en: string; hi: string; ta: string }) => {
            if (state.currentLanguage === 'hi-IN') return responses.hi;
            if (state.currentLanguage === 'ta-IN') return responses.ta;
            return responses.en;
        };

        if (composeStateRef.current.active) {
            // Handle email composition steps
            aiResponse = "Email composition is not yet fully re-implemented in this new chatbot version.";
        }
        // Greetings
        else if (/(^|\b)(hi|hello|hey|namaste|vanakkam|good morning|good afternoon|good evening)(\b|!|\.|,)/i.test(lowerText)) {
            const greetingsEN = [
                "Hello! I'm your VoxMail Assistant. I can help you read emails, compose messages, or switch folders. What would you like to do?",
                "Hi there! Ready to help you manage your emails.",
                "Namaste! I'm here to assist with your emails."
            ];
            const greetingsHI = [
                "नमस्ते! मैं आपका VoxMail सहायक हूं। मैं आपको ईमेल पढ़ने, संदेश लिखने या फ़ोल्डर बदलने में मदद कर सकता हूं।",
                "हैलो! आपके ईमेल प्रबंधित करने के लिए तैयार हूं।"
            ];
            const greetingsTA = [
                "வணக்கம்! நான் உங்கள் VoxMail உதவியாளர். மின்னஞ்சல்களை படிக்க, செய்திகளை எழுத அல்லது கோப்புறைகளை மாற்ற உதவ முடியும்.",
                "வணக்கம்! உங்கள் மின்னஞ்சல்களை நிர்வகிக்க தயாராக இருக்கிறேன்."
            ];
            const greetings = state.currentLanguage === 'hi-IN' ? greetingsHI : state.currentLanguage === 'ta-IN' ? greetingsTA : greetingsEN;
            aiResponse = greetings[Math.floor(Math.random() * greetings.length)];
        }
        // Introduction (all languages)
        else if (/(who are you|what are you|your name|introduce yourself|तुम कौन हो|आप कौन हैं|நீங்கள் யார்)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: "I'm VoxMail Assistant, your voice-controlled email helper designed for accessibility. I can understand English, Hindi, and Tamil commands.",
                hi: "मैं VoxMail सहायक हूं, दृष्टिबाधित उपयोगकर्ताओं के लिए डिज़ाइन किया गया वॉयस-नियंत्रित ईमेल सहायक। मैं अंग्रेजी, हिंदी और तमिल आदेश समझ सकता हूं।",
                ta: "நான் VoxMail உதவியாளர், பார்வையற்றவர்களுக்கான குரல்-கட்டுப்பாட்டு மின்னஞ்சல் உதவியாளர். ஆங்கிலம், இந்தி மற்றும் தமிழ் கட்டளைகளை புரிந்துகொள்ள முடியும்."
            });
        }
        // How are you (all languages)
        else if (/(how are you|how's it going|kaise ho|aap kaise hain|eppadi iruke|how do you do|कैसे हो|எப்படி இருக்கீங்க)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: "I'm doing great, thank you! Ready to help with your emails. What can I do for you?",
                hi: "मैं बहुत अच्छा हूं, धन्यवाद! आपके ईमेल में मदद के लिए तैयार हूं।",
                ta: "நான் நன்றாக இருக்கிறேன், நன்றி! உங்கள் மின்னஞ்சல்களுக்கு உதவ தயாராக இருக்கிறேன்."
            });
        }
        // Capabilities (all languages)
        else if (/(what can you do|help me|capabilities|features|commands|how to use|tell me about|what do you know|क्या कर सकते हो|என்ன செய்ய முடியும்)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: "I can help you: read emails, compose messages, switch folders (inbox, sent, drafts, trash, spam), search emails, mark as read, delete, move to spam, check unread count, and switch languages. I understand commands in all three languages!",
                hi: "मैं आपकी मदद कर सकता हूं: ईमेल पढ़ना, संदेश लिखना, फ़ोल्डर बदलना, ईमेल खोजना, पढ़ा हुआ चिह्नित करना, हटाना, स्पैम में ले जाना। मैं तीनों भाषाओं में आदेश समझता हूं!",
                ta: "நான் உதவ முடியும்: மின்னஞ்சல்களை படிக்க, செய்திகள் எழுத, கோப்புறைகளை மாற்ற, தேடல், படித்ததாக குறி, நீக்கு, ஸ்பேம் நகர்த்து. மூன்று மொழிகளிலும் கட்டளைகளை புரிந்துகொள்கிறேன்!"
            });
        }
        // Language switching
        else if (lowerText.match(/english|switch to english|change to english|speak english|அங்கிலம்/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'en-US' });
            aiResponse = 'Language switched to English. I will now speak and understand English.';
        } else if (lowerText.match(/hindi|switch to hindi|change to hindi|speak hindi|हिन्दी|हिंदी/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'hi-IN' });
            aiResponse = 'भाषा हिन्दी में बदल दी गई है। मैं अब हिन्दी बोलूंगा और समझूंगा।';
        } else if (lowerText.match(/tamil|switch to tamil|change to tamil|speak tamil|தமிழ்/)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'ta-IN' });
            aiResponse = 'மொழி தமிழுக்கு மாற்றப்பட்டது. நான் இப்போது தமிழில் பேசுவேன் மற்றும் புரிந்துகொள்வேன்.';
        }
        // Inbox (all languages)
        else if (/(inbox|open inbox|show inbox|go to inbox|check inbox|इनबॉक्स|इनबॉक्स खोलो|இன்பாக்ஸ்|இன்பாக்ஸ் திற)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.INBOX });
            aiResponse = getResponse({
                en: 'Opening inbox. You can now browse your received emails.',
                hi: 'इनबॉक्स खोल रहे हैं। आप अपने प्राप्त ईमेल देख सकते हैं।',
                ta: 'இன்பாக்ஸ் திறக்கிறது. உங்கள் மின்னஞ்சல்களைப் பார்க்கலாம்.'
            });
        }
        // Sent (all languages)
        else if (/(sent|sent emails|sent folder|sent items|show sent|open sent|भेजा गया|भेजे गए|அனுப்பிய|அனுப்பியவை)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
            aiResponse = getResponse({
                en: 'Opening sent folder. Here are the emails you have sent.',
                hi: 'भेजा गया फ़ोल्डर खोल रहे हैं। यह आपके भेजे गए ईमेल हैं।',
                ta: 'அனுப்பிய கோப்புறையைத் திறக்கிறது. நீங்கள் அனுப்பிய மின்னஞ்சல்கள்.'
            });
        }
        // Drafts (all languages)
        else if (/(drafts|draft emails|draft folder|show drafts|open drafts|ड्राफ्ट|வரைவு|வரைவுகள்)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.DRAFTS });
            aiResponse = getResponse({
                en: 'Opening drafts folder. Here are your saved draft emails.',
                hi: 'ड्राफ्ट फ़ोल्डर खोल रहे हैं। यह आपके सहेजे गए ड्राफ्ट हैं।',
                ta: 'வரைவு கோப்புறையைத் திறக்கிறது. உங்கள் சேமித்த வரைவுகள்.'
            });
        }
        // Trash (all languages)
        else if (/(trash|deleted|deleted emails|trash folder|show trash|open trash|recycle bin|कूड़ादान|हटाए गए|குப்பை|நீக்கப்பட்டவை)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.TRASH });
            aiResponse = getResponse({
                en: 'Opening trash folder. These are your deleted emails.',
                hi: 'कूड़ादान फ़ोल्डर खोल रहे हैं। यह आपके हटाए गए ईमेल हैं।',
                ta: 'குப்பை கோப்புறையைத் திறக்கிறது. நீக்கப்பட்ட மின்னஞ்சல்கள்.'
            });
        }
        // Spam (all languages)
        else if (/(spam|junk|junk emails|spam folder|show spam|open spam|स्पैम|अनचाहे|ஸ்பேம்|தேவையற்றவை)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.SPAM });
            aiResponse = getResponse({
                en: 'Opening spam folder. These are emails marked as spam.',
                hi: 'स्पैम फ़ोल्डर खोल रहे हैं। यह स्पैम चिह्नित ईमेल हैं।',
                ta: 'ஸ்பேம் கோப்புறையைத் திறக்கிறது. ஸ்பேம் என குறிக்கப்பட்ட மின்னஞ்சல்கள்.'
            });
        }
        // Compose (all languages)
        else if (/(compose|new email|write email|send email|create email|draft email|नया ईमेल|ईमेल लिखो|புதிய மின்னஞ்சல்|மின்னஞ்சல் எழுது)/i.test(lowerText)) {
            setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
            aiResponse = getResponse({
                en: t('composeRecipientPrompt'),
                hi: 'ईमेल लिख रहे हैं। प्राप्तकर्ता का ईमेल पता बोलें।',
                ta: 'மின்னஞ்சல் எழுதுகிறோம். பெறுநரின் மின்னஞ்சல் முகவரியைச் சொல்லுங்கள்.'
            });
        }
        // Unread count
        else if (/(how many|unread|new emails|new messages|check unread|unread count)/i.test(lowerText)) {
            aiResponse = 'Checking your unread emails. You have some new messages in your inbox.';
        }
        // Read emails
        else if (/(read|read emails|read my emails|read inbox|tell me emails)/i.test(lowerText)) {
            aiResponse = 'To read an email, please select it from the list, and I will read it aloud for you.';
        }
        // Search
        else if (/(search|find|look for|search email|find email)/i.test(lowerText)) {
            aiResponse = 'To search for emails, please use the search bar and I can help you find specific messages.';
        }
        // Mark as read
        else if (/(mark as read|mark read|read this)/i.test(lowerText)) {
            aiResponse = 'To mark an email as read, please select it first.';
        }
        // Delete
        else if (/(delete|delete email|remove|remove email)/i.test(lowerText)) {
            aiResponse = 'To delete an email, please select it first, and I will move it to trash.';
        }
        // Move to spam
        else if (/(spam this|mark as spam|move to spam|report spam)/i.test(lowerText)) {
            aiResponse = 'To mark an email as spam, please select it first.';
        }
        // Logout (all languages)
        else if (/(logout|log out|sign out|sign off|exit|लॉग आउट|साइन आउट|வெளியேறு)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: 'Signing out. Goodbye!',
                hi: 'साइन आउट हो रहे हैं। अलविदा!',
                ta: 'வெளியேறுகிறீர்கள். பிரியாவிடை!'
            });
            setTimeout(() => auth.signOut(), 1000);
        }
        // Thank you (all languages)
        else if (/(thank you|thanks|thank you so much|thank you very much|appreciate|shukriya|nandri|धन्यवाद|शुक्रिया|நன்றி)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: "You're welcome! I'm always here to help.",
                hi: 'कोई बात नहीं! मैं हमेशा मदद के लिए यहां हूं।',
                ta: 'வரவேற்கிறேன்! எப்போதும் உதவ இங்கே இருக்கிறேன்.'
            });
        }
        // Yes (all languages)
        else if (/(^|\b)(yes|yeah|yep|sure|okay|ok|correct|right|haan|हां|ஆம்)(\b|!|\.|,)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: 'Great! What would you like me to do next?',
                hi: 'बढ़िया! आगे क्या करना चाहते हैं?',
                ta: 'சிறப்பு! அடுத்து என்ன செய்ய வேண்டும்?'
            });
        }
        // No (all languages)
        else if (/(^|\b)(no|nope|not now|nah|later|nahi|नहीं|இல்லை)(\b|!|\.|,)/i.test(lowerText)) {
            aiResponse = getResponse({
                en: 'Okay, no problem. Let me know when you need help.',
                hi: 'ठीक है, कोई बात नहीं। जब मदद चाहिए तो बताएं।',
                ta: 'சரி, பரவாயில்லை. உதவி தேவைப்படும் போது சொல்லுங்கள்.'
            });
        }
        // Repeat / Say again
        else if (/(repeat|say again|say that again|didn't hear|didn't understand|what did you say)/i.test(lowerText)) {
            aiResponse = "I'm sorry, could you please repeat your request? I'm here to help with reading, composing, or managing your emails.";
        }
        // My name is...
        else if (/(my name is|i am|i'm|call me)/i.test(lowerText)) {
            const nameMatch = text.match(/(?:my name is|i am|i'm|call me)\s+([a-zA-Z]+)/i);
            const userName = nameMatch ? nameMatch[1] : 'there';
            aiResponse = `Nice to meet you, ${userName}! I'm VoxMail Assistant. How can I help you with your emails today?`;
        }
        // Bye / Goodbye
        else if (/(bye|goodbye|see you|talk to you later|alvida|பாய்)/i.test(lowerText)) {
            aiResponse = "Goodbye! Feel free to come back anytime you need help with your emails. Have a great day!";
        }
        // Default fallback (in current language)
        else {
            aiResponse = getResponse({
                en: "I didn't quite understand that. You can ask me to read emails, compose a message, switch folders, or change the language. I understand commands in English, Hindi, and Tamil!",
                hi: 'मैं यह नहीं समझा। आप मुझसे ईमेल पढ़ने, संदेश लिखने, फ़ोल्डर बदलने या भाषा बदलने के लिए कह सकते हैं। मैं अंग्रेजी, हिंदी और तमिल में आदेश समझता हूं!',
                ta: 'நான் இதை புரிந்துகொள்ளவில்லை. மின்னஞ்சல்களை படிக்க, செய்தி எழுத, கோப்புறைகளை மாற்ற அல்லது மொழி மாற்ற கேட்கலாம். ஆங்கிலம், இந்தி மற்றும் தமிழில் கட்டளைகளை புரிந்துகொள்கிறேன்!'
            });
        }

        startSpeakingRef.current(aiResponse); // startSpeaking will handle the post-speaking flow
    }, [dispatch, t, state.currentLanguage]);

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

    // Fallbacks to trigger welcome if autoplay blocks it or timing races occur
    useEffect(() => {
        if (!state.isChatbotOpen) return;
        const trigger = () => {
            if (!hasSpokenWelcomeRef.current) {
                console.log('[INIT] Triggering welcome from user gesture.');
                hasSpokenWelcomeRef.current = true;
                initAudioContext();
                startSpeakingRef.current(t('welcomeMessage'));
            }
            window.removeEventListener('pointerdown', trigger, true);
            window.removeEventListener('touchstart', trigger, true);
            window.removeEventListener('keydown', trigger, true);
            window.removeEventListener('click', trigger, true);
        };
        window.addEventListener('pointerdown', trigger, true);
        window.addEventListener('touchstart', trigger, true);
        window.addEventListener('keydown', trigger, true);
        window.addEventListener('click', trigger, true);

        // Time fallback: fire after 2s if not yet spoken
        const timer = window.setTimeout(() => {
            if (!hasSpokenWelcomeRef.current) {
                console.log('[INIT] Triggering welcome from 2s timer fallback.');
                hasSpokenWelcomeRef.current = true;
                initAudioContext();
                startSpeakingRef.current(t('welcomeMessage'));
            }
        }, 2000);

        return () => {
            window.removeEventListener('pointerdown', trigger, true);
            window.removeEventListener('touchstart', trigger, true);
            window.removeEventListener('keydown', trigger, true);
            window.removeEventListener('click', trigger, true);
            window.clearTimeout(timer);
        };
    }, [state.isChatbotOpen, t, initAudioContext]);

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