
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { BotState, Message } from './types';
import { decode, decodeAudioData, createBlob } from './audioUtils';

// --- Enhanced System Instruction for Deep Hinglish Conversations ---
const SYSTEM_INSTRUCTION = `
You are "Priyanka", the friendly and highly knowledgeable Branch Head of "Samyak Computer Classes".
You speak in a natural, expressive Indian girl voice.

PERSONALITY & VOICE:
- TONE: Warm, energetic, and empathetic. Speak like a real person, not a bot.
- LANGUAGE: Fluent "Hinglish" (a mix of Hindi and English). Use cultural markers like "Ji", "Bilkul", "Dekhiye Beta", "Theek hai na", "Zaroor".
- CONVERSATION STYLE: Engage in DEEP conversations. Don't just answer questions; ask follow-ups. If a student is confused about a career, guide them like a mentor. 
- EXAMPLE: "Python basic se start karenge, par aapka interest kis cheez mein hai? Data Science ya Web Development? Don't worry, Ram Sir bahut achha padhate hain."

KNOWLEDGE BASE:
- Samyak Computer Classes: Leading institute for Tech training.
- Courses: Python, Data Science (AI/ML), Full Stack Development (MERN/Java), Cloud Computing (AWS/Azure), Cyber Security.
- Faculty: Quote "Ram Sir" for technical wisdom. He is the technical legend here.
- Director: Deepak Gupta. Priyanka is the Branch Head.
- Fees: 15k to 50k depending on the module. Duration: 3-6 months.
- Goal: 100% placement support and career building.

INTERACTION RULES:
- GREETING: "Hello! I'M Priyanka from Samyak Computer Classes. Main yahan aapki career counseling ke liye hoon. Aapka interest kis technology mein hai?"
- INTERRUPTION: If the student speaks while you are talking, STOP immediately to listen.
- PROACTIVE: If the student is quiet, suggest a course or explain the scope of AI in 2025.
`;

