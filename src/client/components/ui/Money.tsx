interface Props {
  /** Amount in pence (integer) */
  pence: number;
  signed?: boolean;
  color?: 'auto' | 'positive' | 'negative' | 'neutral' | 'muted';
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  className?: string;
}

const sizes = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-xl',
  '2xl': 'text-3xl',
  '3xl': 'text-5xl',
};

export function formatMoney(pence: number, signed = false): string {
  const abs = Math.abs(pence) / 100;
  const str = abs.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
  if (signed) return pence >= 0 ? `+${str}` : `-${str}`;
  return pence < 0 ? `-${str}` : str;
}

export function Money({ pence, signed, color = 'auto', size = 'md', className = '' }: Props) {
  let colorClass = '';
  if (color === 'auto') {
    colorClass = pence > 0 ? 'text-[var(--color-mint)]' : pence < 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)]';
  } else if (color === 'positive') colorClass = 'text-[var(--color-mint)]';
  else if (color === 'negative') colorClass = 'text-[var(--color-coral)]';
  else if (color === 'muted') colorClass = 'text-[var(--color-text-3)]';
  else colorClass = 'text-[var(--color-text)]';

  return (
    <span className={`tabular font-semibold ${sizes[size]} ${colorClass} ${className}`}>
      {formatMoney(pence, signed)}
    </span>
  );
}
