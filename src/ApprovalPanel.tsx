import { For, Show, createMemo } from "solid-js";
import { actionLabel, footerHint, type ApprovalAction, type ApprovalRequest } from "./approval";
import { textWidth } from "./ui-format";

export function ApprovalPanel(props: {
  request: ApprovalRequest;
  selectedIndex: number;
  fullscreen: boolean;
  width: number;
  height: number;
  workspaceLabel: string;
  branch?: string;
  queueSize: number;
  busy?: boolean;
  onSelect: (index: number) => void;
  onConfirm: () => void;
}) {
  if (!props.request?.details) {
    console.error("[MINT DEBUG] Invalid approval request:", props.request);
  }

  const details = () => props.request?.details;
  const actions = () => props.request?.actions ?? [];
  const selected = () => actions()[props.selectedIndex] ?? props.request?.defaultAction ?? "reject";
  const compact = () => props.width < 80;
  const panelWidth = () => Math.max(28, Math.min(props.width - 2, props.fullscreen ? props.width - 2 : Math.max(56, props.width - 4)));
  const panelHeight = () => (props.fullscreen ? Math.max(12, props.height - 2) : undefined);
  const maxPreviewLines = () => (props.fullscreen ? Math.max(8, props.height - 14) : 6);
  const previewLines = createMemo(() => {
    const req = props.request;
    const d = details();
    const fullscreenDetails = req?.fullscreenDetails ?? [];
    const source = props.fullscreen
      ? fullscreenDetails
      : d?.kind === "file-apply"
        ? (d.preview ?? "").split(/\r?\n/)
        : fullscreenDetails;
    return source.slice(0, maxPreviewLines());
  });
  const metaRight = () => {
    const parts = [props.workspaceLabel];
    if (props.branch) parts.push(props.branch);
    parts.push("• MINT");
    return parts.join(":");
  };
  const detailSectionLabel = () => details()?.kind === "update" ? "Command" : "Patterns";

  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((props.width - panelWidth()) / 2))}
      bottom={0}
      width={panelWidth()}
      height={panelHeight()}
      zIndex={80}
      backgroundColor="#242438"
      border={["left"]}
      borderColor="#f9e2af"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      gap={0}
      overflow="hidden"
    >
      <text fg="#f9e2af" wrapMode="none" truncate={true}>
        {`┃  ${props.request?.title ?? "Approval"}${props.queueSize > 1 ? ` (${props.queueSize} pending)` : ""}`}
      </text>
      <text fg="#cdd6f4" wrapMode="word" width="100%">
        {`┃    ${props.request?.description ?? ""}`}
      </text>
      <text fg="#9399b2" wrapMode="word" width="100%">
        {`┃    ${props.request?.resource ?? ""}`}
      </text>
      <text fg="#9399b2" wrapMode="none">{"┃"}</text>
      <text fg="#cba6f7" wrapMode="none">{`┃  ${detailSectionLabel()}`}</text>
      <text fg="#9399b2" wrapMode="none">{"┃"}</text>
      <For each={(props.request?.patterns ?? []).slice(0, props.fullscreen ? 12 : 3)}>
        {(pattern) => <text fg="#cdd6f4" wrapMode="word" width="100%">{`┃  - ${pattern}`}</text>}
      </For>
      <Show when={props.request?.kind === "permission" && details()?.kind === "command"}>
        <text fg="#9399b2" wrapMode="none">{"┃"}</text>
        <text fg="#9399b2" wrapMode="word" width="100%">
          {`┃  Scope: ${props.request?.scopeKey ?? ""}`}
        </text>
      </Show>
      <text fg="#9399b2" wrapMode="none">{"┃"}</text>
      <box flexDirection="column" gap={0} width="100%" minWidth={0} flexGrow={1} overflow="hidden">
        <For each={previewLines()}>
          {(line) => <text fg="#9399b2" wrapMode={props.fullscreen ? "word" : "none"} truncate={!props.fullscreen} width="100%">{`┃  ${line}`}</text>}
        </For>
        <Show when={(() => {
          const req = props.request;
          const d = details();
          const fullscreenDetails = req?.fullscreenDetails ?? [];
          const source = props.fullscreen
            ? fullscreenDetails
            : d?.kind === "file-apply"
              ? (d.preview ?? "").split(/\r?\n/)
              : fullscreenDetails;
          return source.length > previewLines().length;
        })()}>
          <text fg="#9399b2" wrapMode="none">{`┃  … ${props.fullscreen ? "scroll not available; showing truncated details" : "ctrl+f fullscreen for full details"}`}</text>
        </Show>
      </box>
      <box flexDirection="row" justifyContent="space-between" gap={1} width="100%" minWidth={0}>
        <box flexDirection="row" gap={1} flexShrink={1} minWidth={0} overflow="hidden">
          <For each={actions()}>
            {(action, index) => {
              const isSelected = () => index() === props.selectedIndex;
              const danger = action === "reject" || action === "cancel";
              const fg = () => isSelected() ? "#1e1e2e" : danger ? "#f38ba8" : action === "allow-always" ? "#cba6f7" : "#a6e3a1";
              const bg = () => isSelected() ? (danger ? "#f38ba8" : action === "allow-always" ? "#cba6f7" : "#a6e3a1") : "transparent";
              return (
                <box
                  backgroundColor={bg()}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseUp={(e) => { e.stopPropagation(); props.onSelect(index()); props.onConfirm(); }}
                  onMouseDown={(e) => { e.stopPropagation(); props.onSelect(index()); }}
                >
                  <text fg={fg()} wrapMode="none">{actionLabel(action as ApprovalAction)}</text>
                </box>
              );
            }}
          </For>
          <Show when={!compact()}>
            <text fg="#9399b2" wrapMode="none" truncate={true}>{props.fullscreen ? "ctrl+f compact  ⇆ select  enter confirm" : footerHint(props.request?.kind ?? "apply").replace(/^(?:Allow once   Allow always   Reject|Apply   Reject|Yes, update   Cancel)\s+/, "")}</text>
          </Show>
        </box>
        <Show when={props.width >= 60}>
          <text fg="#9399b2" wrapMode="none" flexShrink={0} truncate={true}>{metaRight()}</text>
        </Show>
      </box>
      <Show when={compact()}>
        <text fg="#9399b2" wrapMode="none" truncate={true}>{props.fullscreen ? "ctrl+f compact · ⇆ · enter" : "ctrl+f · ⇆ · enter"}</text>
      </Show>
      <Show when={props.busy}>
        <text fg="#fab387" wrapMode="none">{"┃  working…"}</text>
      </Show>
    </box>
  );
}
