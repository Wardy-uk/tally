import { useState } from 'react';
import { Wallet, Plus, Edit3, Archive, CreditCard, PiggyBank, TrendingUp, Landmark } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Money } from './ui/Money';
import { EmptyState } from './ui/EmptyState';
import { useAccounts, Account, AccountInput } from '../hooks/useAccounts';
import { useUsers } from '../hooks/useUsers';
import type { AuthUser } from '../../shared/types';

interface Props {
  user: AuthUser;
}

const TYPE_ICON = {
  current: Wallet,
  savings: PiggyBank,
  credit: CreditCard,
  loan: Landmark,
  investment: TrendingUp,
};

const TYPE_LABEL = {
  current: 'Current',
  savings: 'Savings',
  credit: 'Credit card',
  loan: 'Loan',
  investment: 'Investment',
};

export function AccountsView({ user }: Props) {
  const { accounts, loading, create, update, archive } = useAccounts();
  const allUsers = useUsers();
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);

  const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

  return (
    <div className="flex flex-col gap-6 fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Accounts</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            Bank accounts, credit cards, savings — across both of you
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
          Add account
        </Button>
      </div>

      {/* Total */}
      <Card glow padding="lg">
        <div className="text-xs uppercase tracking-wider font-semibold text-[var(--color-text-3)] mb-2">
          Combined balance across {accounts.length} account{accounts.length !== 1 && 's'}
        </div>
        <Money pence={totalBalance} size="3xl" color="neutral" />
      </Card>

      {/* List */}
      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : accounts.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Wallet className="w-7 h-7" />}
            title="No accounts yet"
            description="Add your first account to start importing transactions"
            action={
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                Add account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map(a => {
            const Icon = TYPE_ICON[a.type];
            const ownerName = a.ownerUserId === null
              ? 'Joint'
              : allUsers.find(u => u.id === a.ownerUserId)?.displayName ?? 'Unknown';
            return (
              <Card key={a.id} className="group hover:border-[var(--color-border-strong)] transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[var(--color-mint-soft)] flex items-center justify-center shrink-0 text-[var(--color-mint)]">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[var(--color-text)] truncate">{a.name}</h3>
                      </div>
                      <div className="text-xs text-[var(--color-text-3)] mt-0.5 flex items-center gap-2">
                        <span>{TYPE_LABEL[a.type]}</span>
                        <span>·</span>
                        <span>{ownerName}</span>
                        {a.bank && <><span>·</span><span>{a.bank}</span></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => setEditing(a)}
                      className="w-8 h-8 rounded-lg hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-3)] hover:text-[var(--color-text)] flex items-center justify-center"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => confirm(`Archive ${a.name}?`) && archive(a.id)}
                      className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">Balance</div>
                  <Money pence={a.currentBalance} size="xl" color={a.currentBalance >= 0 ? 'neutral' : 'negative'} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AccountModal
        open={creating}
        onClose={() => setCreating(false)}
        onSave={async (input) => { await create(input); setCreating(false); }}
        allUsers={allUsers}
        currentUserId={user.id}
      />
      <AccountModal
        open={editing !== null}
        account={editing}
        onClose={() => setEditing(null)}
        onSave={async (input) => { if (editing) { await update(editing.id, input); setEditing(null); } }}
        allUsers={allUsers}
        currentUserId={user.id}
      />
    </div>
  );
}

function AccountModal({
  open, onClose, onSave, account, allUsers, currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: AccountInput) => Promise<void>;
  account?: Account | null;
  allUsers: { id: number; displayName: string }[];
  currentUserId: number;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'current');
  const [owner, setOwner] = useState<string>(
    account?.ownerUserId === null ? 'joint' : String(account?.ownerUserId ?? currentUserId),
  );
  const [bank, setBank] = useState(account?.bank ?? '');
  const [opening, setOpening] = useState(account ? (account.openingBalance / 100).toFixed(2) : '0.00');
  const [busy, setBusy] = useState(false);

  // Reset form when opening with different account
  useState(() => {
    if (account) {
      setName(account.name);
      setType(account.type);
      setOwner(account.ownerUserId === null ? 'joint' : String(account.ownerUserId));
      setBank(account.bank ?? '');
      setOpening((account.openingBalance / 100).toFixed(2));
    }
  });

  async function submit() {
    setBusy(true);
    try {
      await onSave({
        name,
        type,
        ownerUserId: owner === 'joint' ? null : Number(owner),
        bank: bank || null,
        accountNumber: null,
        sortCode: null,
        openingBalance: Math.round(parseFloat(opening || '0') * 100),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? 'Edit account' : 'New account'}
      subtitle={account ? 'Update account details' : 'Add a bank account, credit card or savings'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. NatWest Current" autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Type"
            value={type}
            onChange={e => setType(e.target.value as Account['type'])}
            options={[
              { value: 'current', label: 'Current' },
              { value: 'savings', label: 'Savings' },
              { value: 'credit', label: 'Credit card' },
              { value: 'loan', label: 'Loan' },
              { value: 'investment', label: 'Investment' },
            ]}
          />
          <Select
            label="Owner"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            options={[
              { value: 'joint', label: 'Joint' },
              ...allUsers.map(u => ({ value: String(u.id), label: u.displayName })),
            ]}
          />
        </div>
        <Input label="Bank" value={bank} onChange={e => setBank(e.target.value)} placeholder="NatWest" />
        <Input
          label="Opening balance (£)"
          type="number"
          step="0.01"
          value={opening}
          onChange={e => setOpening(e.target.value)}
          hint="The starting balance this account held before you imported transactions"
        />
      </div>
    </Modal>
  );
}
