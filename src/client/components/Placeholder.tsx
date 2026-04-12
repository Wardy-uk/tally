import { Card } from './ui/Card';
import { Construction } from 'lucide-react';

export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-6 fade-up">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">{description}</p>
      </div>
      <Card padding="lg">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-amber-soft)] flex items-center justify-center mb-4">
            <Construction className="w-7 h-7 text-[var(--color-amber)]" />
          </div>
          <h3 className="text-lg font-bold">Coming soon</h3>
          <p className="text-sm text-[var(--color-text-3)] mt-2 max-w-md">
            This view is part of an upcoming phase. Phase 1 is the scaffold — next up: accounts, CSV
            import, and transactions.
          </p>
        </div>
      </Card>
    </div>
  );
}
