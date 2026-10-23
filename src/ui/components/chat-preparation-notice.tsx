import { preparesChatMessages } from "../chat-message.ts";

export function ChatPreparationNotice() {
  return preparesChatMessages() ? <p className="px-2 py-1 text-xs text-muted-foreground" role="note">Questions are prepared in chat. Review the text and press Send to start.</p> : null;
}
