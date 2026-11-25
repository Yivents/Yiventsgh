import './tokens.css';
import './components.css';

import clsx from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      className={clsx('yv-btn', `yv-btn-${variant}`, `yv-btn-${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="yv-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('yv-card', className)} {...props}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  id,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="yv-field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? <p className="yv-tiny yv-muted">{hint}</p> : null}
      {children}
      {error ? (
        <p className="yv-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return <span className={clsx('yv-badge', `yv-badge-${tone}`)}>{children}</span>;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="yv-empty" role="status">
      <div className="yv-empty-icon" aria-hidden="true">✦</div>
      <h3>{title}</h3>
      <p className="yv-muted">{message}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="yv-loading" role="status" aria-live="polite">
      <span className="yv-spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="yv-error-banner" role="alert">
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" className="yv-link-button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="yv-success-banner" role="status">
      {message}
    </div>
  );
}

export function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div className="yv-warning-banner" role="note">
      {children}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="yv-tabs" role="tablist" aria-label="Filter">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          className={clsx('yv-tab', active === tab.id && 'yv-tab-active')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="yv-tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="yv-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="yv-modal" role="dialog" aria-modal="true" aria-labelledby="yv-modal-title">
        <div className="yv-spread">
          <h3 id="yv-modal-title">{title}</h3>
          <button type="button" className="yv-link-button" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Simple accessible SVG charts — no external chart library, small payload. */
export function LineChart({ points, labels, height = 220 }: { points: number[]; labels: string[]; height?: number }) {
  const width = 640;
  const max = Math.max(1, ...points);
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 40) + 20;
    const y = height - 30 - (p / max) * (height - 60);
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="yv-chart" role="img" aria-label="Trend over time">
      <polyline points={coords.join(' ')} fill="none" stroke="var(--brand-primary)" strokeWidth="3" />
      {coords.map((c, i) => {
        const [x, y] = c.split(',');
        return <circle key={i} cx={x} cy={y} r="4" fill="var(--brand-accent)" />;
      })}
      {labels.map((label, i) => (
        <text key={i} x={20 + (i / Math.max(1, labels.length - 1)) * (width - 40)} y={height - 8} fontSize="12" textAnchor="middle" fill="var(--ink-muted)">
          {label}
        </text>
      ))}
    </svg>
  );
}

export function BarChart({ values, labels, height = 220 }: { values: number[]; labels: string[]; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="yv-bar-chart" style={{ height }} role="img" aria-label="Comparison by category">
      {values.map((v, i) => (
        <div className="yv-bar-column" key={i}>
          <div className="yv-bar" style={{ height: `${(v / max) * 100}%` }} title={`${labels[i]}: ${v}`} />
          <span className="yv-tiny">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
