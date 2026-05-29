import { useEffect } from 'react';

/**
 * Keyboard shortcut helper modal. Triggered by `?` from anywhere
 * outside a form field — listed in the wider keyboard handler in
 * RecordingView.
 */
export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Navigation',
      rows: [
        ['←  / →', 'Previous / next recording'],
        ['n  / p', 'Same — aliases for ← / →'],
        ['?',      'Toggle this help'],
        ['Esc',    'Close modal / clear selection'],
      ],
    },
    {
      title: 'Labeling',
      rows: [
        ['1 – 9',     'Activate label chip 1–9 (cycles add-mode)'],
        ['0',         'Deactivate the current label chip'],
        ['Click ×2',  'On the plot: first click sets start, second click commits the bout'],
        ['d',         'Delete selected annotation (vim-style: tap d twice to confirm)'],
        ['Backspace', 'Same as d-confirm'],
      ],
    },
    {
      title: 'Plot',
      rows: [
        ['f', 'Toggle fullscreen plot'],
      ],
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="keyboard-help"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff', color: '#1f2937',
          border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '20px 24px', minWidth: 460, maxWidth: 560,
          boxShadow: '0 16px 48px rgba(15,23,42,0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Keyboard shortcuts</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {sections.map((s) => (
          <div key={s.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 6 }}>
              {s.title}
            </div>
            {s.rows.map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                <code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, minWidth: 78, textAlign: 'center' }}>{key}</code>
                <span style={{ fontSize: 13, color: '#374151' }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          Shortcuts are ignored while typing in inputs/textareas.
        </div>
      </div>
    </div>
  );
}
