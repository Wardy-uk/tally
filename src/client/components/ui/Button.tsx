import { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--color-mint)] text-[#04140a] hover:brightness-110 shadow-[0_0_24px_rgba(74,222,128,0.25)] hover:shadow-[0_0_32px_rgba(74,222,128,0.45)] font-semibold',
  secondary: 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]',
  ghost: 'bg-transparent text-[var(--color-text-2)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
  danger: 'bg-[var(--color-coral-soft)] text-[var(--color-coral)] border border-[rgba(251,113,133,0.25)] hover:bg-[rgba(251,113,133,0.2)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-[10px]',
  md: 'h-10 px-4 text-sm gap-2 rounded-[12px]',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-[14px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
