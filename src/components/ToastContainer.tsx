import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { ToastItem } from '../types';

export const ToastContainer: React.FC<{ toasts: ToastItem[]; removeToast: (id: string) => void }> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-8 right-8 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onAnimationComplete={() => removeToast(t.id)}
            className={`group bg-white border border-alpha px-4 py-3 rounded-[10px] shadow-xl w-72 flex items-start justify-between gap-4`}
          >
            <div>
              <div className="text-sm font-bold text-[#2d2d2d]">{t.message}</div>
              <div className="text-[11px] opacity-60 uppercase tracking-widest text-[#6b6b6b] mt-1">{t.type}</div>
            </div>
            <button onClick={() => removeToast(t.id)} className="p-1 hover:bg-[#efebe3] rounded-full transition-colors opacity-0 group-hover:opacity-100">
              <X className="w-4 h-4 text-[#6b6b6b]" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
