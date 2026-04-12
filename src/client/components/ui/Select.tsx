import { SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string | number; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, options, className = '', id, ...rest }, ref) => {
    const selectId = id ?? `sel_${Math.random().toString(36).slice(2, 8)}`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={selectId}
            ref={ref}
            className={`w-full h-11 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[12px] px-4 pr-10 text-sm text-[var(--color-text)] appearance-none cursor-pointer focus:border-[var(--color-mint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-mint-soft)] transition ${className}`}
            {...rest}
          >
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)] pointer-events-none" />
        </div>
      </div>
    );
  },
);
Select.displayName = 'Select';
