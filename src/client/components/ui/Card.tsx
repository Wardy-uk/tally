import { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const pads = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, glow, padding = 'md', className = '', ...rest }: Props) {
  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[20px] ${pads[padding]} ${glow ? 'shadow-[0_0_40px_rgba(74,222,128,0.08),0_20px_60px_rgba(0,0,0,0.4)]' : 'shadow-[0_8px_24px_rgba(0,0,0,0.25)]'} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--color-text)] tracking-tight">{children}</h3>
      {subtitle && <p className="text-xs text-[var(--color-text-3)] mt-0.5">{subtitle}</p>}
    </div>
  );
}
