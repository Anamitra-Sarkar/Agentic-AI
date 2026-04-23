import { CheckCircle2, X } from 'lucide-react';
import React from 'react';

interface PlanConfirmCardProps {
  title: string;
  steps: string[];
  onApprove: () => void;
  onReject: () => void;
}

export function PlanConfirmCard({ title, steps, onApprove, onReject }: PlanConfirmCardProps) {
  return (
    <div
      style={{
        background: '#f9f8f5',
        border: '1px solid oklch(0.4 0.01 80 / 0.15)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '12px',
        boxShadow: '0 4px 12px oklch(0.2 0.01 80 / 0.08)',
        animation: 'slideDown 180ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <CheckCircle2 size={16} color="#01696f" />
        <span style={{ fontWeight: 600, fontSize: '14px', color: '#1a1a1a' }}>{title}</span>
      </div>
      <ol style={{ margin: '0 0 16px 0', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {steps.map((step, i) => (
          <li key={i} style={{ fontSize: '13px', color: '#4a4a4a', lineHeight: 1.5 }}>{step}</li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onApprove}
          style={{
            padding: '7px 16px',
            borderRadius: '8px',
            background: '#01696f',
            color: '#fff',
            border: 'none',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 180ms ease'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#0c4e54')}
          onMouseLeave={e => (e.currentTarget.style.background = '#01696f')}
        >
          Approve & Execute
        </button>
        <button
          onClick={onReject}
          style={{
            padding: '7px 16px',
            borderRadius: '8px',
            background: 'transparent',
            color: '#555',
            border: '1px solid oklch(0.4 0.01 80 / 0.2)',
            fontSize: '13px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

