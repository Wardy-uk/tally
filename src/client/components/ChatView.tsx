import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, Plus, Trash2, Sparkles } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { api } from '../lib/api';

interface Conversation {
  id: number;
  title: string;
  created_at: string;
  last_message: string | null;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export function ChatView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api<Conversation[]>('/chat/conversations'));
    } catch {}
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    try {
      const data = await api<{ messages: Message[] }>(`/chat/conversations/${id}`);
      setMessages(data.messages);
    } catch {}
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (activeId !== null) loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    const msg = input;
    setInput('');
    setBusy(true);
    setError(null);

    // Optimistic user message
    const optimisticId = Date.now();
    setMessages(m => [...m, { id: optimisticId, role: 'user', content: msg, created_at: new Date().toISOString() }]);

    try {
      const res = await api<{ reply: string; conversationId: number }>('/chat/message', {
        method: 'POST',
        body: JSON.stringify({ conversationId: activeId, message: msg }),
      });
      if (activeId === null) {
        setActiveId(res.conversationId);
        await loadConversations();
      }
      setMessages(m => [
        ...m.filter(x => x.id !== optimisticId),
        { id: optimisticId, role: 'user', content: msg, created_at: new Date().toISOString() },
        { id: optimisticId + 1, role: 'assistant', content: res.reply, created_at: new Date().toISOString() },
      ]);
    } catch (e: any) {
      setError(e.error ?? 'Chat failed');
      setMessages(m => m.filter(x => x.id !== optimisticId));
    } finally {
      setBusy(false);
    }
  }

  async function deleteConv(id: number) {
    if (!confirm('Delete this conversation?')) return;
    await api(`/chat/conversations/${id}`, { method: 'DELETE' });
    if (activeId === id) setActiveId(null);
    await loadConversations();
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  const SUGGESTED = [
    'How much did we spend on eating out last month?',
    'What are our top 3 categories this month?',
    'Any subscriptions we could cancel?',
    'How much did we save last month?',
  ];

  return (
    <div className="flex flex-col gap-6 fade-up h-[calc(100vh-80px)]">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Ask Tally</h1>
          <p className="text-sm text-[var(--color-text-3)] mt-1">
            Chat about your finances — Tally can see all your transactions
          </p>
        </div>
        <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={newChat}>
          New chat
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-[260px_1fr] gap-4 min-h-0">
        {/* Conversations sidebar */}
        <Card padding="none" className="flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-4)] font-semibold">Conversations</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="text-xs text-[var(--color-text-4)] p-4 text-center">No past chats</div>
            ) : (
              conversations.map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] transition group ${
                    activeId === c.id ? 'bg-[var(--color-mint-soft)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-semibold truncate ${activeId === c.id ? 'text-[var(--color-mint)]' : ''}`}>
                        {c.title || '(untitled)'}
                      </div>
                      <div className="text-xs text-[var(--color-text-4)] truncate mt-0.5">
                        {c.last_message ?? 'No messages'}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteConv(c.id); }}
                      className="w-6 h-6 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-coral-soft)] text-[var(--color-text-4)] hover:text-[var(--color-coral)] flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Main chat area */}
        <Card padding="none" className="flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="max-w-md text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] flex items-center justify-center mx-auto mb-4 shadow-[0_0_32px_rgba(74,222,128,0.35)]">
                    <Sparkles className="w-7 h-7 text-[#04140a]" />
                  </div>
                  <h3 className="text-lg font-bold">Ask me anything about your finances</h3>
                  <p className="text-sm text-[var(--color-text-3)] mt-2 mb-5">
                    Try one of these to get started:
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTED.map(q => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="text-sm text-left px-4 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[12px] hover:border-[var(--color-mint)] hover:bg-[var(--color-mint-soft)] transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map(m => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-[var(--color-violet)] to-[var(--color-sky)] text-white'
                      : 'bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] text-[#04140a]'
                  }`}>
                    {m.role === 'user' ? <MessageSquare className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </div>
                  <div className={`max-w-[80%] rounded-[14px] px-4 py-3 ${
                    m.role === 'user'
                      ? 'bg-[var(--color-mint-soft)] border border-[rgba(74,222,128,0.2)]'
                      : 'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]'
                  }`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  </div>
                </div>
              ))
            )}
            {busy && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] text-[#04140a] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[14px] px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-3)] animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-3)] animate-pulse [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-3)] animate-pulse [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="px-5 py-2 text-xs text-[var(--color-coral)] bg-[var(--color-coral-soft)] border-t border-[rgba(251,113,133,0.25)]">
              {error}
            </div>
          )}

          <form onSubmit={send} className="p-4 border-t border-[var(--color-border)] flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about your finances…"
              disabled={busy}
              className="flex-1 h-11 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[12px] px-4 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:border-[var(--color-mint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-mint-soft)]"
            />
            <Button type="submit" variant="primary" disabled={!input.trim() || busy} icon={<Send className="w-4 h-4" />}>
              Send
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
