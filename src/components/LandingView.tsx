import React from 'react';
import { motion } from 'motion/react';
import { Layers, Sparkles as SparklesIcon, Globe, RefreshCcw, Bot, Check, Camera, Mic, MicOff } from 'lucide-react';
import type { ClarificationQuestion, Session } from '../types';

export const LandingView: React.FC<{
  prompt: string;
  setPrompt: (s: string) => void;
  cloneUrl: string;
  setCloneUrl: (s: string) => void;
  isUrlMode: boolean;
  setIsUrlMode: (b: boolean) => void;
  clarifications: ClarificationQuestion[];
  setClarifications: (c: ClarificationQuestion[]) => void;
  status: string;
  isClarifying: boolean;
  isAnalyzing: boolean;
  cloneProgress: number;
  handleCloneFromUrl: () => void;
  askClarifications: (s: string) => Promise<void>;
  submitClarifications: () => void;
  sessions: Session[];
  loadSession: (s: Session) => void;
  createSession: (name?: string) => Promise<Session | undefined>;
  user: any;
  signInWithGoogle: () => void;
  signInWithGithub: () => void;
  logout: () => void;
  authLoading: boolean;
  setStatus: (s: string) => void;
  rectifiedPrompt: string;
  handleApproveAndBuild: () => void;
  startNewProject: () => void;
  onScreenshotBuild: (prompt: string) => void;
}> = ({ prompt, setPrompt, cloneUrl, setCloneUrl, isUrlMode, setIsUrlMode, clarifications, setClarifications, status, isClarifying, isAnalyzing, cloneProgress, handleCloneFromUrl, askClarifications, submitClarifications, sessions, loadSession, createSession, user, signInWithGoogle, signInWithGithub, logout, authLoading, setStatus, rectifiedPrompt, handleApproveAndBuild, startNewProject, onScreenshotBuild }) => {
  const screenshotInputRef = React.useRef<HTMLInputElement>(null);
  const [screenshotPreview, setScreenshotPreview] = React.useState<string|null>(null);
  const [isAnalyzingScreenshot, setIsAnalyzingScreenshot] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const mime = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
      const base64 = dataUrl.split(',')[1];
      setScreenshotPreview(dataUrl);
      setIsAnalyzingScreenshot(true);
      try {
        const res = await fetch('/api/proxy/openrouter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemma-4-31b-it:free',
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                { type: 'text', text: 'Analyze this UI screenshot in exhaustive technical detail. Describe: exact layout structure, color palette (provide hex codes), typography (font sizes, weights), spacing, every component visible, interactions, and animations. Then output a complete React 19 + Tailwind CSS implementation specification that would recreate this UI pixel-accurately.' }
              ]
            }],
            max_tokens: 2000
          })
        });
        const data = await res.json();
        const analysisPrompt = data.choices?.[0]?.message?.content || '';
        onScreenshotBuild(`SCREENSHOT-TO-CODE TARGET — Build this UI exactly:\n\n${analysisPrompt}`);
      } catch (err) {
        console.error('Screenshot analysis failed', err);
      } finally {
        setIsAnalyzingScreenshot(false);
        setScreenshotPreview(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');
        try {
          const res = await fetch('/api/voice/transcribe', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.text) {
            setPrompt(prev => prev + (prev ? ' ' : '') + data.text);
          }
        } catch (err) {
          console.error('Transcription failed', err);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch (err) {
      console.error('Microphone access denied', err);
    }
  };


  return (
    <div className="min-h-screen bg-[#f7f6f2] text-[#2d2d2d] flex flex-col md:flex-row font-sans">
      {/* Session Sidebar */}
      <div className="w-full md:w-80 bg-[#f9f8f5] border-r border-alpha p-8 flex flex-col shadow-warm">
         <div className="flex justify-between items-center mb-10">
            <h2 className="text-xl font-bold flex items-center gap-2 font-display"><Layers className="w-5 h-5 text-[#01696f]" /> Projects</h2>
            <button onClick={() => createSession()} className="p-2 hover:bg-[#efebe3] rounded-[8px] premium-transition border border-transparent hover:border-alpha"><SparklesIcon className="w-4 h-4 text-[#01696f]" /></button>
         </div>
         <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
            {sessions.length === 0 && (
              <div className="py-12 px-4 text-center border-2 border-dashed border-alpha rounded-[12px] opacity-40">
                 <p className="text-xs font-bold uppercase tracking-widest leading-loose">No active clusters found</p>
              </div>
            )}
            {sessions.map(s => (
              <div key={s.id} onClick={() => loadSession(s)} className="p-4 bg-[#f7f6f2] border border-alpha rounded-[12px] cursor-pointer premium-transition hover:translate-x-1 hover:border-[#01696f]/30 group">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-[13px] truncate pr-2 group-hover:text-[#01696f] premium-transition">{s.name}</h4>
                  <span className="text-[9px] font-bold text-[#6b6b6b] opacity-40 uppercase tracking-tighter">{new Date(s.last_modified).toLocaleDateString()}</span>
                </div>
                <div className="text-[10px] text-[#6b6b6b] font-medium opacity-60">Sovereign Runtime Cluster</div>
              </div>
            ))}
         </div>
         <div className="mt-8 pt-8 border-t border-alpha">
           <div className="p-4 bg-[#01696f]/5 rounded-[12px] border border-[#01696f]/10">
             <p className="text-[10px] font-bold text-[#01696f] uppercase tracking-widest mb-1">State Integrity</p>
             <p className="text-[10px] text-[#01696f]/60 font-medium leading-relaxed">SQLite persistence actively caching agentic state trees across session cycles.</p>
           </div>
         </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-y-auto custom-scrollbar pb-64">
         <nav className="p-8 flex justify-between items-center sticky top-0 bg-[#f7f6f2]/80 backdrop-blur-[12px] z-20 border-b border-alpha transition-all duration-300">
            <h1 className="text-2xl font-bold tracking-tight cursor-pointer flex items-center gap-3 font-display">
                <div onClick={startNewProject} className="flex items-center gap-3"><span className="w-6 h-6 text-[#01696f]">■</span> AI Architect</div>
            </h1>
            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-3">
                <img src={user.photoURL || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.displayName || user.email || user.uid)}`} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full object-cover border border-alpha" />
                <span className="text-sm font-bold max-w-32 truncate">{user.displayName || user.email || 'Signed in'}</span>
              </div>
               <button onClick={startNewProject} className="text-sm font-bold px-6 py-2.5 bg-[#f9f8f5] border border-alpha hover:bg-[#efebe3] shadow-warm rounded-[8px] premium-transition">New Project</button>
            </div>
         </nav>

         <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto text-left py-24 px-8">
           <motion.h2 initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="text-6xl sm:text-7xl font-bold mb-10 tracking-tight text-[#2d2d2d] font-display">Build, <span className="text-[#01696f]">Intelligently.</span></motion.h2>
           <p className="text-xl text-[#6b6b6b] mb-20 max-w-2xl leading-relaxed font-medium">Harness multi-model distribution. Route infrastructure generation to NVIDIA NIM and edge UI creation to OpenRouter with seamless state orchestration.</p>

            <div className="bg-[#f9f8f5] p-12 rounded-[12px] shadow-warm border border-alpha mb-16 text-left relative overflow-hidden group premium-transition hover:shadow-lg stagger-fade-in">
              <h3 className="font-bold text-3xl mb-6 text-[#2d2d2d] relative z-10 font-display">Elastic Full-Stack Orchestration</h3>
              <p className="text-[#6b6b6b] text-lg leading-relaxed relative z-10 max-w-2xl mb-10 font-medium">AI Architect synthesizes your prompt into distinct, sovereign modules. It concurrently builds backends, frontends, and logic matrices, granting you the freedom to deploy anywhere—from serverless edges to dedicated clusters.</p>

              <div className="absolute bottom-0 left-0 w-full p-8 bg-gradient-to-t from-[#f7f6f2] via-[#f7f6f2]/95 to-transparent z-40">
                <style>{`@keyframes micPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(229,83,75,0.35); } 50% { transform: scale(1.04); box-shadow: 0 0 0 10px rgba(229,83,75,0); } } @keyframes screenshotPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(1,105,111,0.3); } 50% { box-shadow: 0 0 0 8px rgba(1,105,111,0); } }`}</style>
                <div className="max-w-4xl mx-auto bg-[#f9f8f5] p-8 rounded-[12px] shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-alpha flex flex-col gap-6 relative stagger-fade-in">
                 <div className="absolute -top-4 left-10 px-5 py-1.5 bg-[#01696f] text-white text-[11px] font-bold uppercase tracking-[0.15em] rounded-full shadow-lg">Vibe Control Center</div>
                 {status === 'idle' && (
                   <div className="flex flex-col gap-6 w-full">
                      {!isUrlMode ? (
                        <>
                          <div className="relative">
                            <textarea className="flex-1 w-full p-6 pr-16 bg-[#f7f6f2] border border-alpha rounded-[8px] focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] focus:outline-none resize-none transition-all placeholder:text-[#6b6b6b]/50 text-sm font-medium" placeholder="Describe your next massive project..." value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
                            <button
                              type="button"
                              title={isRecording ? 'Recording... click to stop' : 'Click to speak'}
                              onClick={handleVoiceInput}
                              className="absolute right-4 bottom-4 rounded-full w-10 h-10 flex items-center justify-center border border-alpha shadow-sm"
                              style={{
                                background: isRecording ? '#e5534b' : 'transparent',
                                color: isRecording ? '#fff' : '#01696f',
                                animation: isRecording ? 'micPulse 1.2s ease-in-out infinite' : undefined,
                              }}
                            >
                              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="flex justify-between items-center">
                            <button onClick={() => setIsUrlMode(true)} className="text-[10px] font-bold text-[#6b6b6b] hover:text-[#01696f] uppercase tracking-widest premium-transition">Or clone from URL</button>
                            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={async () => { const ns = await createSession(prompt.substring(0,30) || 'Dynamic Venture'); if (ns) { loadSession(ns); askClarifications(prompt); } }} disabled={!prompt.trim()} className="px-12 py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-xl shadow-[#01696f]/20 premium-transition hover:translate-y-[-2px] active:scale-95 disabled:opacity-50 disabled:translate-y-0 flex items-center gap-3">
                              <SparklesIcon />
                              Initiate Build
                            </motion.button>
                          </div>
                          {isAnalyzingScreenshot && (
                            <div className="space-y-3">
                              {screenshotPreview && (
                                <img src={screenshotPreview} alt="Screenshot preview" className="max-h-20 rounded-[8px] border-2 border-[#01696f]" style={{ animation: 'screenshotPulse 1.4s ease-in-out infinite' }} />
                              )}
                              <div className="text-xs text-[#6b6b6b] font-medium flex items-center gap-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-[#01696f] animate-pulse" />
                                Analyzing with Gemma Vision...
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                       <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 relative">
                          <Globe className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-[#01696f]" />
                          <input type="text" placeholder="https://example.com — paste any website" className="w-full pl-14 pr-16 py-4 bg-[#f7f6f2] border border-alpha rounded-[8px] focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] focus:outline-none text-sm font-medium" value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} />
                          <button
                            type="button"
                            title="Upload screenshot"
                            onClick={() => screenshotInputRef.current?.click()}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center border border-alpha bg-white hover:bg-[#efebe3] premium-transition"
                          >
                            <Camera className="w-4 h-4 text-[#01696f]" />
                          </button>
                        </div>
                        <button onClick={handleCloneFromUrl} disabled={isAnalyzing || !cloneUrl.trim()} className="px-10 py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-xl shadow-[#01696f]/20 premium-transition hover:translate-y-[-2px] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 whitespace-nowrap min-w-[220px]">{isAnalyzing ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Analyze & Clone</button>
                      </div>
                      <input type="file" accept="image/*" ref={screenshotInputRef} style={{ display: 'none' }} onChange={handleScreenshotUpload} />

                      {isAnalyzingScreenshot && (
                        <div className="space-y-3">
                          {screenshotPreview && (
                            <img src={screenshotPreview} alt="Screenshot preview" className="max-h-20 rounded-[8px] border-2 border-[#01696f]" style={{ animation: 'screenshotPulse 1.4s ease-in-out infinite' }} />
                          )}
                          <div className="text-xs text-[#6b6b6b] font-medium flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#01696f] animate-pulse" />
                            Analyzing with Gemma Vision...
                          </div>
                        </div>
                      )}

                      {isAnalyzing && (
                           <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-2">
                             {["Scraping layout structure...","Extracting color palette...","Mapping component hierarchy...","Synthesizing clone specification..."].map((step, i) => (
                               <div key={i} className={`flex items-center gap-3 p-4 rounded-[8px] border premium-transition ${cloneProgress > i ? 'bg-[#01696f]/5 border-[#01696f]/20 opacity-100' : 'bg-transparent border-alpha opacity-30'}`}>
                                 {cloneProgress > i ? <Check className="w-3.5 h-3.5 text-[#01696f]" /> : <div className="w-3.5 h-3.5 rounded-full border border-current" />}
                                 <span className="text-[10px] font-bold uppercase tracking-tight truncate">{step}</span>
                               </div>
                             ))}
                           </div>
                         )}

                         <button onClick={() => { setIsUrlMode(false); }} className="text-[10px] font-bold text-[#6b6b6b] hover:text-[#01696f] uppercase tracking-widest premium-transition mt-2">← Back to standard prompt</button>
                       </div>
                     )}
                   </div>
                 )}

                 {status === 'clarifying' && isClarifying && (
                   <div className="py-12 text-[#01696f] w-full text-center font-bold flex items-center justify-center gap-4 text-lg"><RefreshCcw className="w-6 h-6 animate-spin" /><span className="shimmer bg-clip-text text-transparent uppercase tracking-widest text-sm">Analyzing requirements...</span></div>
                 )}

                  {clarifications.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-6 stagger-fade-in">
                      <div className="flex items-center gap-3 mb-2"><div className="w-8 h-8 rounded-full bg-[#01696f15] flex items-center justify-center"><Bot className="w-4 h-4 text-[#01696f]" /></div><div><p className="font-bold text-[#2d2d2d] text-sm">Pre-Flight Check</p><p className="text-[10px] text-[#6b6b6b] uppercase tracking-widest font-bold">{clarifications.length} question{clarifications.length > 1 ? 's' : ''} to optimize your build</p></div></div>

                     {clarifications.map((q, idx) => (
                       <motion.div key={q.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }} className="bg-[#f9f8f5] border border-alpha rounded-[12px] p-6">
                         <p className="font-bold text-[#2d2d2d] text-sm mb-4 flex items-start gap-2"><span className="text-[#01696f] font-black">{idx + 1}.</span>{q.question}</p>

                         {q.type === 'yesno' && (
                           <div className="flex gap-3">
                             <button onClick={() => setClarifications(prev => prev.map(c => c.id === q.id ? { ...c, answer: 'yes' } : c))} className="px-4 py-2 bg-[#01696f] text-white rounded">Yes</button>
                             <button onClick={() => setClarifications(prev => prev.map(c => c.id === q.id ? { ...c, answer: 'no' } : c))} className="px-4 py-2 bg-[#efebe3] rounded">No</button>
                           </div>
                         )}

                         {q.type === 'choice' && (
                           <div className="flex gap-3 flex-wrap">
                             {q.options?.map(opt => (
                               <button key={opt} onClick={() => setClarifications(prev => prev.map(c => c.id === q.id ? { ...c, answer: opt } : c))} className="px-4 py-2 bg-[#efebe3] rounded">{opt}</button>
                             ))}
                           </div>
                         )}

                         {q.type === 'text' && (
                           <textarea value={q.answer || ''} onChange={(e) => setClarifications(prev => prev.map(c => c.id === q.id ? { ...c, answer: e.target.value } : c))} className="w-full p-3 border rounded mt-3" />
                         )}
                       </motion.div>
                     ))}

                      <div className="flex gap-3 justify-end">
                        <button onClick={() => { setClarifications([]); }} className="px-6 py-3 bg-[#efebe3] rounded">Cancel</button>
                        <button onClick={submitClarifications} className="px-6 py-3 bg-[#01696f] text-white rounded">Submit</button>
                      </div>
                    </motion.div>
                  )}

                  {status === 'rectifying' && <div className="py-12 text-[#01696f] w-full text-center font-bold flex items-center justify-center gap-4 text-lg">
                    <RefreshCcw className="w-6 h-6 animate-spin" />
                    <span className="shimmer bg-clip-text text-transparent uppercase tracking-widest text-sm">Compressing requirements via Swarm Matrix...</span>
                  </div>}

                  {status === 'prompt-review' && (
                    <div className="w-full space-y-8 stagger-fade-in">
                      <div className="bg-[#2d2d2d] p-8 rounded-[12px] text-[#efebe3] leading-relaxed border border-alpha max-h-72 overflow-y-auto font-mono text-[13px] shadow-inner custom-scrollbar relative">
                        <span className="text-[#6b6b6b] block mb-4 font-bold uppercase tracking-[0.2em] text-[10px]">Verified Spec:</span>
                        {rectifiedPrompt}
                      </div>
                      <div className="flex flex-wrap gap-6">
                        <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="flex-1 min-w-[240px] py-6 bg-[#01696f] text-white rounded-[8px] transition font-bold shadow-xl shadow-[#01696f]/10" onClick={handleApproveAndBuild}>Approve & Spark Microservices</motion.button>
                        <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="px-12 py-6 bg-[#efebe3] text-[#2d2d2d] rounded-[8px] transition font-bold border border-alpha" onClick={() => setStatus('idle')}>Discard</motion.button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
         </motion.div>
      </div>
    </div>
  );
};
