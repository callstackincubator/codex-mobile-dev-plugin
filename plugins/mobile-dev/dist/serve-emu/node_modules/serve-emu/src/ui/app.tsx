import { useDeviceSessionSnapshot } from "./lib/device-session-store";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { StatusBar } from "./components/status-bar";
import type { AccessibilityNode } from "./components/accessibility-panel";
import { DevicePanel } from "./components/device-panel";
import { DeviceStream } from "./components/device-stream";
import { ControlBar, type HardwareKey } from "./components/control-bar";
import { SideTools } from "./components/side-tools";
import { useStream, type DeviceSize, type Sender } from "./lib/use-stream";

// Android KeyEvent meta state bits (AMETA_*).
const AMETA_SHIFT_ON = 0x1;
const AMETA_ALT_ON = 0x2;
const AMETA_CTRL_ON = 0x1000;

// Non-printable Android keycodes for editing/navigation keys the browser
// reports with a multi-character e.key (so the plain text-injection path
// below never sees them).
const NAV_KEYCODES: Record<string, number> = {
  Backspace: 67,
  Delete: 112,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Tab: 61,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

// Keyed by e.code (physical key) rather than e.key so Ctrl/Cmd shortcuts
// keep working on non-QWERTY layouts.
const SHORTCUT_KEYCODES: Record<string, number> = {
  KeyA: 29, // select all
  KeyC: 31, // copy
  KeyV: 50, // paste
  KeyX: 52, // cut
  KeyZ: 54, // undo
  KeyY: 53, // redo
};

type StreamControls = {
  canvasRef: RefObject<HTMLCanvasElement>;
  send: Sender;
  deviceSize: DeviceSize | null;
};

const StreamControlsContext = createContext<StreamControls | null>(null);

const StableDevicePanel = memo(DevicePanel);
const StableControlBar = memo(ControlBar);

function useStreamControls(): StreamControls {
  const controls = useContext(StreamControlsContext);
  if (!controls) throw new Error("StreamControlsContext is missing");
  return controls;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, send, clearControlError } = useStream(canvasRef);
  const deviceWidth = state.deviceSize?.width;
  const deviceHeight = state.deviceSize?.height;
  const controls = useMemo<StreamControls>(
    () => ({
      canvasRef,
      send,
      deviceSize:
        deviceWidth === undefined || deviceHeight === undefined
          ? null
          : { width: deviceWidth, height: deviceHeight },
    }),
    [send, deviceWidth, deviceHeight],
  );

  return (
    <>
      <StatusBar controlError={state.controlError} onDismissError={clearControlError} status={state.status} deviceSize={state.deviceSize} fps={state.fps} stats={state.stats} />
      <StreamControlsContext.Provider value={controls}>
        <AppShell />
      </StreamControlsContext.Provider>
    </>
  );
}

