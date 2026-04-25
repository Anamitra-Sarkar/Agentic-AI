import * as Diff from 'diff';
import { X, FileCode2 } from 'lucide-react';
import ReactDOM from 'react-dom';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

interface DiffViewerModalProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  onApply: () => void;
  onReject: () => void;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const changes = Diff.diffLines(oldText, newText);
  const result: DiffLine[] = [];
  let lineNumber = 1;
  for (const part of changes) {
    const lines = part.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '');
    for (const line of lines) {
      result.push({
        type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
        content: line,
        lineNumber: lineNumber++,
      });
    }
  }
  return result;
}

export function DiffViewerModal({ filePath, oldContent, newContent, onApply, onReject }: DiffViewerModalProps) {
  const diff = computeDiff(oldContent, newContent);
  const added = diff.filter(l => l.type === 'added').length;
  const removed = diff.filter(l => l.type === 'removed').length;

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        background: '#f9f8f5', borderRadius: '16px', width: '100%', maxWidth: '860px',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px oklch(0.2 0.01 80 / 0.2)',
        animation: 'diffSlideIn 180ms cubic-bezier(0.16,1,0.3,1)'
      }}>
        <style>{`@keyframes diffSlideIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }`}</style>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid oklch(0.4 0.01 80 / 0.12)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FileCode2 size={16} color="#01696f" />
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#1a1a1a', flex: 1, fontFamily: 'monospace' }}>{filePath}</span>
          <span style={{ fontSize: '12px', color: '#22a35a', fontWeight: 600 }}>+{added}</span>
          <span style={{ fontSize: '12px', color: '#e5534b', fontWeight: 600, marginLeft: '8px' }}>-{removed}</span>
          <button onClick={onReject} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', marginLeft: '12px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, fontFamily: 'monospace', fontSize: '13px', padding: '8px 0' }}>
          {diff.map((line, i) => (
            <div key={i} style={{
              display: 'flex', gap: '12px', padding: '1px 16px',
              background: line.type === 'added' ? 'rgba(34,163,90,0.1)' : line.type === 'removed' ? 'rgba(229,83,75,0.1)' : 'transparent',
              borderLeft: line.type === 'added' ? '3px solid #22a35a' : line.type === 'removed' ? '3px solid #e5534b' : '3px solid transparent'
            }}>
              <span style={{ color: '#aaa', minWidth: '32px', userSelect: 'none', textAlign: 'right' }}>{line.lineNumber}</span>
              <span style={{ color: line.type === 'added' ? '#22a35a' : line.type === 'removed' ? '#e5534b' : '#555', whiteSpace: 'pre' }}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '} {line.content}
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid oklch(0.4 0.01 80 / 0.12)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onReject} style={{ padding: '8px 18px', borderRadius: '8px', background: 'transparent', color: '#555', border: '1px solid oklch(0.4 0.01 80 / 0.2)', fontSize: '13px', cursor: 'pointer' }}>
            Reject Changes
          </button>
          <button onClick={onApply} style={{ padding: '8px 18px', borderRadius: '8px', background: '#01696f', color: '#fff', border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Apply Changes
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
