"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Bot,
  User,
  Send,
  Square,
  Sparkles,
  Database,
  Cpu,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ExternalLink,
  Waves,
  ShieldCheck,
  Code2,
  HelpCircle,
  FileText,
} from "lucide-react";
import {
  ChatMessage,
  ChatStreamChunk,
  RagChunkMatch,
  fetchChatModels,
  streamChatMessage,
} from "@/lib/api";

interface ExtendedMessage extends ChatMessage {
  id: string;
  citations?: RagChunkMatch[];
  sources_used?: boolean;
  model?: string;
  streaming?: boolean;
  error?: string;
}

const STARTER_PROMPTS = [
  {
    icon: Database,
    title: "Vault Risk Ranking",
    prompt: "What is my most recent simulation, and which saved simulation has the most risk vs least risk?",
    category: "Simulation Vault & Risk",
  },
  {
    icon: Waves,
    title: "Best Surge Model",
    prompt: "Which trained ML model performs best on extreme P90 flood surges, and what is its test RMSE?",
    category: "Models & Evaluation",
  },
  {
    icon: Database,
    title: "Potomac Basin Gauge",
    prompt: "Tell me about USGS Station #01646500 (Potomac at Little Falls). What are its flood thresholds and drainage area?",
    category: "Hydrology Telemetry",
  },
  {
    icon: Cpu,
    title: "Soil Moisture Physics",
    prompt: "Explain how antecedent soil moisture saturation changes peak runoff discharge during a 100mm storm.",
    category: "Catchment Science",
  },
  {
    icon: Code2,
    title: "Hydrology Python Code",
    prompt: "Write a complete Python function to calculate the Nash-Sutcliffe Efficiency (NSE) coefficient between observed and predicted streamflows.",
    category: "General Coding",
  },
  {
    icon: HelpCircle,
    title: "General Knowledge",
    prompt: "Explain the difference between supervised and unsupervised learning, and give an example of each.",
    category: "General AI & Science",
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<string[]>(["qwen2.5:1.5b"]);
  const [selectedModel, setSelectedModel] = useState("qwen2.5:1.5b");
  const [useRag, setUseRag] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetchChatModels().then((mList) => {
      if (mList && mList.length > 0) {
        setModels(mList);
        setSelectedModel(mList[0]);
      }
    });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Handle textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isStreaming) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    const userMessage: ExtendedMessage = {
      id: userMsgId,
      role: "user",
      content: query,
    };

    const initialAssistantMessage: ExtendedMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      streaming: true,
      model: selectedModel,
    };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build history for backend
    const historyPayload = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const stream = streamChatMessage(
        {
          message: query,
          history: historyPayload,
          model: selectedModel,
          use_rag: useRag,
        },
        controller.signal
      );

      let accumulatedContent = "";
      let finalCitations: RagChunkMatch[] = [];
      let sourcesUsed = false;

      for await (const chunk of stream) {
        if (chunk.token) {
          accumulatedContent += chunk.token;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: accumulatedContent }
                : msg
            )
          );
        }

        if (chunk.citations) {
          finalCitations = chunk.citations;
        }
        if (chunk.sources_used !== undefined) {
          sourcesUsed = chunk.sources_used;
        }

        if (chunk.error) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    streaming: false,
                    error: chunk.error,
                  }
                : msg
            )
          );
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                streaming: false,
                content: accumulatedContent,
                citations: finalCitations,
                sources_used: sourcesUsed,
              }
            : msg
        )
      );
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, streaming: false } : msg
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  streaming: false,
                  error: err.message || "Failed to generate response.",
                }
              : msg
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleCitationAccordion = (id: string) => {
    setExpandedCitations((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleClear = () => {
    if (isStreaming) handleStop();
    setMessages([]);
  };

  // Helper to format basic markdown text into clean styled JSX
  const renderFormattedMarkdown = (content: string) => {
    if (!content) return null;

    // Check for code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, pIdx) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const codeLines = part.slice(3, -3).trim().split("\n");
        const lang = codeLines[0].match(/^[a-zA-Z0-9_-]+$/) ? codeLines[0] : "";
        const code = lang ? codeLines.slice(1).join("\n") : codeLines.join("\n");
        const blockId = `code-${pIdx}`;

        return (
          <div
            key={blockId}
            className="my-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden font-mono text-xs"
          >
            <div className="flex items-center justify-between px-3.5 py-1.5 bg-[var(--bg-card)] border-b border-[var(--border-primary)] text-[var(--text-muted)] text-[11px]">
              <span className="font-semibold uppercase">{lang || "code"}</span>
              <button
                type="button"
                onClick={() => handleCopy(blockId, code)}
                className="flex items-center gap-1 hover:text-[var(--text-primary)] transition"
              >
                {copiedId === blockId ? (
                  <>
                    <Check className="h-3 w-3 text-[var(--success)]" />
                    <span className="text-[var(--success)]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3.5 overflow-x-auto text-[var(--text-primary)] leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      // Format bold, bullet points, headers, paragraphs
      const lines = part.split("\n");
      return (
        <div key={pIdx} className="space-y-1.5 leading-relaxed">
          {lines.map((line, lIdx) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={lIdx} className="h-2" />;

            // Headings
            if (trimmed.startsWith("### ")) {
              return (
                <h4 key={lIdx} className="text-sm font-bold text-[var(--text-primary)] mt-3 mb-1">
                  {trimmed.slice(4)}
                </h4>
              );
            }
            if (trimmed.startsWith("## ")) {
              return (
                <h3 key={lIdx} className="text-base font-bold text-[var(--text-primary)] mt-3 mb-1">
                  {trimmed.slice(3)}
                </h3>
              );
            }
            if (trimmed.startsWith("# ")) {
              return (
                <h2 key={lIdx} className="text-lg font-bold text-[var(--text-primary)] mt-3 mb-1">
                  {trimmed.slice(2)}
                </h2>
              );
            }

            // Bullet points
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
              const text = trimmed.slice(2);
              return (
                <div key={lIdx} className="flex items-start gap-2 text-xs sm:text-sm pl-1">
                  <span className="text-[var(--accent)] font-bold">•</span>
                  <div className="flex-1 text-[var(--text-primary)]">
                    {formatInlineText(text)}
                  </div>
                </div>
              );
            }

            // Standard line
            return (
              <p key={lIdx} className="text-xs sm:text-sm text-[var(--text-primary)]">
                {formatInlineText(line)}
              </p>
            );
          })}
        </div>
      );
    });
  };

  // Helper to parse **bold** and `code` spans
  const formatInlineText = (text: string) => {
    const tokens = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong key={idx} className="font-semibold text-[var(--text-primary)]">
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code
            key={idx}
            className="rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--accent)]"
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      return token;
    });
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col h-[calc(100vh-68px)] p-4 sm:p-6 gap-4">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                FLOODCAST AI Assistant
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                Local GPU
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              100% offline local intelligence • RAG Vector Database • USGS Telemetry
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Model Selector */}
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
            <Cpu className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent font-mono text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {models.map((m) => (
                <option key={m} value={m} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* RAG Toggle */}
          <label className="flex items-center gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs cursor-pointer hover:border-[var(--accent)] transition">
            <Database className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-[var(--text-secondary)] font-medium">Vector RAG</span>
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
              className="rounded border-[var(--border-primary)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
            />
          </label>

          {/* Clear Button */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition"
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Conversation Canvas */}
      <div className="flex-1 flex flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden shadow-sm relative">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 ? (
            /* Welcome / Starter Hero */
            <div className="flex flex-col items-center justify-center min-h-full py-8 text-center max-w-2xl mx-auto space-y-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 shadow-sm">
                <Sparkles className="h-8 w-8" />
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                  How can I help you today?
                </h2>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1.5 max-w-lg mx-auto">
                  Ask questions about real-time USGS river gauges, machine learning discharge forecasts, storm simulations, or any general technical &amp; coding questions.
                </p>
              </div>

              {/* Starter Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left pt-2">
                {STARTER_PROMPTS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="group flex flex-col p-3.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)] hover:border-[var(--accent)] transition text-left"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1">
                        <span className="font-medium uppercase tracking-wider">{item.category}</span>
                        <Icon className="h-3.5 w-3.5 text-[var(--accent)] group-hover:scale-110 transition-transform" />
                      </div>
                      <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] line-clamp-2 mt-0.5">
                        {item.prompt}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Message Thread */
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 sm:gap-4 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 mt-1">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}

                  <div
                    className={`flex flex-col max-w-[85%] sm:max-w-[78%] ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    {/* Bubble */}
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        isUser
                          ? "bg-[var(--accent)] text-white font-medium rounded-tr-none"
                          : "border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-tl-none"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div>
                          {msg.content ? (
                            renderFormattedMarkdown(msg.content)
                          ) : msg.streaming ? (
                            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
                              <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-ping" />
                              <span>Thinking &amp; retrieving telemetry…</span>
                            </div>
                          ) : null}

                          {msg.error && (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-light)] p-2.5 text-xs text-[var(--danger)]">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span>{msg.error}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Metadata & Actions */}
                    {!isUser && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)] px-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="flex items-center gap-1 hover:text-[var(--text-primary)] transition"
                          title="Copy answer"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="h-3 w-3 text-[var(--success)]" />
                              <span className="text-[var(--success)]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {msg.model && (
                          <span className="font-mono text-[10px]">
                            Engine: {msg.model}
                          </span>
                        )}

                        {/* RAG Citations Accordion Toggle */}
                        {msg.citations && msg.citations.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleCitationAccordion(msg.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 px-2 py-0.5 font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20 transition"
                          >
                            <Database className="h-3 w-3" />
                            <span>
                              {msg.citations.length} Grounded Source{msg.citations.length > 1 ? "s" : ""}
                            </span>
                            {expandedCitations[msg.id] ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Expandable Citations Drawer */}
                    {!isUser && expandedCitations[msg.id] && msg.citations && (
                      <div className="mt-2 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 text-xs space-y-2 animate-in fade-in duration-200">
                        <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                          <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
                          FAISS Vector Retrieved Grounding Data:
                        </p>
                        <div className="space-y-2">
                          {msg.citations.map((c, cIdx) => (
                            <div
                              key={cIdx}
                              className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-[var(--accent)]">
                                  {c.title}
                                </span>
                                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                                  Cosine Sim: {(c.similarity_score * 100).toFixed(1)}%
                                </span>
                              </div>
                              <p className="text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                                {c.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)] mt-1">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Console */}
        <div className="p-3 sm:p-4 border-t border-[var(--border-primary)] bg-[var(--bg-card)] shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-2 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about FLOODCAST river discharge, USGS stations, or any general question…"
              className="flex-1 bg-transparent px-3 py-1.5 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none resize-none max-h-48 leading-relaxed"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger)] text-white hover:brightness-110 transition shadow-sm"
                title="Stop response generation"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:hover:bg-[var(--accent)] transition shadow-sm"
                title="Send message (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>

          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)] px-1">
            <span>
              Press <kbd className="font-mono rounded border border-[var(--border-primary)] px-1 bg-[var(--bg-secondary)]">Enter</kbd> to send, <kbd className="font-mono rounded border border-[var(--border-primary)] px-1 bg-[var(--bg-secondary)]">Shift + Enter</kbd> for new line
            </span>
            <span className="hidden sm:inline font-mono">
              Offline • Powered by Ollama Local Runtime
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