const AppShell = memo(function AppShell() {
  const { canvasRef, send, deviceSize } = useStreamControls();
  const keyboardProxyRef = useRef<HTMLInputElement>(null);
  const deviceSession = useDeviceSessionSnapshot();
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [accessibilityNodes, setAccessibilityNodes] = useState<AccessibilityNode[]>([]);
  const [highlightedAccessibilityId, setHighlightedAccessibilityId] = useState<string | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(true);
  const [keyboardActive, setKeyboardActive] = useState(true);

  useEffect(() => {
    setAccessibilityNodes([]);
    setHighlightedAccessibilityId(null);
  }, [deviceSession.revision]);

  // Keyboard input is captured on a hidden, always-focusable proxy input
  // rather than document.body: that's what lets the OS/browser IME attach
  // and fire composition events for CJK and other composed text, and it
  // gives an unambiguous signal (focus/blur) for whether keys are currently
  // routed to the device vs. a sidebar text field.
  useEffect(() => {
    keyboardProxyRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const proxy = keyboardProxyRef.current;
    if (!proxy) return;

    const metaStateFor = (e: KeyboardEvent) =>
      (e.shiftKey ? AMETA_SHIFT_ON : 0) |
      (e.ctrlKey ? AMETA_CTRL_ON : 0) |
      (e.altKey ? AMETA_ALT_ON : 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === "Escape") {
        e.preventDefault();
        send({ type: "back" });
        return;
      }

      const shortcutKeycode = (e.ctrlKey || e.metaKey) ? SHORTCUT_KEYCODES[e.code] : undefined;
      if (shortcutKeycode !== undefined) {
        e.preventDefault();
        send({ type: "key", keycode: shortcutKeycode, metaState: AMETA_CTRL_ON });
        return;
      }

      const navKeycode = NAV_KEYCODES[e.key];
      if (navKeycode !== undefined) {
        e.preventDefault();
        send({ type: "key", keycode: navKeycode, metaState: metaStateFor(e) });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        send({ type: "key", keycode: 66, metaState: metaStateFor(e) });
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        send({ type: "text", text: e.key });
      }
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      proxy.value = "";
      if (e.data) send({ type: "text", text: e.data });
    };

    const onFocus = () => setKeyboardActive(true);
    const onBlur = () => setKeyboardActive(false);

    proxy.addEventListener("keydown", onKeyDown);
    proxy.addEventListener("compositionend", onCompositionEnd);
    proxy.addEventListener("focus", onFocus);
    proxy.addEventListener("blur", onBlur);
    return () => {
      proxy.removeEventListener("keydown", onKeyDown);
      proxy.removeEventListener("compositionend", onCompositionEnd);
      proxy.removeEventListener("focus", onFocus);
      proxy.removeEventListener("blur", onBlur);
    };
  }, [send]);

  const onPress = useCallback(
    (key: HardwareKey) => send({ type: key }),
    [send],
  );

  return (
    <>
      <main
        className={devicesOpen ? "app-layout devices-open" : "app-layout devices-collapsed"}
        data-app-shell-renders={renderCountRef.current}
      >
        <aside className="device-sidebar" aria-label="Devices sidebar">
          <div className="device-sidebar-header">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setDevicesOpen((open) => !open)}
              aria-label={devicesOpen ? "Collapse devices sidebar" : "Expand devices sidebar"}
              title={devicesOpen ? "Collapse devices" : "Expand devices"}
            >
              <SidebarIcon collapsed={!devicesOpen} />
            </button>
            {devicesOpen ? <span>Devices</span> : null}
          </div>
          {devicesOpen ? <StableDevicePanel /> : null}
        </aside>
        <div className="device">
          <DeviceStream
            canvasRef={canvasRef}
            send={send}
            accessibilityEnabled={accessibilityEnabled}
            accessibilityNodes={accessibilityNodes}
            highlightedAccessibilityId={highlightedAccessibilityId}
            onAccessibilityHover={setHighlightedAccessibilityId}
            deviceSize={deviceSize}
            keyboardProxyRef={keyboardProxyRef}
            keyboardActive={keyboardActive}
          />
          <input
            ref={keyboardProxyRef}
            className="keyboard-proxy"
            aria-hidden="true"
            tabIndex={-1}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <aside className="side-panel">
          <SideTools key={deviceSession.revision}
            accessibilityEnabled={accessibilityEnabled}
            accessibilityNodes={accessibilityNodes}
            highlightedAccessibilityId={highlightedAccessibilityId}
            onAccessibilityEnabledChange={setAccessibilityEnabled}
            onAccessibilityNodesChange={setAccessibilityNodes}
            onAccessibilityHighlight={setHighlightedAccessibilityId}
          />
        </aside>
      </main>
      <StableControlBar onPress={onPress} />
    </>
  );
});

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={collapsed ? "sidebar-icon collapsed" : "sidebar-icon"}
      viewBox="0 0 20 20"
      fill="none"
    >
      <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3.75V16.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.5 7.5L10 10L12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
