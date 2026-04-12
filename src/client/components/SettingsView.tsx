import { useEffect, useState } from 'react';
import { Key, Sparkles, CheckCircle2, XCircle, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { api } from '../lib/api';

export function SettingsView() {
  const [allSettings, setAllSettings] = useState<Record<string, any>>({});
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<Record<string, any>>('/settings/all');
        setAllSettings(s);
        if (s.openai_api_key) setApiKey(String(s.openai_api_key));
        if (s.openai_model) setModel(String(s.openai_model));
      } catch {}
      try {
        const status = await api<{ configured: boolean }>('/ai/status');
        setAiStatus(status);
      } catch {}
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      if (apiKey !== (allSettings.openai_api_key ?? '')) {
        await api('/settings/openai_api_key', { method: 'PUT', body: JSON.stringify({ value: apiKey }) });
      }
      if (model !== (allSettings.openai_model ?? 'gpt-4o-mini')) {
        await api('/settings/openai_model', { method: 'PUT', body: JSON.stringify({ value: model }) });
      }
      const status = await api<{ configured: boolean }>('/ai/status');
      setAiStatus(status);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-6 fade-up max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">
          API keys, integrations and preferences
        </p>
      </div>

      <Card padding="lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-violet-soft)] text-[var(--color-violet)] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <CardTitle subtitle="For categorisation, monthly insights and the chat assistant">
              OpenAI
            </CardTitle>
          </div>
        </CardHeader>

        <div className="flex flex-col gap-4">
          <Input
            label="API key"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            icon={<Key className="w-4 h-4" />}
            placeholder="sk-…"
            hint="Stored in settings.json on the Pi, never sent to the browser"
          />
          <Select
            label="Model"
            value={model}
            onChange={e => setModel(e.target.value)}
            options={[
              { value: 'gpt-4o-mini', label: 'gpt-4o-mini (fast, cheap — recommended)' },
              { value: 'gpt-4o', label: 'gpt-4o (smarter, pricier)' },
              { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
              { value: 'gpt-4.1', label: 'gpt-4.1' },
            ]}
          />

          {aiStatus && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-[10px] border ${
              aiStatus.configured
                ? 'bg-[var(--color-mint-soft)] border-[rgba(74,222,128,0.25)] text-[var(--color-mint)]'
                : 'bg-[var(--color-amber-soft)] border-[rgba(251,191,36,0.25)] text-[var(--color-amber)]'
            }`}>
              {aiStatus.configured
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> OpenAI is connected</>
                : <><XCircle className="w-3.5 h-3.5" /> No API key set — AI features disabled</>
              }
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={saving} icon={<Save className="w-4 h-4" />}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saved && <span className="text-sm text-[var(--color-mint)]">Saved</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