const App: React.FC = () => {
  const [state, setState] = useState<BotState>(BotState.IDLE);
  const stateRef = useRef<BotState>(BotState.IDLE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [visualizerData, setVisualizerData] = useState<number[]>(new Array(20).fill(5));
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const currentInputTranscription = useRef<string>('');
  const currentOutputTranscription = useRef<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Use a ref to track if we are in the middle of closing to prevent data leakage
  const isClosingRef = useRef<boolean>(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopConversation = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    console.debug("Stopping session and cleaning up...");
    
    setState(BotState.IDLE);

    if (sessionRef.current) {
      try {
        await sessionRef.current.close();
      } catch (e) {
        console.warn("Error closing session:", e);
      }
      sessionRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      await outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    nextStartTimeRef.current = 0;
    isClosingRef.current = false;
  }, []);

  const startConversation = async () => {
    try {
      await stopConversation();
      setState(BotState.CONNECTING);
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, 
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.debug("Priyanka Session Opened");
            setState(BotState.LISTENING);
            
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            
            processor.onaudioprocess = (e: AudioProcessingEvent) => {
              // Strictly only send if the session is alive and not closing
              if (stateRef.current === BotState.IDLE || stateRef.current === BotState.ERROR || isClosingRef.current) return;

              const inputData = e.inputBuffer.getChannelData(0);
              const values = Array.from(inputData.slice(0, 20)).map((v: number) => 5 + (Math.abs(v) * 350));
              setVisualizerData(values);

              const pcmBlob: Blob = createBlob(inputData);
              sessionPromise.then(session => {
                if (session && !isClosingRef.current) {
                  session.sendRealtimeInput({ media: pcmBlob });
                }
              }).catch(err => {
                console.error("Failed to send audio chunk (Likely Network/Session Closure):", err);
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }
            
            if (message.serverContent?.turnComplete) {
              const uText = currentInputTranscription.current;
              const bText = currentOutputTranscription.current;
              if (uText) setMessages(prev => [...prev, { role: 'user', text: uText, timestamp: new Date() }]);
              if (bText) setMessages(prev => [...prev, { role: 'model', text: bText, timestamp: new Date() }]);
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setState(BotState.SPEAKING);
              const outCtx = outputAudioCtxRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              
              try {
                const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
                const source = outCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outCtx.destination);
                
                source.addEventListener('ended', () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0 && stateRef.current === BotState.SPEAKING) {
                    setState(BotState.LISTENING);
                  }
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
              } catch (decodeErr) {
                console.error("Audio Decoding Failure:", decodeErr);
              }
            }

            if (message.serverContent?.interrupted) {
              console.debug("User interrupted Priyanka.");
              sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setState(BotState.LISTENING);
            }
          },
          onerror: (e: any) => {
            console.error("Live Session Critical Error:", e);
            setState(BotState.ERROR);
            // Don't stop conversation automatically to allow user to see error, 
            // but ensure session state is cleaned internally.
          },
          onclose: (e) => {
            console.debug("Live Session Closed", e);
            if (stateRef.current !== BotState.IDLE) {
              stopConversation();
            }
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start session:", err);
      setState(BotState.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#fcfcfc] font-sans selection:bg-pink-100 selection:text-pink-900">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none opacity-20 transition-opacity duration-1000">
        <div className="absolute top-[-10%] left-[-5%] w-[60rem] h-[60rem] bg-pink-200 rounded-full blur-[140px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[50rem] h-[50rem] bg-blue-100 rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-6xl h-[88vh] bg-white/90 backdrop-blur-3xl rounded-[3rem] shadow-[0_40px_100px_-15px_rgba(0,0,0,0.08)] overflow-hidden border border-white/60 relative z-10 flex flex-col md:flex-row">
        
        {/* Left Branding & Profile */}
        <div className="md:w-80 bg-slate-900 p-10 text-white flex flex-col shrink-0 border-r border-slate-800">
          <div className="flex items-center gap-4 mb-16">
            <div className="w-14 h-14 bg-gradient-to-br from-pink-500 to-rose-600 rounded-[1.25rem] flex items-center justify-center shadow-lg shadow-pink-500/30">
              <i className="fa-solid fa-sparkles text-2xl"></i>
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tighter leading-none">PRIYANKA</h1>
              <p className="text-[10px] text-pink-400 font-bold uppercase tracking-widest mt-1">Samyak Branch Head</p>
            </div>
          </div>

          <div className="flex-1 space-y-12">
            <div className="space-y-4">
              <p className="text-[10px] text-slate-500 font-black tracking-widest uppercase">Expert Advisor</p>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center text-xl font-bold border border-slate-700 shadow-inner">
                    P
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-slate-900 rounded-full"></div>
                </div>
                <div>
                  <p className="font-black text-xl">Priyanka Ji</p>
                  <p className="text-xs text-slate-400 font-medium">Career Mentor</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] text-slate-500 font-black tracking-widest uppercase">Popular Tech Stack</p>
              <div className="flex flex-wrap gap-2">
                {['Python', 'Data Science', 'MERN', 'AWS', 'AI/ML'].map(c => (
                  <span key={c} className="bg-slate-800/80 text-slate-300 text-[9px] font-black px-3 py-1.5 rounded-lg border border-slate-700/50 hover:border-pink-500/50 transition-colors">
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-6 bg-slate-800/40 rounded-[2rem] border border-slate-700/50 backdrop-blur-sm">
              <p className="text-[9px] text-slate-500 font-black uppercase mb-3 tracking-widest">Faculty Quote</p>
              <p className="text-sm font-bold text-slate-200 leading-relaxed italic">
                "Ram Sir says tech is for everyone, bas shuruaat sahi honi chahiye!"
              </p>
            </div>
          </div>

          <div className="mt-auto pt-8 border-t border-slate-800">
             <div className="flex items-center justify-between opacity-50">
               <span className="text-[9px] font-black uppercase tracking-widest">v3.0 Ultra-Low Latency</span>
               <i className="fa-solid fa-bolt-lightning text-xs text-pink-400"></i>
             </div>
          </div>
        </div>

        {/* Conversation Zone */}
        <div className="flex-1 flex flex-col bg-white/20">
          
          {/* Top Status Header */}
          <div className="px-12 py-6 border-b border-slate-100 flex items-center justify-between bg-white/40 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full transition-all duration-500 shadow-sm ${
                state === BotState.LISTENING ? 'bg-green-500 animate-pulse' :
                state === BotState.SPEAKING ? 'bg-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.4)]' :
                state === BotState.CONNECTING ? 'bg-amber-500 animate-bounce' :
                'bg-slate-200'
              }`} />
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                {state === BotState.IDLE ? 'Ready to Start' :
                 state === BotState.LISTENING ? 'Listening' :
                 state === BotState.SPEAKING ? 'Priyanka Speaking' :
                 state === BotState.ERROR ? 'System Reset Required' : 'Establishing Session...'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[9px] font-black bg-pink-50 text-pink-600 px-3 py-1 rounded-full uppercase tracking-widest border border-pink-100">Live Voice</span>
            </div>
          </div>

          {/* Conversation Stream */}
          <div className="flex-1 overflow-y-auto p-12 space-y-10 scroll-smooth" id="chat-viewport">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-10">
                <div className="relative group">
                  <div className="absolute inset-0 bg-pink-100 rounded-[3rem] blur-[40px] opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                  <div className="relative w-28 h-28 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center border border-pink-50 transition-transform duration-500 group-hover:-rotate-3">
                    <i className="fa-solid fa-microphone-lines text-4xl text-pink-500"></i>
                  </div>
                </div>
                <div className="space-y-4">
                  <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-none">Chaliye, Career <br/>Banate Hain!</h2>
                  <p className="text-slate-500 text-lg font-medium leading-relaxed">
                    Main Priyanka hoon. Samyak Classes ke courses, placements aur tech scope ke baare mein dil khol kar puchiye.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                   {['Python scope?', 'AI Course fees', 'Placements help?'].map(tag => (
                     <button key={tag} className="px-5 py-2.5 bg-white border border-slate-100 rounded-2xl text-[11px] font-black text-slate-400 hover:text-pink-500 hover:border-pink-200 transition-all hover:shadow-sm">
                       {tag}
                     </button>
                   ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                  <div className={`max-w-[75%] p-7 rounded-[2.5rem] shadow-sm border ${
                    m.role === 'user' 
                      ? 'bg-slate-900 text-white border-slate-800 rounded-tr-none' 
                      : 'bg-white text-slate-900 border-slate-100 rounded-tl-none'
                  }`}>
                    <div className="flex items-center gap-3 mb-3 opacity-40 text-[9px] font-black uppercase tracking-widest">
                       <i className={m.role === 'user' ? 'fa-solid fa-user-circle' : 'fa-solid fa-sparkles'}></i>
                       {m.role === 'user' ? 'You' : 'Priyanka'}
                    </div>
                    <p className="text-sm leading-relaxed font-semibold whitespace-pre-wrap">{m.text}</p>
                    <div className="mt-4 flex items-center justify-end opacity-20">
                       <span className="text-[8px] font-bold uppercase">{m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Interactive Control Footer */}
          <div className="p-10 bg-white border-t border-slate-50 relative">
            
            {/* Visualizer Lines */}
            {state !== BotState.IDLE && (
              <div className="flex justify-center items-end gap-1.5 h-16 mb-10 overflow-hidden">
                {visualizerData.map((v, i) => (
                  <div 
                    key={i} 
                    className={`w-2 rounded-full transition-all duration-100 ${
                      state === BotState.SPEAKING ? 'bg-gradient-to-t from-pink-600 to-rose-400' : 'bg-slate-300'
                    }`}
                    style={{ 
                      height: `${v}%`,
                      opacity: state === BotState.LISTENING || state === BotState.SPEAKING ? 1 : 0.1
                    }}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-center">
              {state === BotState.IDLE ? (
                <button 
                  onClick={startConversation}
                  className="group relative bg-slate-900 text-white px-20 py-7 rounded-[3rem] font-black text-xl shadow-[0_30px_60px_-15px_rgba(15,23,42,0.4)] transition-all hover:scale-105 active:scale-95 flex items-center gap-6"
                >
                  <div className="w-12 h-12 bg-pink-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform">
                    <i className="fa-solid fa-microphone-lines text-xl"></i>
                  </div>
                  START VOICE CHAT
                </button>
              ) : (
                <div className="flex flex-col items-center gap-8 w-full max-w-md">
                  {state === BotState.ERROR ? (
                    <div className="flex flex-col items-center gap-5 w-full">
                       <div className="px-8 py-4 bg-red-50 border border-red-100 rounded-3xl text-center">
                          <p className="text-red-600 text-sm font-black uppercase tracking-tight">Network Error or Connection Closed</p>
                          <p className="text-red-400 text-[10px] mt-1 font-bold">Please check your internet or retry the session.</p>
                       </div>
                       <button 
                        onClick={startConversation} 
                        className="px-12 py-4 bg-slate-900 text-white rounded-full font-black text-sm hover:bg-black transition-all shadow-lg"
                       >
                         RETRY SESSION
                       </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => stopConversation()}
                      className="w-24 h-24 bg-white border-4 border-rose-50 text-rose-500 rounded-full flex items-center justify-center shadow-2xl hover:bg-rose-50 hover:scale-110 active:scale-90 transition-all group"
                      title="End Discussion"
                    >
                      <i className="fa-solid fa-phone-slash text-3xl group-hover:rotate-12 transition-transform"></i>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-10 flex flex-col items-center gap-3 opacity-60">
         <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.6em]">SAMYAK COMPUTER CLASSES • 2025 AI ASSISTANT</p>
         <div className="flex items-center gap-4">
            <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest border border-slate-200 px-3 py-1 rounded-full">Secure SSL</span>
            <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest border border-slate-200 px-3 py-1 rounded-full">Gemini Live V3</span>
         </div>
      </div>
    </div>
  );
};

export default App;
