import type { Locale } from "./i18n";

export type MascotPersonality = "curious" | "buoyant" | "thoughtful" | "spirited" | "composed";
export type MascotActivity = "idle" | "loading" | "success" | "error";
export type AgentMascotConfig = {
  agentId: string; sourceIndex: number; asset: string; personality: MascotPersonality;
  idleDuration: number; phase: number; danceDuration: number; danceDelay: number; amplitude: number; tilt: number; gestureStrength: number;
};

// Stable explicit assignments: filtering or reordering never changes a companion.
const assignments: readonly [string, MascotPersonality][] = [
  ["jev", "curious"], ["laya", "composed"], ["stuntd", "buoyant"],
  ["nanobot", "thoughtful"], ["nanoclaw", "spirited"], ["picoclaw", "curious"],
  ["zeroclaw", "composed"], ["langgraph", "thoughtful"], ["crewai", "buoyant"],
  ["agent-framework", "composed"], ["pydantic-ai", "curious"], ["mastra", "spirited"],
  ["flowise", "buoyant"], ["dify", "thoughtful"], ["paperclip", "composed"],
  ["browser-use", "curious"], ["openhands", "spirited"],
  ["openclaw", "buoyant"], ["letta", "thoughtful"], ["lindy", "composed"], ["hermes", "spirited"],
  ["grok", "curious"], ["meta", "composed"], ["manus", "thoughtful"], ["openai", "buoyant"],
];

export const AGENT_MASCOTS: readonly AgentMascotConfig[] = assignments.map(([agentId, personality], index) => ({
  agentId, sourceIndex: index + 1,
  asset: "/mascots/mascot-" + String(index + 1).padStart(2, "0") + ".webp",
  personality, idleDuration: 4.8 + index * .137, phase: -(index * .619),
  danceDuration: 1050 + index * 17, danceDelay: 15_000 + index * 913,
  amplitude: 2 + (index % 3) * .4, tilt: 1.6 + (index % 4) * .3, gestureStrength: .82 + index * .006,
}));
const byAgent = new Map(AGENT_MASCOTS.map(config => [config.agentId, config]));
export function agentMascotFor(agentId: string) { return byAgent.get(agentId); }

const motionLabels: Record<Locale, readonly [string, string]> = {
  ar: ["إيقاف حركة الشخصيات", "تشغيل حركة الشخصيات"],
  en: ["Pause character motion", "Resume character motion"],
  fr: ["Mettre les personnages en pause", "Animer les personnages"],
  es: ["Pausar personajes", "Reanudar personajes"],
  zh: ["暂停角色动画", "恢复角色动画"],
  ko: ["캐릭터 움직임 멈추기", "캐릭터 움직임 재개"],
  ur: ["کرداروں کی حرکت روکیں", "کرداروں کی حرکت چلائیں"],
  fa: ["توقف حرکت شخصیت‌ها", "ادامه حرکت شخصیت‌ها"],
  pt: ["Pausar personagens", "Retomar personagens"],
  it: ["Metti in pausa i personaggi", "Riprendi i personaggi"],
  ru: ["Приостановить движение персонажей", "Продолжить движение персонажей"],
  de: ["Figuren pausieren", "Figuren weiterbewegen"],
  nl: ["Personages pauzeren", "Personages hervatten"],
};
export function mascotMotionLabel(locale: Locale, paused: boolean) { return motionLabels[locale][paused ? 1 : 0]; }


