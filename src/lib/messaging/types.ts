export type Outbound = {
  id: string; channel: "whatsapp" | "wechat"; kind: "text" | "template"; address: string; body: string; attempts: number;
  template: { name: string; language: string; vars: string[] } | null;
};
export type SendResult = { ok: true; external: string | null } | { ok: false; error: string; permanent: boolean };
