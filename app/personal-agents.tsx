"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import { isRTL, type Locale } from "@/lib/i18n";
import { personalAgentCopy, personalAgentViewCopy, type PersonalAgentId } from "@/lib/personal-agent-i18n";
import { SuperAgentMascot } from "./super-agent-mascot";
import styles from "./personal-agents.module.css";

const agents: { id: PersonalAgentId; name: string; url: string; docs: string }[] = [
  { id: "openclaw", name: "OpenClaw", url: "https://www.openclaw.org/", docs: "https://docs.openclaw.ai/start/getting-started" },
  { id: "letta", name: "Letta", url: "https://www.letta.com/agent/", docs: "https://docs.letta.com/agent-sdk" },
  { id: "lindy", name: "Lindy", url: "https://www.lindy.ai/", docs: "https://docs.lindy.ai/" },
  { id: "hermes", name: "Hermes", url: "https://hermes-agent.nousresearch.com/", docs: "https://hermes-agent.nousresearch.com/docs/getting-started/installation" },
];

export function PersonalAgents({ locale, sessionMode='none', motionPaused=false }: { locale: Locale; sessionMode?:'guest'|'account'|'none'; motionPaused?: boolean }) {
  const c = personalAgentCopy[locale];
  return (
    <section className={styles.section} aria-labelledby="personal-agents-title" lang={locale} dir={isRTL(locale) ? "rtl" : "ltr"}>
      <header className={styles.heading}>
        <h3 id="personal-agents-title">{c.title}</h3>
        <p>{c.intro}</p>
      </header>
      <div className={styles.grid}>
        {agents.map((agent) => {
          const copy = personalAgentViewCopy(locale,agent.id,sessionMode);
          return (
            <article className={styles.card} key={agent.id} id={`personal-agent-${agent.id}`} data-agent-id={agent.id} tabIndex={-1} aria-labelledby={`personal-name-${agent.id}`}>
              <div className={styles.identity}>
                <h4 id={`personal-name-${agent.id}`} lang="en" dir="ltr">{agent.name}</h4>
                <span className={styles.status}>{c.status}</span>
              </div>
              <div className={styles.stage}>
                <SuperAgentMascot agentId={agent.id} motionPaused={motionPaused} />
              </div>
              <div className={styles.copy}>
                <h5>{copy.title}</h5>
                <p>{copy.description}</p>
              </div>
              <details className={styles.guide}>
                <summary>{c.guide}<ChevronDown size={17} aria-hidden="true" /></summary>
                <ol>{copy.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                <p className={styles.note}>{copy.note}</p>
                <a href={agent.docs} target="_blank" rel="noopener noreferrer">{c.source}<ArrowUpRight size={15} aria-hidden="true" /></a>
              </details>
              <a className={styles.open} href={agent.url} target="_blank" rel="noopener noreferrer" aria-label={`${c.open}: ${agent.name}`}>
                <span>{c.open}</span><ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </article>
          );
        })}
      </div>
      <footer className={styles.foot}>
        <p>{c.costs}</p>
        <span>{c.reviewed}: <time dateTime="2026-10-08">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date("2026-10-08T12:00:00Z"))}</time></span>
      </footer>
    </section>
  );
}

