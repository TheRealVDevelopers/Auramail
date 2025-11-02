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
    }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { SUPPORTED_LANGUAGES } from '../constants';
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
    
    const [composeState, setComposeState] = useState<{
        active: boolean;
        step: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '';
        draft: Partial<Email>;
        fieldToChange: 'recipient' | 'subject' | 'body' | '';
    }>({ active: false, step: '', draft: {}, fieldToChange: '' });
    
    // Refs for async operations and cleanup
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const spokenWelcome = useRef(false);
    
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

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
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }, []);

    const speak = useCallback((text: string | React.ReactNode) => {
        return new Promise<void>((resolve) => {
            const textToSpeak = typeof text === 'string' ? text : ' '; // Only speak string content
            setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
            stopSpeaking();
            
            const handleEnd = () => {
                setChatbotStatus(isListening ? 'LISTENING' : 'IDLE');
                playBeep();
                resolve();
            };
    
            if (isMuted || typeof text !== 'string' || !('speechSynthesis' in window)) {
                if (!('speechSynthesis' in window)) console.error("Browser does not support Speech Synthesis.");
                handleEnd();
                return;
            }
    
            setChatbotStatus('SPEAKING');
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.lang = state.currentLanguage;
            utterance.onend = handleEnd;
            utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
                // Only log errors that are not interruptions, as they are expected.
                if (e.error !== 'interrupted') {
                    console.error("SpeechSynthesis Error:", e.error);
                }
                // The 'onend' event will fire after 'onerror', so we don't call handleEnd() here.
            };
            speechSynthesis.speak(utterance);
        });
    }, [isMuted, isListening, playBeep, stopSpeaking, state.currentLanguage]);

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
        
        const newState: typeof composeState = shouldContinue 
            ? { active: true, step: nextStep, draft: updatedDraft, fieldToChange: nextFieldToChange }
            : { active: false, step: '', draft: {}, fieldToChange: '' };
        
        setComposeState(newState);
    }, [state.userProfile, dispatch, speak, t]);

    const processTranscript = useCallback(async (text: string) => {
        if (!text) return;
        setLiveTranscript('');
    
        if (composeStateRef.current.active) {
            await handleComposeInput(text);
            return;
        }
    
        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');
        
        const lowerText = text.toLowerCase().trim();
        let resultText = "Sorry, I didn't understand that command. You can say things like 'open inbox' or 'compose an email'.";
    
        const folderKeywords: { [key in Folder]?: string[] } = {
            [Folder.INBOX]: ['inbox'],
            [Folder.SENT]: ['sent', 'sentbox'],
            [Folder.DRAFTS]: ['drafts', 'draft'],
            [Folder.SPAM]: ['spam', 'junk'],
            [Folder.TRASH]: ['trash', 'bin', 'deleted'],
        };
    
        let commandHandled = false;
    
        for (const [folder, keywords] of Object.entries(folderKeywords)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                dispatch({ type: 'SELECT_FOLDER', payload: folder as Folder });
                const count = state.userProfile ? await getUnreadCount(state.userProfile.uid, folder as Folder) : 0;
                resultText = t('openingFolderUnreadCount', { folder: t(folder.toLowerCase() as keyof ReturnType<typeof useTranslations>), count });
                commandHandled = true;
                break;
            }
        }
    
        if (!commandHandled) {
            if (lowerText.startsWith('read')) {
                const match = lowerText.match(/\d+|first|second|third|fourth|fifth/);
                if (match) {
                    let index = -1;
                    const wordMap: { [key: string]: number } = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
                    index = wordMap[match[0]] || parseInt(match[0], 10);
                    
                    if (index > 0 && state.emails.length >= index) {
                        const emailToRead = state.emails[index - 1];
                        dispatch({ type: 'SELECT_EMAIL', payload: emailToRead.id });
                        if (!emailToRead.read && state.userProfile) {
                            markEmailAsRead(state.userProfile.uid, emailToRead.id).catch(console.error);
                            dispatch({ type: 'MARK_AS_READ', payload: emailToRead.id });
                        }
                        const bodyText = emailToRead.body.replace(/<[^>]*>?/gm, '\n');
                        resultText = `${t('readingEmailFrom', { sender: emailToRead.sender })}. ${t('subject')}: ${emailToRead.subject}. ${t('bodyStartsNow')}. ${bodyText}`;
                    } else {
                        resultText = t('emailNotFoundAtIndex', { index });
                    }
                } else {
                    resultText = "Please specify which email to read, for example: 'read the first email'.";
                }
            } else if (lowerText.includes('compose') || lowerText.includes('new email') || lowerText.includes('write')) {
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                resultText = t('composeRecipientPrompt');
            } else if (lowerText.includes('delete')) {
                if (state.selectedEmail && state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: state.selectedEmail.id });
                    resultText = 'Email moved to trash.';
                } else {
                    resultText = 'Please select an email to delete first.';
                }
            } else if (lowerText.includes('mark as spam')) {
                if (state.selectedEmail && state.userProfile) {
                    await updateEmailFolder(state.userProfile.uid, state.selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: state.selectedEmail.id });
                    resultText = 'Email marked as spam.';
                } else {
                    resultText = 'Please select an email first.';
                }
            } else if (lowerText.includes('stop') || lowerText.includes('shut up')) {
                stopSpeaking();
                resultText = t('stopped');
            } else if (lowerText.includes('logout') || lowerText.includes('sign out')) {
                auth.signOut().catch(error => console.error("Logout from chatbot failed", error));
                resultText = t('signingOut');
            }
        }
    
        await speak(resultText);
    
        if (!composeStateRef.current.active) {
            setChatbotStatus('IDLE');
        }
    }, [state, dispatch, speak, handleComposeInput, t, stopSpeaking]);

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (text) {
            setInputValue('');
            await processTranscript(text);
        }
    };
    
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
                if (event.error === 'no-speech') {
                    speak("I didn't hear anything. Please try again when you're ready.");
                } else {
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
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        if (!spokenWelcome.current && !isMuted) {
            spokenWelcome.current = true;
            speak(t('welcomeMessage'));
        }

    }, [isMuted, speak, t]);

    useEffect(() => {
        return () => { 
            stopSpeaking();
            recognitionRef.current?.stop();
            audioContextRef.current?.close().catch(console.error);
        };
    }, [stopSpeaking]);

    const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
        const target = e.target as Node;
        const element = target.nodeType === Node.TEXT_NODE ? target.parentElement : (target as Element);
        if (element?.closest('button')) return;
        
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
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
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