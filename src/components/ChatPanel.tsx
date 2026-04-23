import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCcw, List, Send, Check, X } from 'lucide-react';
import type { ChatMessage, QueuedInstruction, TerminalEntry } from '../types';

import { PlanConfirmCard } from './PlanConfirmCard';

export const ChatPanel: React.FC<{
  chatHistory: ChatMessage[];
  followUp: string;
  setFollowUp: (s: string) => void;
  isGenerating: boolean;
  sendFollowUpDirect: (s: string) => Promise<void>;
  queueInput: string;
  setQueueInput: (s: string) => void;
  instructionQueue: QueuedInstruction[];
  addToQueue: (s: string) => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  pendingPlan: { title: string; steps: string[]; onApprove: () => void; onReject: () => void } | null;
  setPendingPlan: (p: any) => void;
}> = ({ chatHistory, followUp, setFollowUp, isGenerating, sendFollowUpDirect, queueInput, setQueueInput, instructionQueue, addToQueue, chatEndRef, pendingPlan, setPendingPlan }) => {
  return (
    <div className="flex-1 bg-white rounded-[12px] border border-alpha shadow-2xl overflow-hidden flex flex-col">
      <div className="p-6 overflow-y-auto custom-scrollbar space-y-4" style={{ maxHeight: '60vh' }}>
        {/* Plan confirmation card (if any) */}
        {pendingPlan && <PlanConfirmCard pendingPlan={pendingPlan} setPendingPlan={setPendingPlan} />}

        {chatHistory.map((msg, idx) => (
          <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`p-4 rounded-[8px] ${msg.role === 'user' ? 'bg-[#f7f6f2] text-[#2d2d2d]' : msg.role === 'ai' ? 'bg-[#f9f8f5] text-[#2d2d2d]' : msg.role === 'system' ? 'bg-[#efebe3] text-[#6b6b6b]' : 'bg-[#fff3cd] text-[#6b6b6b]'}`}>
            {msg.role === 'ai' && <div className="text-[11px] font-bold text-[#01696f] mb-2">AI</div>}
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </motion.div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="p-6 bg-[#f9f8f5] border-t border-alpha">
        {isGenerating && (
          <div className="text-[9px] font-bold text-[#01696f] uppercase tracking-widest mb-2 flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#01696f] animate-pulse" />
            Agent active — new instructions will be queued
          </div>
        )}

        <div className="relative">
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!followUp.trim()) return;
                if (isGenerating) addToQueue(followUp);
                else sendFollowUpDirect(followUp);
                setFollowUp('');
              }
            }}
            placeholder={isGenerating ? "Queue next instruction — agent will execute after current task..." : "Instruct Copilot..."}
            className="w-full p-6 pr-16 bg-[#f7f6f2] border border-alpha rounded-[8px] text-sm focus:ring-2 focus:ring-[#01696f]/10 focus:border-[#01696f] focus:outline-none resize-none shadow-inner transition-all placeholder:text-[#6b6b6b]/40 font-medium"
            rows={2}
          />
          <button 
            onClick={() => {
              if (!followUp.trim()) return;
              if (isGenerating) {
                addToQueue(followUp);
                setFollowUp('');
              } else {
                sendFollowUpDirect(followUp);
                setFollowUp('');
              }
            }}
            className={`absolute right-4 bottom-4 p-3 rounded-[8px] transition scale-100 active:scale-95 ${!followUp.trim() ? 'bg-[#efebe3] text-[#6b6b6b]/30' : isGenerating ? 'bg-[#efebe3]' : 'bg-[#01696f] text-white hover:bg-[#01696f]/90 shadow-lg shadow-[#01696f]/10'}`}
          >
            {isGenerating && followUp.trim() ? <List className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        <AnimatePresence>
          {instructionQueue.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="mt-3 bg-[#f7f6f2] border border-alpha rounded-[10px] overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-alpha">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#6b6b6b] flex items-center gap-2">
                  <List className="w-3 h-3" />
                  QUEUED ({instructionQueue.filter(i => i.status === 'queued').length})
                </span>
                <button onClick={() => { /* clear handled by parent */ }} className="text-[10px] text-[#6b6b6b] hover:text-red-500 font-bold premium-transition">Clear all</button>
              </div>
              <div className="max-h-40 overflow-y-auto custom-scrollbar">
                {instructionQueue.map((item, idx) => (
                  <motion.div key={item.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ delay: idx * 0.05 }} className={`px-4 py-3 flex items-start gap-3 border-b border-alpha last:border-0 ${item.status === 'processing' ? 'bg-[#01696f08]' : ''}`}>
                    <div className="mt-0.5 shrink-0">
                      {item.status === 'queued' && <div className="w-2 h-2 rounded-full bg-[#6b6b6b30] border border-[#6b6b6b40]" />}
                      {item.status === 'processing' && <div className="w-2 h-2 rounded-full bg-[#01696f] animate-pulse" />}
                      {item.status === 'done' && <Check className="w-3 h-3 text-[#437a22]" />}
                      {item.status === 'failed' && <X className="w-3 h-3 text-red-400" />}
                    </div>
                    <p className={`text-[11px] font-medium leading-relaxed flex-1 truncate ${item.status === 'processing' ? 'text-[#01696f] font-bold' : 'text-[#6b6b6b]'} ${item.status === 'done' ? 'line-through opacity-40' : ''}`}>
                      {item.status === 'processing' && <span className="text-[9px] font-black uppercase tracking-widest block text-[#01696f] mb-1">↳ Executing...</span>}
                      {item.instruction}
                    </p>
                    {item.status === 'queued' && <button onClick={() => { /* remove handled by parent */ }} className="shrink-0 opacity-30 hover:opacity-100 premium-transition"><X className="w-3 h-3 text-[#6b6b6b]" /></button>}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
