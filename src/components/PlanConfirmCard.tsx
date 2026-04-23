import React from 'react';
import { motion } from 'motion/react';

export const PlanConfirmCard: React.FC<{
  pendingPlan: { title: string; steps: string[]; onApprove: () => void; onReject: () => void } | null;
  setPendingPlan: (p: any) => void;
}> = ({ pendingPlan, setPendingPlan }) => {
  if (!pendingPlan) return null;
  return (
    <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="bg-[#fff8f0] border border-[#f3e8de] rounded-[10px] p-4 mb-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-bold text-sm text-[#2d2d2d] mb-2">{pendingPlan.title}</div>
          <ol className="text-[13px] text-[#4b4b4b] list-decimal list-inside space-y-1">
            {pendingPlan.steps.map((s, i) => (
              <li key={i} className="leading-snug">{s}</li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => { pendingPlan.onApprove(); setPendingPlan(null); }} className="px-4 py-2 rounded bg-[#01696f] text-white font-bold">Approve & Execute</button>
          <button onClick={() => { pendingPlan.onReject(); setPendingPlan(null); }} className="px-4 py-2 rounded bg-transparent border border-alpha font-bold">Cancel</button>
        </div>
      </div>
    </motion.div>
  );
};
