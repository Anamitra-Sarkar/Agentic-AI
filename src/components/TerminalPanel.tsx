import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, User, Terminal as TerminalIcon, Trash2, RefreshCcw, ShieldCheck, AlertCircle, List, Play, SkipForward, Globe, Sparkles } from 'lucide-react';
import type { TerminalEntry, CommandQueueItem } from '../types';

export const TerminalPanel: React.FC<{
  terminalEntries: TerminalEntry[];
  setTerminalEntries: (f: TerminalEntry[] | ((prev: TerminalEntry[]) => TerminalEntry[])) => void;
  commandQueue: CommandQueueItem[];
  setCommandQueue: (q: CommandQueueItem[] | ((prev: CommandQueueItem[]) => CommandQueueItem[])) => void;
  aiExecuteMode: boolean;
  setAiExecuteMode: (b: boolean) => void;
  executeAllQueued: () => Promise<void>;
  runTerminalCommand: (command: string, workdir?: string, source?: 'ai' | 'user') => Promise<any>;
  terminalEndRef: React.RefObject<HTMLDivElement>;
}> = ({ terminalEntries, setTerminalEntries, commandQueue, setCommandQueue, aiExecuteMode, setAiExecuteMode, executeAllQueued, runTerminalCommand, terminalEndRef }) => {
  return (
    <>
      <div className="bg-[#1e1e1e] rounded-[12px] shadow-2xl border border-white/5 flex flex-col overflow-hidden">
        <div className="bg-[#2d2d2d] px-6 py-4 flex justify-between items-center border-b border-white/5">
            <div className="flex items-center gap-3">
                <TerminalIcon className="w-4 h-4 text-[#01696f]" />
                <span className="text-[11px] font-bold text-[#f7f6f2] uppercase tracking-[0.2em] font-mono">Autonomous Console</span>
            </div>
            <div className="flex gap-4">
                <button className="p-1.5 text-white/30 hover:text-white/60 transition-colors" title="Clear Terminal" onClick={() => setTerminalEntries([])}>
                    <Trash2 className="w-4 h-4" />
                </button>
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
        </div>
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed bg-[#1a1a1a]">
            <div className="space-y-4">
                {terminalEntries.length === 0 && (
                    <div className="opacity-20 flex flex-col items-center justify-center py-24 gap-4">
                        <Bot className="w-12 h-12" />
                        <p className="text-[10px] uppercase font-bold tracking-[0.3em]">Awaiting Cluster Handshake...</p>
                    </div>
                )}
                {terminalEntries.map(entry => (
                    <div key={entry.id} className="animate-in fade-in slide-in-from-left-2 duration-300">
                        <div className="flex items-center gap-3 mb-1.5 overflow-hidden">
                            {entry.source === 'ai' ? <Bot className="w-4 h-4 text-[#01696f]" /> : <User className="w-4 h-4 text-white/30" />}
                            <span className="text-[#39ff14] opacity-80 shrink-0 select-none font-bold">$</span>
                            <span className="text-amber-400 font-bold break-all flex-1">{entry.command}</span>
                            {entry.status === 'running' && <RefreshCcw className="w-3 h-3 text-[#01696f] animate-spin shrink-0" />}
                            {entry.status === 'success' && <ShieldCheck className="w-4 h-4 text-[#27c93f] shrink-0" />}
                            {entry.status === 'error' && <AlertCircle className="w-4 h-4 text-[#ff5f56] shrink-0" />}
                        </div>
                        {entry.output && (
                            <pre className={`pl-8 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed mb-6 ${entry.status === 'error' ? 'text-red-400/80 bg-red-950/20 p-4 rounded-[6px] border border-red-500/10' : 'text-[#f7f6f2]/80'}`}>
                                {entry.output}
                            </pre>
                        )}
                    </div>
                ))}
                <div ref={terminalEndRef} />
            </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 overflow-hidden">
        <div className="bg-[#f9f8f5] rounded-[12px] border border-alpha shadow-warm flex flex-col max-h-[50%] overflow-hidden">
            <div className="p-6 border-b border-alpha flex justify-between items-center bg-[#efebe3]/30">
                <div className="flex items-center gap-3">
                    <List className="w-4 h-4 text-[#2d2d2d]" />
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] font-display">Command Pipeline</h3>
                    {commandQueue.length > 0 && <span className="bg-[#01696f] text-white text-[10px] px-2 py-0.5 rounded-full">{commandQueue.length}</span>}
                </div>
                {commandQueue.length > 0 && (
                    <button 
                        onClick={executeAllQueued}
                        className="text-[10px] font-bold text-[#01696f] hover:underline flex items-center gap-2 uppercase tracking-widest"
                    >
                        <Play className="w-3 h-3 fill-current" /> Run All
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {commandQueue.length === 0 ? (
                    <div className="py-12 text-center opacity-30 flex flex-col items-center gap-3">
                        <SkipForward className="w-8 h-8" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">No pending operations</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {commandQueue.map(item => (
                            <motion.div 
                                key={item.id} 
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="bg-white p-5 rounded-[10px] border border-alpha shadow-sm hover:shadow-md premium-transition group"
                            >
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-2 h-2 rounded-full bg-[#01696f]/40 group-hover:scale-125 transition-transform" />
                                    <code className="text-xs font-mono text-[#01696f] font-bold break-all flex-1">{item.command}</code>
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={async () => {
                                            setCommandQueue(prev => prev.filter(q => q.id !== item.id));
                                            await runTerminalCommand(item.command, item.workdir, 'ai');
                                        }}
                                        className="flex-1 bg-[#efebe3] hover:bg-[#01696f] hover:text-white text-[10px] py-2.5 rounded-[6px] font-bold uppercase tracking-widest premium-transition"
                                    >
                                        Permit
                                    </button>
                                    <button 
                                        onClick={() => setCommandQueue(prev => prev.filter(q => q.id !== item.id))}
                                        className="px-4 text-[#6b6b6b] hover:text-[#ff5f56] hover:bg-[#ff5f56]/10 rounded-[6px] premium-transition"
                                    >
                                        <SkipForward className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>

        <div className="flex-1 bg-[#f9f8f5] rounded-[12px] border border-alpha shadow-warm p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
           <div className="flex items-center justify-between border-b border-alpha pb-6">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] font-display">Cluster Observability</h3>
              <div className="px-3 py-1 bg-[#01696f]/10 text-[#01696f] text-[9px] font-bold rounded-full border border-[#01696f]/20 uppercase tracking-widest">Global Edge Active</div>
           </div>
           <div className="grid grid-cols-2 gap-6">
                <div className="p-5 bg-white rounded-[10px] border border-alpha shadow-sm">
                    <div className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest mb-3">Orchestration</div>
                    <div className="text-2xl font-bold font-display text-[#01696f]">4.2<span className="text-xs opacity-40 ml-1">vCPUs</span></div>
                    <div className="w-full h-1 bg-[#efebe3] rounded-full mt-4 overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: '65%' }} className="h-full bg-[#01696f]" />
                    </div>
                </div>
                <div className="p-5 bg-white rounded-[10px] border border-alpha shadow-sm">
                    <div className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest mb-3">Sync Latency</div>
                    <div className="text-2xl font-bold font-display text-[#2d2d2d]">12<span className="text-xs opacity-40 ml-1">ms</span></div>
                    <div className="w-full h-1 bg-[#efebe3] rounded-full mt-4 overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: '20%' }} className="h-full bg-[#01696f]" />
                    </div>
                </div>
           </div>

           <div className="p-6 bg-[#2d2d2d] rounded-[10px] text-[#efebe3] font-mono text-[11px] leading-relaxed shadow-xl border border-white/5 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-[0.05] group-hover:scale-110 transition-transform">
                    <Globe className="w-16 h-16" />
                </div>
                <div className="text-[#01696f] font-bold mb-4 flex items-center gap-2">
                    <RefreshCcw className="w-3 h-3 animate-spin" />
                    <span>VIRTUAL_MESH_HEARTBEAT</span>
                </div>
                <div className="space-y-1">
                    <p className="opacity-60">NODE_VERCEL_EDGE_01: STABLE</p>
                    <p className="opacity-60">NODE_NVIDIA_NIM_CORP: OPTIONAL_SYNC</p>
                    <p className="opacity-100 font-bold">NODE_LOCAL_ARCHITECT: ACTIVE_SYNC</p>
                </div>
           </div>
        </div>
      </div>
    </>
  );
};
