"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { FilePlus, Settings } from "lucide-react";
import { useToast } from "./Toast";
import { createConversation } from "@/app/hooks/useConversationsApi";

interface CommandPaletteAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface CommandPaletteContextValue {
  registerActions: (group: string, actions: CommandPaletteAction[]) => void;
  unregisterActions: (group: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  registerActions: () => {},
  unregisterActions: () => {},
});

export function useCommandPaletteActions(group: string, actions: CommandPaletteAction[]) {
  const { registerActions, unregisterActions } = useContext(CommandPaletteContext);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    registerActions(group, actionsRef.current);
    return () => unregisterActions(group);
  }, [group, registerActions, unregisterActions]);
}

export default function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [extraGroups, setExtraGroups] = useState<Record<string, CommandPaletteAction[]>>({});
  const router = useRouter();
  const { toast } = useToast();
  const openRef = useRef(open);
  openRef.current = open;

  const registerActions = useCallback((group: string, actions: CommandPaletteAction[]) => {
    setExtraGroups((prev) => ({ ...prev, [group]: actions }));
  }, []);

  const unregisterActions = useCallback((group: string) => {
    setExtraGroups((prev) => {
      const next = { ...prev };
      delete next[group];
      return next;
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && openRef.current) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function createNewChat() {
    try {
      const conv = await createConversation();
      router.push(`/c/${conv.id}`);
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  }

  const ctx = useMemo(() => ({ registerActions, unregisterActions }), [registerActions, unregisterActions]);

  return (
    <CommandPaletteContext.Provider value={ctx}>
      {children}
      <Command.Dialog
        open={open}
        onOpenChange={(o) => { if (!o) setOpen(false); }}
        label="Command palette"
      >
        <Dialog.DialogTitle className="sr-only">Command Palette</Dialog.DialogTitle>
        <Command.Input placeholder="Type a command or search…" />
        <Command.List>
          <Command.Empty>No results found.</Command.Empty>

          <Command.Group heading="Navigation">
            <Command.Item value="new-chat" onSelect={createNewChat}>
              <FilePlus size={16} />
              New Chat
            </Command.Item>
            <Command.Item
              value="settings-page"
              onSelect={() => { router.push("/settings"); setOpen(false); }}
            >
              <Settings size={16} />
              Settings Page
            </Command.Item>
          </Command.Group>

          {Object.entries(extraGroups).map(([group, actions]) => (
            actions.length > 0 ? (
              <Command.Group key={group} heading={group}>
                {actions.map((action) => (
                  <Command.Item
                    key={action.id}
                    value={action.id}
                    onSelect={() => { action.onSelect(); setOpen(false); }}
                  >
                    {action.icon}
                    {action.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null
          ))}

          <Command.Group heading="Shortcuts">
            <Command.Item disabled>
              <span>Cmd+K</span>
              <span className="ml-auto">Open this palette</span>
            </Command.Item>
            <Command.Item disabled>
              <span>Cmd+Enter</span>
              <span className="ml-auto">Send message</span>
            </Command.Item>
            <Command.Item disabled>
              <span>Esc</span>
              <span className="ml-auto">Close dialog</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </CommandPaletteContext.Provider>
  );
}
