import React from 'react';
import { FileCode } from 'lucide-react';
import type { QueuedInstruction } from '../types';

export const FileTree: React.FC<{
  projectFiles: Record<string,string>;
  selectedFile: string;
  setSelectedFile: (s: string) => void;
  contextMenu: { x: number; y: number; fileName: string } | null;
  setContextMenu: (c: { x: number; y: number; fileName: string } | null) => void;
  confirmAction: (c: any) => void;
  showToast: (m: string, t?: any) => void;
}> = ({ projectFiles, selectedFile, setSelectedFile, contextMenu, setContextMenu, confirmAction, showToast }) => {
  return (
    <div className="w-72 flex flex-col bg-[#f9f8f5] border border-alpha rounded-[12px] shadow-sm overflow-hidden stagger-fade-in">
      <div className="px-6 py-5 border-b border-alpha bg-[#f7f6f2]">
        <h3 className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-[0.25em]">Repository</h3>
      </div>
      <ul className="p-4 space-y-1.5 overflow-y-auto custom-scrollbar">
        {Object.keys(projectFiles).length === 0 && <li className="text-xs text-[#6b6b6b] italic p-3 px-4 opacity-50">No files generated yet.</li>}
        {Object.keys(projectFiles).map(name => {
            const ext = name.substring(name.lastIndexOf('.'));
            const extColor = ext === '.tsx' || ext === '.ts' ? 'text-[#01696f]' : ext === '.py' ? 'text-blue-500' : 'text-[#6b6b6b]';
            return (
                <li key={name}
                    onClick={() => setSelectedFile(name)}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, fileName: name });
                    }}
                    className={`cursor-pointer text-[13px] py-1.5 px-4 rounded-[6px] flex items-center gap-3 transition-all font-mono group ${selectedFile === name ? 'bg-[#01696f]/10 text-[#01696f] border-l-2 border-[#01696f] translate-x-1' : 'text-[#6b6b6b] hover:bg-[#efebe3] hover:text-[#2d2d2d]'}`}>
                    <FileCode className={`w-3.5 h-3.5 ${selectedFile === name ? 'text-[#01696f]' : 'text-[#6b6b6b]/40'}`} />
                    <span className="truncate flex-1">{name.split(ext)[0]}<span className={`opacity-80 ${extColor}`}>{ext}</span></span>
                </li>
            );
        })}
      </ul>
    </div>
  );
};
