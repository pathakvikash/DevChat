import { describe, expect, it, vi } from "vitest";
import { altShortcutFor, runAltShortcut, type AltKeyEvent } from "@/app/hooks/useKeyboardShortcuts";

const textarea = { tagName: "TEXTAREA", isContentEditable: false };
const input = { tagName: "INPUT", isContentEditable: false };
const editable = { tagName: "DIV", isContentEditable: true };
const body = { tagName: "BODY", isContentEditable: false };

type TestEvent = AltKeyEvent & { preventDefault: ReturnType<typeof vi.fn> };

function event(over: Partial<AltKeyEvent>): TestEvent {
  return {
    code: "KeyP",
    key: "π",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: body,
    preventDefault: vi.fn(),
    ...over,
  } as TestEvent;
}

describe("Option shortcuts in text fields", () => {
  it("German Option+5 in a textarea types [ and does not fire or prevent default", () => {
    const run = vi.fn();
    const e = event({ code: "Digit5", key: "[", target: textarea as unknown as EventTarget });
    expect(runAltShortcut(e, { "5": run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("US Option+P in a textarea (key π) fires", () => {
    const run = vi.fn();
    const e = event({ code: "KeyP", key: "π", target: textarea as unknown as EventTarget });
    expect(runAltShortcut(e, { P: run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it("Polish Option+A in an input (key ą) does not fire, US Option+A (key å) does", () => {
    expect(altShortcutFor(event({ code: "KeyA", key: "ą", target: input as unknown as EventTarget }))).toBeNull();
    expect(altShortcutFor(event({ code: "KeyA", key: "å", target: input as unknown as EventTarget }))).toBe("A");
  });

  it("contenteditable counts as a text field", () => {
    expect(altShortcutFor(event({ code: "Digit2", key: "€", target: editable as unknown as EventTarget }))).toBeNull();
    expect(altShortcutFor(event({ code: "Digit2", key: "™", target: editable as unknown as EventTarget }))).toBe("2");
  });

  it("a non-editable target always fires, whatever the key", () => {
    const run = vi.fn();
    const e = event({ code: "Digit5", key: "[", target: body as unknown as EventTarget });
    expect(runAltShortcut(e, { "5": run })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(altShortcutFor(event({ code: "KeyM", key: "µ", target: null }))).toBe("M");
  });

  it("ignores Alt with Ctrl, Cmd or Shift, and keys with no shortcut", () => {
    expect(altShortcutFor(event({ ctrlKey: true }))).toBeNull();
    expect(altShortcutFor(event({ metaKey: true }))).toBeNull();
    expect(altShortcutFor(event({ shiftKey: true, key: "Π" }))).toBeNull();
    expect(altShortcutFor(event({ code: "KeyX", key: "≈" }))).toBeNull();
  });
});
