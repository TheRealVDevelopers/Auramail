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


const Chatbot: React.FC = () => {
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
    const [needsUserGesture, setNeedsUserGesture] = useState(false); // Changed to false to remove overlay
    
    // Add a ref to track if we've already set up speech recognition grammars
    const grammarSetupRef = useRef(false);
    
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
    
    // Ref to track if ResponsiveVoice is ready
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

    // Add voice diagnostics function
    const logVoiceDiagnostics = useCallback(() => {
        console.log('[VOICE] === Voice Diagnostics ===');
        
        // Check browser voices
        if ('speechSynthesis' in window) {
            const voices = speechSynthesis.getVoices();
            console.log(`[VOICE] Available browser voices: ${voices.length}`);
            
            // Check for specific language voices
            const hindiVoices = voices.filter(v => v.lang === 'hi-IN');
            const tamilVoices = voices.filter(v => v.lang === 'ta-IN');
            const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
            
            console.log(`[VOICE] Hindi voices: ${hindiVoices.length}`, hindiVoices.map(v => v.name));
            console.log(`[VOICE] Tamil voices: ${tamilVoices.length}`, tamilVoices.map(v => v.name));
            console.log(`[VOICE] English voices: ${englishVoices.length}`, englishVoices.slice(0, 3).map(v => v.name));
            
            // Check for Google voices specifically
            const googleHindiVoices = voices.filter(v => v.lang === 'hi-IN' && v.name.includes('Google'));
            const googleTamilVoices = voices.filter(v => v.lang === 'ta-IN' && v.name.includes('Google'));
            
            console.log(`[VOICE] Google Hindi voices: ${googleHindiVoices.length}`, googleHindiVoices.map(v => v.name));
            console.log(`[VOICE] Google Tamil voices: ${googleTamilVoices.length}`, googleTamilVoices.map(v => v.name));
            
            // If no voices are found, listen for the voiceschanged event
            if (voices.length === 0) {
                console.log('[VOICE] No voices available yet, waiting for voiceschanged event');
                const voicesChangedHandler = () => {
                    console.log('[VOICE] Voices changed event fired');
                    const newVoices = speechSynthesis.getVoices();
                    console.log(`[VOICE] Now available browser voices: ${newVoices.length}`);
                    
                    const newHindiVoices = newVoices.filter(v => v.lang === 'hi-IN');
                    const newTamilVoices = newVoices.filter(v => v.lang === 'ta-IN');
                    
                    console.log(`[VOICE] Now Hindi voices: ${newHindiVoices.length}`, newHindiVoices.map(v => v.name));
                    console.log(`[VOICE] Now Tamil voices: ${newTamilVoices.length}`, newTamilVoices.map(v => v.name));
                    
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
                const tamilFemaleVoice = responsiveVoices.find((v: any) => v.name === 'Tamil Female');
                console.log(`[VOICE] ResponsiveVoice Hindi Female voice available:`, hindiFemaleVoice);
                console.log(`[VOICE] ResponsiveVoice Tamil Female voice available:`, tamilFemaleVoice);
            } catch (error) {
                console.error('[VOICE] Error getting ResponsiveVoice voices:', error);
            }
        }
        
        // Check Puter.js
        const hasPuter = typeof (window as any).puter !== 'undefined';
        console.log(`[VOICE] Puter.js available: ${hasPuter}`);
        
        console.log('[VOICE] === End Voice Diagnostics ===');
    }, []);

    const playBeep = useCallback((type: 'start' | 'end' = 'start') => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            console.warn('[BEEP] AudioContext not available or closed.');
            return;
        }
        const context = audioContextRef.current;

        // Resume context if needed
        if (context.state === 'suspended') {
            context.resume().catch(err => console.error('[BEEP] Failed to resume AudioContext:', err));
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);

        // Different tones for start and end
        oscillator.frequency.value = type === 'start' ? 880 : 660;
        oscillator.type = 'sine';

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

    const speakText = useCallback((text: string, onComplete?: () => void) => {
        const currentLang = state.currentLanguage;
        console.log(`[TTS] Using browser TTS for ${currentLang} with text: ${text}`);
        speakWithBrowserTTS(text, currentLang, onComplete);
    }, [state.currentLanguage]);

    const speak = useCallback(async (text: string | React.ReactNode, onComplete?: () => void, skipTranscript = false) => {
        const textToSpeak = typeof text === 'string' ? text : ' '; // Only speak string content
        
        // Only add to transcript if not skipped
        if (!skipTranscript) {
            setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
        }
        
        stopSpeaking();
        
        const handleEnd = () => {
            // Play notification sound to indicate end of speaking
            playBeep('end');
            
            // Wait for 1 second before restarting listening
            setTimeout(() => {
                setChatbotStatus(isListening ? 'LISTENING' : 'IDLE');
                onComplete?.();
                if (!composeStateRef.current.active) {
                    setShouldRestartListening(true);
                }
            }, 1000);
        };

        if (isMuted || typeof text !== 'string') {
            handleEnd();
            return;
        }

        setChatbotStatus('SPEAKING');

        // Ensure AudioContext is initialized
        if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume().catch(console.error);
        }

        // Play start beep before speaking
        playBeep('start');
        
        // Small delay before speaking to allow beep to play
        setTimeout(() => {
            speakText(textToSpeak, handleEnd);
        }, 200);

    }, [isMuted, isListening, playBeep, stopSpeaking, speakText]);

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
        
        // Personality responses for greetings and common questions
        let personalityResponse = '';
        
        // Greetings
        if (lowerText.match(/^(hi|hello|hey|hai|ஹாய்|ஹலோ|ஹே|ஹை|नमस्ते|हैलो|हाय|হাই|হ্যালো|হে|হ্যালো)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN' 
                ? `नमस्ते! मैं आपका वॉक्समेल सहायक हूँ। मैं आपकी कैसे मदद कर सकता हूँ?`
                : state.currentLanguage === 'ta-IN'
                ? `ஹலோ! நான் உங்கள் வாக்ஸ்மெயில் உதவியாளர். நான் உங்களுக்கு எப்படி உதவ முடியும்?`
                : `Hello! I'm your VoxMail assistant. How can I help you today?`;
        }
        // Name inquiries
        else if (lowerText.match(/(what's your name|what is your name|who are you|உங்கள் பெயர் என்ன|நீங்கள் யார்|आपका नाम क्या है|आप कौन हैं|�पनार নাম কি|�পনি কে)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN'
                ? `मेरा नाम वॉक्समेल है। मैं आपका वॉयस-फर्स्ट ईमेल सहायक हूँ।`
                : state.currentLanguage === 'ta-IN'
                ? `என் பெயர் வாக்ஸ்மெயில். நான் உங்கள் குரல்-முதல் மின்னஞ்சல் உதவியாளர்.`
                : `My name is VoxMail. I'm your voice-first email assistant.`;
        }
        // Help inquiries
        else if (lowerText.match(/(how can you help|what can you do|what are you capable of|என்ன செய்ய முடியும்|நீங்கள் என்ன செய்ய முடியும்|आप क्या कर सकते हैं|�পনি কী করতে পারেন)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN'
                ? `मैं आपकी मदद कर सकता हूँ: ईमेल पढ़ने, नया ईमेल लिखने, इनबॉक्स, भेजे गए, ड्राफ्ट, स्पैम और कचरा फ़ोल्डर को प्रबंधित करने में। क्या आप कुछ खोलना चाहेंगे?`
                : state.currentLanguage === 'ta-IN'
                ? `நான் உங்களுக்கு உதவ முடியும்: மின்னஞ்சல்களைப் படிக்க, புதிய மின்னஞ்சல்களை எழுத, இன்பாக்ஸ், அனுப்பியவை, வரைவுகள், ஸ்பேம் மற்றும் குப்பை கோப்புறைகளை நிர்வகிக்க. ஏதாவது திறக்க விரும்புகிறீர்களா?`
                : `I can help you: read emails, compose new emails, and manage your inbox, sent, drafts, spam, and trash folders. Would you like to open something?`;
        }
        // Thank you responses
        else if (lowerText.match(/(thank you|thanks|धन्यवाद|நன்றி)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN'
                ? `आपका स्वागत है! क्या मैं आपकी और किसी और चीज़ में मदद कर सकता हूँ?`
                : state.currentLanguage === 'ta-IN'
                ? `நல்வரவு! நான் உங்களுக்கு வேறு ஏதேனும் உதவ முடியுமா?`
                : `You're welcome! Can I help you with anything else?`;
        }
        // Goodbye responses
        else if (lowerText.match(/(bye|goodbye|see you|நாளை|bye|अलविदा)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN'
                ? `अलविदा! जब भी आपको ईमेल की आवश्यकता हो, मुझे बुलाएं!`
                : state.currentLanguage === 'ta-IN'
                ? `பின்னர் சந்திப்போம்! உங்களுக்கு மின்னஞ்சல் தேவைப்படும் போது என்னை அழைக்கவும்!`
                : `Goodbye! Call me whenever you need email assistance!`;
        }
        // How are you responses
        else if (lowerText.match(/(how are you|how do you do|நீங்கள் எப்படி இருக்கிறீர்கள்|आप कैसे हैं)/)) {
            personalityResponse = state.currentLanguage === 'hi-IN'
                ? `मैं बहुत अच्छा हूँ, धन्यवाद! मैं आपकी ईमेल की मदद करने के लिए यहाँ हूँ।`
                : state.currentLanguage === 'ta-IN'
                ? `நான் நன்றாக இருக்கிறேன், நன்றி! உங்கள் மின்னஞ்சலுக்கு உதவ நான் இங்கே இருக்கிறேன்.`
                : `I'm doing great, thank you! I'm here to help with your email.`;
        }
        
        // If we have a personality response, use it and return early
        if (personalityResponse) {
            await speak(personalityResponse, () => {
                setShouldRestartListening(true);
            });
            setChatbotStatus('IDLE');
            return;
        }
        
        // Multilingual keyword-based command matching
        let response = '';
        let action: (() => void) | null = null;
        
        // Open Inbox commands (English, Hindi, Tamil)
        if (lowerText.match(/inbox|இன்பாக்ஸ்/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.INBOX });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.INBOX) : 0;
                response = t('openingFolderUnreadCount', { folder: t('inbox'), count });
            }
            // Open Sent commands (English, Hindi, Tamil)
            else if (lowerText.match(/sent|அனுப்பியவை|sent items|அனுப்பப்ட்டது/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.SENT) : 0;
                response = t('openingFolderUnreadCount', { folder: t('sent'), count });
            }
            // Open Drafts commands (English, Hindi, Tamil)
            else if (lowerText.match(/draft|வரைவு/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.DRAFTS });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.DRAFTS) : 0;
                response = t('openingFolderUnreadCount', { folder: t('drafts'), count });
            }
            // Open Spam commands (English, Hindi, Tamil)
            else if (lowerText.match(/spam|ஸ்பேம்/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.SPAM });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.SPAM) : 0;
                response = t('openingFolderUnreadCount', { folder: t('spam'), count });
            }
            // Open Trash commands (English, Hindi, Tamil)
            else if (lowerText.match(/trash|குப்பை/)) {
                dispatch({ type: 'SELECT_FOLDER', payload: Folder.TRASH });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, Folder.TRASH) : 0;
                response = t('openingFolderUnreadCount', { folder: t('trash'), count });
            }
            // Compose email commands (English, Hindi, Tamil)
            else if (lowerText.match(/compose|புதிய மின்னஞ்சல்|எழுது|அனுப்பு/)) {
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                response = t('composeRecipientPrompt');
            }
            // Read first email (English, Hindi, Tamil)
            else if (lowerText.match(/read|open|படி|திற/)) {
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
            // Read second email (English, Hindi, Tamil)
            else if (lowerText.match(/read|open|படி|திற/) && lowerText.match(/second|2nd|two|2|இரண்டாவது/)) {
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
            // Read third email (English, Hindi, Tamil)
            else if (lowerText.match(/read|open|படி|திற/) && lowerText.match(/third|3rd|three|3|மூன்றாவது/)) {
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
            // Delete email commands (English, Hindi, Tamil)
            else if (lowerText.match(/delete|remove|நீக்கு/) && state.selectedEmail) {
                if (state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: state.selectedEmail.id });
                    response = state.currentLanguage === 'hi-IN' ? 'ईमेल कचरे में भेज दिया गया।' :
                               state.currentLanguage === 'ta-IN' ? 'மின்னஞ்சல் குப்பைக்கு நகர்த்தப்பட்டது.' :
                               state.currentLanguage === 'kn-IN' ? 'ಇಮೇಲ್ ಅನ್ನು ಕಸದ ಬುಟ್ಟಿಗೆ ಸರಿಸಲಾಗಿದೆ.' :
                               'Email moved to trash.';
                }
            }
            // Mark as spam commands (English, Hindi, Tamil)
            else if (lowerText.match(/spam|junk|ஸ்பேம்/) && state.selectedEmail && !lowerText.match(/open|folder/)) {
                if (state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: state.selectedEmail.id });
                    response = state.currentLanguage === 'hi-IN' ? 'ईमेल को स्पैम चिह्नित किया गया।' :
                               state.currentLanguage === 'ta-IN' ? 'மின்னஞ்சல் ஸ்பேம் எனக் குறிக்கப்பட்டது.' :
                               state.currentLanguage === 'kn-IN' ? 'ಇಮೇಲ್ ಅನ್ನು ಸ್ಪ್ಯಾಮ್ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ.' :
                               'Email marked as spam.';
                }
            }
            // Logout commands (English, Hindi, Tamil)
            else if (lowerText.match(/logout|log out|sign out|வெளியேறு/)) {
                response = t('signingOut');
                setTimeout(() => auth.signOut(), 1000);
            }
            // Change to English (any language)
            else if (lowerText.match(/english|அங்கிலம்/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'en-US' });
                response = 'Language switched to English.';
            }
            // Change to Hindi (any language)
            else if (lowerText.match(/hindi|हिन्दी|हिंदी/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'hi-IN' });
                response = 'भाषा हिन्दी में बदल दी गई है।';
            }
            // Change to Kannada (any language)
            else if (lowerText.match(/kannada|कन्नड़|ಕನ್ನಡ/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'kn-IN' });
                response = 'ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ.';
            }
            // Change to Tamil (any language)
            else if (lowerText.match(/tamil|தமிழ்/)) {
                dispatch({ type: 'SET_LANGUAGE', payload: 'ta-IN' });
                response = 'மொழி தமிழுக்கு மாற்றப்பட்டது.';
            }
            // Help command (English, Hindi, Tamil)
            else if (lowerText.match(/help|what can|commands|உதவி/)) {
                response = t('welcomeMessage');
            }
            // Stop reading commands (English, Hindi, Tamil)
            else if (lowerText.match(/stop|நிறுத்து/)) {
                stopSpeaking();
                setChatbotStatus('IDLE');
                response = t('stopped');
            }
            // Unknown command - respond in current language
            else {
                if (state.currentLanguage === 'hi-IN') {
                    response = "मुझे समझ नहीं आया। कृपया 'इनबॉक्स खोलो', 'पहला ईमेल पढ़ो', 'नया ईमेल लिखो', या 'मदद' कहें।";
                } else if (state.currentLanguage === 'ta-IN') {
                    response = "எனக்கு புரியவில்லை. 'இன்பாக்ஸ் திற', 'முதல் மின்னஞ்சலைப் படி', 'புதிய மின்னஞ்சல் எழுது', அல்லது 'உதவி' என்று சொல்லவும்.";
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
            
            if (!composeStateRef.current.active) {
                setChatbotStatus('IDLE');
            }
    }, [state.currentFolder, state.emails, state.selectedEmail, state.currentLanguage, state.userProfile, handleComposeInput, speak, dispatch, t, stopSpeaking]);

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
            // If already enabled, just speak the welcome message
            const welcomeMsg = t('welcomeMessage');
            speak(welcomeMsg, () => {
                setShouldRestartListening(true);
            });
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
            
            // Set language for the welcome message
            utterance.lang = state.currentLanguage;
            console.log(`[ENABLE] Setting welcome message language to: ${state.currentLanguage}`);
            
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
                
                // Start listening after beep and 1 second delay
                setTimeout(() => {
                    console.log('[ENABLE] Starting voice recording');
                    setShouldRestartListening(true);
                }, 1000);
            };
            
            utterance.onerror = (event) => {
                console.error('[ENABLE] Speech error:', event);
                setChatbotStatus('IDLE');
                // Still try to start listening
                setTimeout(() => {
                    setShouldRestartListening(true);
                }, 1000);
            };

            console.log('[ENABLE] Calling speechSynthesis.speak()');
            speechSynthesis.speak(utterance);
        } catch (error) {
            console.error('[ENABLE] Failed to speak:', error);
            // Fallback: just start listening
            setTimeout(() => {
                setShouldRestartListening(true);
            }, 1000);
        }
    }, [t, needsUserGesture, logVoiceDiagnostics, state.currentLanguage, speak]); // Add state.currentLanguage as dependency
    
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
            recognition.maxAlternatives = 1;

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
                // Restart listening after error
                setTimeout(() => {
                    setShouldRestartListening(true);
                }, 1000);
            };
            recognition.onstart = () => {
                setIsListening(true);
                setChatbotStatus('LISTENING');
            };
            recognition.onend = () => {
                setIsListening(false);
                setChatbotStatus('IDLE');
                // Automatically restart listening when it ends
                if (!composeStateRef.current.active) {
                    setShouldRestartListening(true);
                }
            };
        }

        recognitionRef.current.lang = state.currentLanguage;
        console.log(`[STT] Setting recognition language to: ${state.currentLanguage}`);
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
            
            // Automatically speak the welcome message
            setTimeout(() => {
                handleEnableVoice();
            }, 500);
            
            // Log voice diagnostics on initialization
            logVoiceDiagnostics();
        }
    }, []); // Run once on mount
    
    useEffect(() => {
        return () => { 
            stopSpeaking();
            if (recognitionRef.current) {
                recognitionRef.current.onend = null; // Prevent onend from firing during cleanup
                recognitionRef.current.stop();
            }
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
            }, 500);
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
            className="fixed flex flex-col bg-white rounded-xl shadow-2xl border-2 border-blue-500" 
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
                    <button onClick={toggleListening} className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`} title={isListening ? 'Stop Listening' : 'Start Listening'}>
                        {isListening ? <PauseIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
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
                        placeholder={isListening ? 'Listening...' : 'Type a message or command...'}
                        className="flex-1 w-full bg-blue-50 border-2 border-blue-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 rounded-full"
                        disabled={isListening}
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