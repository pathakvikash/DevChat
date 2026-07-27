"use client";

interface GenerationParamsProps {
  temperature: number;
  onTemperatureChange: (v: number) => void;
  topP: number;
  onTopPChange: (v: number) => void;
  contextLength: number;
  onContextLengthChange: (v: number) => void;
  maxTokens: string;
  onMaxTokensChange: (v: string) => void;
  maxContextWindow: number;
  chatOnlyMode: boolean;
  onChatOnlyModeChange: (v: boolean) => void;
  maxToolCalls: number;
  onMaxToolCallsChange: (v: number) => void;
}

export default function GenerationParams({
  temperature,
  onTemperatureChange,
  topP,
  onTopPChange,
  contextLength,
  onContextLengthChange,
  maxTokens,
  onMaxTokensChange,
  maxContextWindow,
  chatOnlyMode,
  onChatOnlyModeChange,
  maxToolCalls,
  onMaxToolCallsChange,
}: GenerationParamsProps) {
  return (
    <section>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Temperature</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-10 text-right text-sm text-zinc-300 font-mono">
              {temperature.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Controls randomness. 0 = deterministic, 2 = creative.
          </p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Top P</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={topP}
              onChange={(e) => onTopPChange(parseFloat(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-10 text-right text-sm text-zinc-300 font-mono">
              {topP.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Nucleus sampling. Lower = more focused.
          </p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Context Length (num_ctx)
          </label>
          <input
            type="number"
            value={contextLength}
            onChange={(e) =>
              onContextLengthChange(parseInt(e.target.value, 10) || 8192)
            }
            min="1024"
            max={maxContextWindow || 200000}
            step="1024"
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Model max: {(maxContextWindow || 0).toLocaleString() || "Unknown"}
          </p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Max Tokens (optional)
          </label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => onMaxTokensChange(e.target.value)}
            min="1"
            max="32768"
            placeholder="Unlimited"
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Limit response length. Empty = model default.
          </p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Max Tool Calls</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={maxToolCalls}
              onChange={(e) => onMaxToolCallsChange(parseInt(e.target.value, 10))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-8 text-right text-sm text-zinc-300 font-mono">
              {maxToolCalls}
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Max sequential tool calls per turn. Higher = more steps before answering.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={chatOnlyMode}
              onChange={(e) => onChatOnlyModeChange(e.target.checked)}
              className="w-4 h-4 accent-blue-500 rounded border-[var(--glass-border)] bg-[var(--glass-bg)]"
            />
            <div>
              <span className="text-sm font-medium text-zinc-100">
                Chat-only mode (disable tools)
              </span>
              <p className="text-xs text-zinc-500 mt-0.5">
                Disable tool calling. Use for models that don&apos;t support tools
                (e.g., llama3). In this mode, the model can only chat — no code
                execution, web search, or other tools.
              </p>
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
