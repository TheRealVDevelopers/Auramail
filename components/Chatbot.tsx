import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Folder, Email } from '../types';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail, markEmailAsRead } from '../services/emailService';
import { speakWithBrowserTTS } from '../utils/audioUtils';
import { useTranslations } from '../utils/translations';

// Speech Recognition TypeScript definitions
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: ((event: Event) => void) | null;
    onstart: ((event: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

declare global {
    interface Window {
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
    }
}

type BotState = 'IDLE' | 'SPEAKING' | 'WAITING' | 'LISTENING' | 'PROCESSING';

type ComposeStep = 'none' | 'recipient' | 'subject' | 'body' | 'confirm';

interface Transcript {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: number;
}

interface DraftEmail {
    recipient?: string;
    subject?: string;
    body?: string;
}

const Chatbot: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const t = useTranslations();
    
    // UI State
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isMuted, setIsMuted] = useState(false);
    const [transcript, setTranscript] = useState<Transcript[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [liveTranscript, setLiveTranscript] = useState('');
    
    // Bot State
    const [botState, setBotState] = useState<BotState>('IDLE');
    const botStateRef = useRef<BotState>('IDLE');
    
    // Compose State
    const [composeStep, setComposeStep] = useState<ComposeStep>('none');
    const [draftEmail, setDraftEmail] = useState<DraftEmail>({});
    const composeStepRef = useRef<ComposeStep>('none');
    const draftEmailRef = useRef<DraftEmail>({});
    
    // Refs
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const hasSpokenWelcomeRef = useRef(false);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const scheduledTimersRef = useRef<NodeJS.Timeout[]>([]);
    
    // Update refs when state changes
    useEffect(() => {
        botStateRef.current = botState;
    }, [botState]);
    
    useEffect(() => {
        composeStepRef.current = composeStep;
    }, [composeStep]);
    
    useEffect(() => {
        draftEmailRef.current = draftEmail;
    }, [draftEmail]);
    
    // ====== AUDIO UTILITIES ======
    
    const initAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            try {
                const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                audioContextRef.current = new AudioContext({ sampleRate: 24000 });
                console.log('[AUDIO] AudioContext initialized');
            } catch (e) {
                console.error('[AUDIO] Failed to create AudioContext:', e);
                return;
            }
        }
        
        // Resume if suspended (required for autoplay policies)
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
                console.log('[AUDIO] AudioContext resumed');
            }).catch((e) => {
                console.warn('[AUDIO] Failed to resume AudioContext:', e);
            });
        }
    }, []);
    
    const playBeep = useCallback((type: 'start' | 'end') => {
        if (!audioContextRef.current) {
            initAudioContext();
            if (!audioContextRef.current) return;
        }
        
        try {
            const ctx = audioContextRef.current;
            
            // Ensure context is running
            if (ctx.state === 'suspended') {
                ctx.resume().catch(e => {
                    console.warn('[BEEP] Could not resume context:', e);
                    return;
                });
            }
            
            // Only create nodes if context is running
            if (ctx.state === 'closed') {
                console.warn('[BEEP] AudioContext is closed, cannot play beep');
                return;
            }
            
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            oscillator.frequency.value = type === 'start' ? 800 : 400;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
            
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.2);
            
            console.log(`[BEEP] ${type} beep played`);
        } catch (e) {
            console.error('[BEEP] Error playing beep:', e);
        }
    }, [initAudioContext]);
    
    // ====== CLEAR TIMERS ======
    
    const clearAllScheduledTimers = useCallback(() => {
        scheduledTimersRef.current.forEach(timer => clearTimeout(timer));
        scheduledTimersRef.current = [];
        console.log('[TIMERS] All scheduled timers cleared');
    }, []);
    
    // ====== SPEECH SYNTHESIS ======
    
    const speak = useCallback((text: string, onComplete?: () => void) => {
        if (isMuted) {
            console.log('[TTS] Muted, skipping speech');
            onComplete?.();
            return;
        }
        
        if (!text || text.trim().length === 0) {
            console.log('[TTS] Empty text, skipping speech');
            onComplete?.();
            return;
        }
        
        // Clear any scheduled timers and stop recognition (but don't cancel speech yet)
        clearAllScheduledTimers();
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {
                // Ignore errors when stopping recognition
            }
        }
        
        setBotState('SPEAKING');
        console.log(`[TTS] Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        // Add to transcript
        setTranscript(prev => [...prev, {
            id: `bot-${Date.now()}`,
            text,
            isUser: false,
            timestamp: Date.now()
        }]);
        
        initAudioContext();
        
        // Use the utility function which handles cancellation properly
        speakWithBrowserTTS(text, state.currentLanguage, () => {
            console.log('[TTS] Speech finished');
            setBotState('WAITING');
            
            // Schedule: 3s wait → beep → 1s → mic ON
            const timer1 = setTimeout(() => {
                if (botStateRef.current !== 'WAITING') {
                    console.log('[TTS] Post-speech sequence cancelled (state changed)');
                    return;
                }
                
                playBeep('end');
                console.log('[TTS] Post-speech beep played');
                
                const timer2 = setTimeout(() => {
                    if (botStateRef.current !== 'WAITING') {
                        console.log('[TTS] Mic activation cancelled (state changed)');
                        return;
                    }
                    
                    console.log('[TTS] Starting mic now');
                    startListening();
                }, 1000);
                
                scheduledTimersRef.current.push(timer2);
            }, 3000);
            
            scheduledTimersRef.current.push(timer1);
            onComplete?.();
        });
    }, [isMuted, state.currentLanguage, playBeep, initAudioContext, clearAllScheduledTimers, startListening]);
    
    // ====== SPEECH RECOGNITION ======
    
    const startListening = useCallback(() => {
        // Safety checks
        if (botStateRef.current === 'LISTENING') {
            console.log('[STT] Already listening');
            return;
        }
        
        if (window.speechSynthesis?.speaking) {
            console.log('[STT] Cannot start: browser is still speaking');
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speak('Speech recognition is not supported in this browser');
            return;
        }
        
        initAudioContext();
        
        // Initialize recognition if needed
        if (!recognitionRef.current) {
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            recognition.lang = state.currentLanguage;
            
            recognition.onstart = () => {
                console.log('[STT] Recognition started');
                setBotState('LISTENING');
            };
            
            recognition.onresult = (event) => {
                let interimText = '';
                let finalText = '';
                
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        finalText += result[0].transcript;
                    } else {
                        interimText += result[0].transcript;
                    }
                }
                
                setLiveTranscript(interimText);
                
                if (finalText.trim()) {
                    console.log(`[STT] Final: "${finalText}"`);
                    setLiveTranscript('');
                    processUserInput(finalText.trim());
                }
            };
            
            recognition.onerror = (event) => {
                console.error('[STT] Error:', event.error);
                setBotState('IDLE');
                setLiveTranscript('');
                
                if (event.error !== 'no-speech' && event.error !== 'aborted') {
                    speak('Sorry, I had trouble hearing you. Please try again.');
                }
            };
            
            recognition.onend = () => {
                console.log('[STT] Recognition ended');
                if (botStateRef.current === 'LISTENING') {
                    setBotState('IDLE');
                }
                setLiveTranscript('');
            };
            
            recognitionRef.current = recognition;
        }
        
        // Update language
        recognitionRef.current.lang = state.currentLanguage;
        console.log(`[STT] Language set to: ${state.currentLanguage}`);
        
        // Play beep and start
        playBeep('start');
        setBotState('LISTENING');
        
        setTimeout(() => {
            if (recognitionRef.current && botStateRef.current === 'LISTENING') {
                try {
                    recognitionRef.current.start();
                } catch (e) {
                    console.error('[STT] Failed to start:', e);
                    setBotState('IDLE');
                }
            }
        }, 1000);
        
    }, [state.currentLanguage, speak, playBeep, initAudioContext]);
    
    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {}
        }
        setBotState('IDLE');
        setLiveTranscript('');
        console.log('[STT] Stopped listening');
    }, []);
    
    // ====== COMMAND PROCESSING ======
    
    const processUserInput = useCallback(async (text: string) => {
        if (!text || text.length < 2) {
            speak("I didn't catch that. Please try again.");
            return;
        }
        
        clearAllScheduledTimers();
        stopListening();
        setBotState('PROCESSING');
        
        // Add to transcript
        setTranscript(prev => [...prev, {
            id: `user-${Date.now()}`,
            text,
            isUser: true,
            timestamp: Date.now()
        }]);
        
        console.log(`[PROCESS] User said: "${text}"`);
        
        const lowerText = text.toLowerCase();
        let response = '';
        
        // Helper to get response in current language
        const getResponse = (responses: { en: string; hi: string; ta: string }) => {
            if (state.currentLanguage === 'hi-IN') return responses.hi;
            if (state.currentLanguage === 'ta-IN') return responses.ta;
            return responses.en;
        };
        
        // ====== COMPOSE FLOW ======
        if (composeStepRef.current !== 'none') {
            const step = composeStepRef.current;
            const draft = { ...draftEmailRef.current };
            
            if (step === 'recipient') {
                // Extract email or set recipient
                const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                draft.recipient = emailMatch ? emailMatch[0] : text.trim();
                setDraftEmail(draft);
                setComposeStep('subject');
                response = getResponse({
                    en: `Recipient set to ${draft.recipient}. What is the subject?`,
                    hi: `प्राप्तकर्ता ${draft.recipient} सेट किया। विषय क्या है?`,
                    ta: `பெறுநர் ${draft.recipient} அமைக்கப்பட்டது. தலைப்பு என்ன?`
                });
            }
            else if (step === 'subject') {
                draft.subject = text.trim();
                setDraftEmail(draft);
                setComposeStep('body');
                response = getResponse({
                    en: 'Subject set. Now tell me the email body or message content.',
                    hi: 'विषय सेट किया। अब ईमेल सामग्री बताएं।',
                    ta: 'தலைப்பு அமைக்கப்பட்டது. இப்போது மின்னஞ்சல் உள்ளடக்கத்தைச் சொல்லுங்கள்.'
                });
            }
            else if (step === 'body') {
                draft.body = text.trim();
                setDraftEmail(draft);
                setComposeStep('confirm');
                response = getResponse({
                    en: `Email ready. To: ${draft.recipient}, Subject: ${draft.subject}, Body: ${draft.body}. Say send to send, or change to modify.`,
                    hi: `ईमेल तैयार है। प्राप्तकर्ता: ${draft.recipient}, विषय: ${draft.subject}, सामग्री: ${draft.body}। भेजने के लिए send कहें।`,
                    ta: `மின்னஞ்சல் தயார். பெறுநர்: ${draft.recipient}, தலைப்பு: ${draft.subject}, உள்ளடக்கம்: ${draft.body}. அனுப்ப send சொல்லுங்கள்.`
                });
            }
            else if (step === 'confirm') {
                if (/(send|yes|confirm|भेजो|அனுப்பு)/i.test(lowerText)) {
                    try {
                        const userId = auth.currentUser?.uid;
                        if (!userId) throw new Error('Not authenticated');
                        
                        await sendEmail(userId, {
                            recipient: draft.recipient || '',
                            subject: draft.subject || 'No Subject',
                            body: draft.body || '',
                            sender: state.userProfile?.email || '',
                            folder: Folder.SENT
                        });
                        response = getResponse({
                            en: 'Email sent successfully!',
                            hi: 'ईमेल सफलतापूर्वक भेजा गया!',
                            ta: 'மின்னஞ்சல் வெற்றிகரமாக அனுப்பப்பட்டது!'
                        });
                    } catch (err) {
                        response = getResponse({
                            en: 'Failed to send email. Please try again.',
                            hi: 'ईमेल भेजने में विफल। पुनः प्रयास करें।',
                            ta: 'மின்னஞ்சல் அனுப்புவதில் தோல்வி. மீண்டும் முயற்சிக்கவும்.'
                        });
                    }
                    setComposeStep('none');
                    setDraftEmail({});
                } else if (/(change|edit|cancel|बदलो|மாற்று)/i.test(lowerText)) {
                    setComposeStep('none');
                    setDraftEmail({});
                    response = getResponse({
                        en: 'Email composition cancelled.',
                        hi: 'ईमेल रचना रद्द की गई।',
                        ta: 'மின்னஞ்சல் எழுதுதல் ரத்து செய்யப்பட்டது.'
                    });
                } else {
                    response = getResponse({
                        en: 'Say send to send the email, or change to cancel.',
                        hi: 'भेजने के लिए send कहें, या रद्द करने के लिए change कहें।',
                        ta: 'அனுப்ப send சொல்லுங்கள், அல்லது ரத்து செய்ய change சொல்லுங்கள்.'
                    });
                }
            }
            
            setTimeout(() => speak(response), 100);
            return;
        }
        
        // LANGUAGE SWITCHING (detect in all languages)
        if (/(english|इंग्लिश|ஆங்கிலம்)/i.test(lowerText)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'en-US' });
            response = 'Language switched to English. I understand commands in all three languages.';
        }
        else if (/(hindi|हिंदी|हिन्दी)/i.test(lowerText)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'hi-IN' });
            response = 'भाषा हिंदी में बदल गई। मैं तीनों भाषाओं में आदेश समझता हूं।';
        }
        else if (/(tamil|தமிழ்|தமில்)/i.test(lowerText)) {
            dispatch({ type: 'SET_LANGUAGE', payload: 'ta-IN' });
            response = 'மொழி தமிழுக்கு மாற்றப்பட்டது. மூன்று மொழிகளிலும் கட்டளைகளைப் புரிந்துகொள்கிறேன்.';
        }
        
        // GREETINGS
        else if (/(hi|hello|hey|namaste|vanakkam|नमस्ते|வணக்கம்)/i.test(lowerText)) {
            const greetings = {
                en: ["Hello! I'm VoxMail Assistant. How can I help?", "Hi there! Ready to manage your emails.", "Namaste! What would you like to do?"],
                hi: ["नमस्ते! मैं VoxMail सहायक हूं। कैसे मदद करूं?", "हैलो! ईमेल प्रबंधन के लिए तैयार हूं।"],
                ta: ["வணக்கம்! நான் VoxMail உதவியாளர். எப்படி உதவ முடியும்?", "வணக்கம்! மின்னஞ்சல் நிர்வாகத்திற்கு தயாராக இருக்கிறேன்."]
            };
            const list = state.currentLanguage === 'hi-IN' ? greetings.hi : state.currentLanguage === 'ta-IN' ? greetings.ta : greetings.en;
            response = list[Math.floor(Math.random() * list.length)];
        }
        
        // INBOX
        else if (/(inbox|इनबॉक्स|இன்பாக்ஸ்)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.INBOX });
            response = getResponse({
                en: 'Opening inbox.',
                hi: 'इनबॉक्स खोल रहे हैं।',
                ta: 'இன்பாக்ஸ் திறக்கிறது.'
            });
        }
        
        // SENT
        else if (/(sent|भेजा गया|அனுப்பிய)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
            response = getResponse({
                en: 'Opening sent folder.',
                hi: 'भेजा गया फ़ोल्डर खोल रहे हैं।',
                ta: 'அனுப்பிய கோப்புறையைத் திறக்கிறது.'
            });
        }
        
        // DRAFTS
        else if (/(draft|ड्राफ्ट|வரைவு)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.DRAFTS });
            response = getResponse({
                en: 'Opening drafts folder.',
                hi: 'ड्राफ्ट फ़ोल्डर खोल रहे हैं।',
                ta: 'வரைவு கோப்புறையைத் திறக்கிறது.'
            });
        }
        
        // TRASH
        else if (/(trash|delete|कूड़ादान|குப்பை)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.TRASH });
            response = getResponse({
                en: 'Opening trash folder.',
                hi: 'कूड़ादान फ़ोल्डर खोल रहे हैं।',
                ta: 'குப்பை கோப்புறையைத் திறக்கிறது.'
            });
        }
        
        // SPAM
        else if (/(spam|junk|स्पैम|ஸ்பேம்)/i.test(lowerText)) {
            dispatch({ type: 'SELECT_FOLDER', payload: Folder.SPAM });
            response = getResponse({
                en: 'Opening spam folder.',
                hi: 'स्पैम फ़ोल्डर खोल रहे हैं।',
                ta: 'ஸ்பேம் கோப்புறையைத் திறக்கிறது.'
            });
        }
        
        // COMPOSE EMAIL
        else if (/(compose|new email|write email|नया ईमेल|புதிய மின்னஞ்சல்)/i.test(lowerText)) {
            setComposeStep('recipient');
            setDraftEmail({});
            response = getResponse({
                en: 'Starting email composition. Who is the recipient? Say their email address.',
                hi: 'ईमेल लिख रहे हैं। प्राप्तकर्ता का ईमेल पता बताएं।',
                ta: 'மின்னஞ்சல் எழுதுகிறோம். பெறுநரின் மின்னஞ்சல் முகவரியைச் சொல்லுங்கள்.'
            });
        }
        
        // READ EMAIL (e.g., "read first email", "read 3rd email")
        else if (/(read|open).*(first|second|third|1st|2nd|3rd|\d+)(st|nd|rd|th)?.*(email|mail)/i.test(lowerText)) {
            const match = lowerText.match(/(first|second|third|1st|2nd|3rd|\d+)/);
            if (match) {
                const emailNums: { [key: string]: number } = { first: 1, second: 2, third: 3, '1st': 1, '2nd': 2, '3rd': 3 };
                const index = emailNums[match[0]] || parseInt(match[0]) || 1;
                const email = state.emails[index - 1];
                
                if (email) {
                    dispatch({ type: 'SELECT_EMAIL', payload: email.id });
                    response = getResponse({
                        en: `Reading email ${index}. From: ${email.sender}. Subject: ${email.subject}. Body: ${email.snippet || 'No content'}`,
                        hi: `ईमेल ${index} पढ़ रहे हैं। प्रेषक: ${email.sender}। विषय: ${email.subject}। सामग्री: ${email.snippet || 'कोई सामग्री नहीं'}`,
                        ta: `மின்னஞ்சல் ${index} படிக்கிறது. அனுப்புநர்: ${email.sender}. தலைப்பு: ${email.subject}. உள்ளடக்கம்: ${email.snippet || 'உள்ளடக்கம் இல்லை'}`
                    });
                } else {
                    response = getResponse({
                        en: `Email ${index} not found. You have ${state.emails.length} emails.`,
                        hi: `ईमेल ${index} नहीं मिला। आपके पास ${state.emails.length} ईमेल हैं।`,
                        ta: `மின்னஞ்சல் ${index} காணப்படவில்லை. ${state.emails.length} மின்னஞ்சல்கள் உள்ளன.`
                    });
                }
            }
        }
        
        // DELETE CURRENT EMAIL
        else if (/(delete|remove).*(this|current).*(email|mail)|हटाओ|நீக்கு/i.test(lowerText)) {
            if (state.selectedEmail) {
                try {
                    const userId = auth.currentUser?.uid;
                    if (!userId) throw new Error('Not authenticated');
                    
                    await updateEmailFolder(userId, state.selectedEmail, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: state.selectedEmail });
                    response = getResponse({
                        en: 'Email moved to trash.',
                        hi: 'ईमेल कूड़ेदान में डाला गया।',
                        ta: 'மின்னஞ்சல் குப்பைக்கு நகர்த்தப்பட்டது.'
                    });
                } catch (err) {
                    response = getResponse({
                        en: 'Failed to delete email.',
                        hi: 'ईमेल हटाने में विफल।',
                        ta: 'மின்னஞ்சலை நீக்குவதில் தோல்வி.'
                    });
                }
            } else {
                response = getResponse({
                    en: 'No email selected. Please open an email first.',
                    hi: 'कोई ईमेल चयनित नहीं। पहले ईमेल खोलें।',
                    ta: 'மின்னஞ்சல் தேர்ந்தெடுக்கப்படவில்லை. முதலில் ஒரு மின்னஞ்சலைத் திறக்கவும்.'
                });
            }
        }
        
        // HELP
        else if (/(help|what can you do|क्या कर सकते|என்ன செய்ய)/i.test(lowerText)) {
            response = getResponse({
                en: 'I can: read emails (say "read 3rd email"), compose messages (say "compose"), delete emails, switch folders, and more. I understand English, Hindi, and Tamil.',
                hi: 'मैं कर सकता हूं: ईमेल पढ़ना ("read 3rd email" कहें), संदेश लिखना ("compose" कहें), ईमेल हटाना, फ़ोल्डर बदलना। मैं अंग्रेजी, हिंदी और तमिल समझता हूं।',
                ta: 'நான் செய்ய முடியும்: மின்னஞ்சல்களை படி ("read 3rd email" சொல்), செய்தி எழுது ("compose" சொல்), நீக்கு, கோப்புறை மாற்று. ஆங்கிலம், இந்தி, தமிழ் புரியும்.'
            });
        }
        
        // LOGOUT
        else if (/(logout|sign out|लॉग आउट|வெளியேறு)/i.test(lowerText)) {
            response = getResponse({
                en: 'Signing out. Goodbye!',
                hi: 'साइन आउट हो रहे हैं। अलविदा!',
                ta: 'வெளியேறுகிறீர்கள். பிரியாவிடை!'
            });
            setTimeout(() => auth.signOut(), 1500);
        }
        
        // THANK YOU
        else if (/(thank|धन्यवाद|நன்றி)/i.test(lowerText)) {
            response = getResponse({
                en: "You're welcome!",
                hi: 'स्वागत है!',
                ta: 'வரவேற்கிறேன்!'
            });
        }
        
        // DEFAULT
        else {
            response = getResponse({
                en: "I didn't understand that. Try: compose, read first email, inbox, sent, delete, help, or switch language.",
                hi: 'मैं समझा नहीं। कहें: compose, read first email, इनबॉक्स, भेजा गया, हटाओ, सहायता, भाषा बदलें।',
                ta: 'புரியவில்லை. சொல்லுங்கள்: compose, read first email, இன்பாக்ஸ், அனுப்பிய, நீக்கு, உதவி, மொழி மாற்று.'
            });
        }
        
        // Speak response
        setTimeout(() => {
            speak(response);
        }, 100);
        
    }, [state.currentLanguage, state.emails, state.selectedEmail, state.userProfile, dispatch, speak, stopListening, clearAllScheduledTimers]);
    
    // ====== TEXT INPUT HANDLER ======
    
    const handleTextSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (!text) return;
        
        setInputValue('');
        console.log('[MANUAL] Processing text input');
        processUserInput(text);
    }, [inputValue, processUserInput]);
    
    // ====== WELCOME MESSAGE ======
    
    useEffect(() => {
        if (!state.isChatbotOpen || hasSpokenWelcomeRef.current) return;
        
        const speakWelcome = () => {
            if (hasSpokenWelcomeRef.current) return;
            hasSpokenWelcomeRef.current = true;
            console.log('[WELCOME] Speaking welcome message');
            initAudioContext();
            setTimeout(() => {
                speak(t('welcomeMessage'));
            }, 200);
        };
        
        // Try immediately
        const timer = setTimeout(speakWelcome, 150);
        
        // Fallback on gesture
        const gestureHandler = () => {
            speakWelcome();
            window.removeEventListener('click', gestureHandler, true);
            window.removeEventListener('pointerdown', gestureHandler, true);
        };
        
        window.addEventListener('click', gestureHandler, true);
        window.addEventListener('pointerdown', gestureHandler, true);
        
        return () => {
            clearTimeout(timer);
            window.removeEventListener('click', gestureHandler, true);
            window.removeEventListener('pointerdown', gestureHandler, true);
        };
    }, [state.isChatbotOpen, speak, t, initAudioContext]);
    
    // ====== UPDATE RECOGNITION LANGUAGE ======
    
    useEffect(() => {
        if (recognitionRef.current) {
            recognitionRef.current.lang = state.currentLanguage;
            console.log(`[STT] Language updated to: ${state.currentLanguage}`);
        }
    }, [state.currentLanguage]);
    
    // ====== CLEANUP ======
    
    useEffect(() => {
        return () => {
            clearAllScheduledTimers();
            stopListening();
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            // Don't close audio context on cleanup - let it be reused
            // Only close if component is truly unmounting and we're sure we won't need it
        };
    }, [clearAllScheduledTimers, stopListening]);
    
    // ====== SCROLL TRANSCRIPT ======
    
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, liveTranscript]);
    
    // ====== DRAG HANDLERS ======
    
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };
    
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging) {
            setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    }, [isDragging, dragStart]);
    
    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);
    
    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);
    
    // ====== STATUS DISPLAY ======
    
    const getStatusInfo = () => {
        switch (botState) {
            case 'SPEAKING':
                return { text: 'Speaking...', icon: <SpeakerIcon className="w-5 h-5 text-blue-600" /> };
            case 'WAITING':
                return { text: 'Waiting...', icon: <div className="w-5 h-5 border-2 border-blue-400 border-t-blue-600 rounded-full animate-spin" /> };
            case 'LISTENING':
                return { text: 'Listening...', icon: <MicIcon className="w-5 h-5 text-red-500 animate-pulse" /> };
            case 'PROCESSING':
                return { text: 'Processing...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin" /> };
            default:
                return { text: 'Ready', icon: <MicIcon className="w-5 h-5 text-blue-600" /> };
        }
    };
    
    const statusInfo = getStatusInfo();
    
    // ====== RENDER ======
    
    return (
        <div 
            className="fixed flex flex-col bg-white rounded-xl shadow-2xl border-2 border-blue-500" 
            style={{ left: position.x, top: position.y, width: '400px', height: '500px' }}
            onClick={initAudioContext}
        >
            {/* Header */}
            <header 
                className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-t-xl cursor-move"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center space-x-2">
                    {statusInfo.icon}
                    <div>
                        <h2 className="text-sm font-bold text-white">VoxMail Assistant</h2>
                        <p className="text-xs text-blue-100">{statusInfo.text}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button 
                        onClick={() => setIsMuted(prev => !prev)} 
                        className="p-2 rounded-full bg-blue-600 hover:bg-blue-400 text-white transition"
                        title={isMuted ? 'Unmute' : 'Mute'}
                    >
                        {isMuted ? <SpeakerOffIcon className="w-5 h-5" /> : <SpeakerIcon className="w-5 h-5" />}
                    </button>
                    <button 
                        onClick={botState === 'LISTENING' ? stopListening : startListening} 
                        className={`p-2 rounded-full text-white transition ${
                            botState === 'LISTENING' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                        title={botState === 'LISTENING' ? 'Stop' : 'Start Listening'}
                    >
                        {botState === 'LISTENING' ? <PauseIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
                    </button>
                    <button 
                        onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} 
                        className="p-2 rounded-full bg-blue-600 hover:bg-blue-400 text-white font-bold transition"
                        title="Close"
                    >
                        ×
                    </button>
                </div>
            </header>
            
            {/* Transcript */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {transcript.map(item => (
                    <div 
                        key={item.id} 
                        className={`flex ${item.isUser ? 'justify-end' : 'justify-start'}`}
                    >
                        <div className={`max-w-[80%] px-4 py-2 rounded-lg ${
                            item.isUser 
                                ? 'bg-blue-500 text-white' 
                                : 'bg-white text-gray-800 border border-gray-200'
                        }`}>
                            <p className="text-sm">{item.text}</p>
                        </div>
                    </div>
                ))}
                {liveTranscript && (
                    <div className="flex justify-end">
                        <div className="max-w-[80%] px-4 py-2 rounded-lg bg-blue-300 text-white opacity-70">
                            <p className="text-sm italic">{liveTranscript}...</p>
                        </div>
                    </div>
                )}
                <div ref={transcriptEndRef} />
            </div>
            
            {/* Input */}
            <form onSubmit={handleTextSubmit} className="p-3 bg-white border-t border-gray-200 rounded-b-xl">
                <div className="flex items-center space-x-2">
                    <input 
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                        type="submit"
                        className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                        title="Send"
                    >
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;
