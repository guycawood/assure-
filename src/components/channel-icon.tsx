// WhatsApp and WeChat marks, drawn inline so they work in both themes and need no image files. They identify the channel a message travelled on.
export type ChannelKey = "whatsapp" | "wechat" | "portal";

export const CHANNEL_LABEL: Record<ChannelKey, string> = { whatsapp: "WhatsApp", wechat: "WeChat", portal: "Portal" };

export function ChannelIcon({ channel, size = 18, className, label = true }: { channel: ChannelKey | string; size?: number; className?: string; label?: boolean }) {
  const name = CHANNEL_LABEL[channel as ChannelKey] ?? channel;
  const a11y = label ? { role: "img" as const, "aria-label": name } : { "aria-hidden": true as const };
  if (channel === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...a11y}>
        <circle cx="12" cy="12" r="12" fill="#25D366" />
        <path d="M12 5.2a6.8 6.8 0 0 0-5.85 10.27L5.2 18.8l3.4-.93A6.8 6.8 0 1 0 12 5.2z" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9.6 9.1c.2-.4.45-.4.65-.4l.45.01c.15 0 .35.05.5.4l.6 1.4c.05.12.02.28-.08.4l-.35.42c-.1.12-.1.25-.03.38.45.8 1.25 1.5 2.15 1.9.15.07.3.05.4-.07l.5-.6c.1-.13.25-.17.4-.1l1.3.62c.15.07.2.2.17.37-.1.8-.9 1.4-1.7 1.35-2.7-.2-5.1-2.6-5.1-4.6 0-.5.1-.9.4-1.5z" fill="#fff" />
      </svg>
    );
  }
  if (channel === "wechat") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...a11y}>
        <circle cx="12" cy="12" r="12" fill="#07C160" />
        <ellipse cx="10" cy="10.2" rx="5.6" ry="4.6" fill="#fff" />
        <ellipse cx="15" cy="14.6" rx="4.3" ry="3.5" fill="#fff" stroke="#07C160" strokeWidth="1" />
        <circle cx="8.2" cy="9" r="0.8" fill="#07C160" /><circle cx="11.8" cy="9" r="0.8" fill="#07C160" />
        <circle cx="13.5" cy="14.2" r="0.65" fill="#07C160" /><circle cx="16.4" cy="14.2" r="0.65" fill="#07C160" />
      </svg>
    );
  }
  return null;
}

/** The icon and its name side by side. */
export function ChannelTag({ channel, className }: { channel: ChannelKey | string; className?: string }) {
  if (channel !== "whatsapp" && channel !== "wechat") return null;
  return <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}><ChannelIcon channel={channel} label={false} />{CHANNEL_LABEL[channel]}</span>;
}
