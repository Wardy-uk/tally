import { InputHTMLAttributes, ReactNode, forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
}

export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  ({ label, hint, error, icon, className = '', id, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);
    const inputId = id ?? `pw_${Math.random().toString(36).slice(2, 8)}`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)] pointer-events-none">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            type={visible ? 'text' : 'password'}
            className={`w-full h-11 bg-[var(--color-bg-elevated)] border ${error ? 'border-[var(--color-coral)]' : 'border-[var(--color-border)]'} rounded-[12px] px-4 ${icon ? 'pl-10' : ''} pr-11 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:border-[var(--color-mint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-mint-soft)] transition ${className}`}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-4)] hover:text-[var(--color-text-2)] hover:bg-[var(--color-surface)] transition"
            tabIndex={-1}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {hint && !error && <p className="text-xs text-[var(--color-text-4)]">{hint}</p>}
        {error && <p className="text-xs text-[var(--color-coral)]">{error}</p>}
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
