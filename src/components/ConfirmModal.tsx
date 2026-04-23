import React from 'react';
import { motion } from 'motion/react';
import type { } from '../types';

export const ConfirmModal: React.FC<{ modal: { isOpen: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void } | null; setModal: (m: any) => void }> = ({ modal, setModal }) => {
  if (!modal) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[140] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-[10px] p-6 w-full max-w-md shadow-xl border border-alpha">
        <h3 className="font-bold text-lg mb-2">{modal.title}</h3>
        <p className="text-sm text-[#6b6b6b] mb-4">{modal.description}</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setModal(null)} className="px-6 py-2.5 font-bold text-[#6b6b6b] hover:bg-[#efebe3] rounded-[8px] transition-colors">Cancel</button>
          <button onClick={() => { modal.onConfirm(); setModal(null); }} className="px-6 py-2.5 bg-[#01696f] text-white font-bold rounded-[8px]">{modal.confirmLabel}</button>
        </div>
      </div>
    </motion.div>
  );
};
