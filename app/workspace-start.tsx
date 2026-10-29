import Link from "next/link";
import { isPlainNavigation, workspaceHref } from "@/lib/workspace-location";
import { type Locale } from "@/lib/i18n";
import { workspaceStartCopy, type WorkspaceStartId } from "@/lib/workspace-start-copy";

const destinations = ["personal-lab", "code-workspace", "reverse-engineering"] as const;

function WorkflowMark({ id }: { id: WorkspaceStartId }) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {id === "personal-lab" ? <><path d="M6 25V13h7v12M19 25V6h7v19M4 26h24" /><path d="m7 7 3-3 3 3M10 4v6" /></>
      : id === "code-workspace" ? <><path d="m11 9-7 7 7 7m10-14 7 7-7 7M18 5l-4 22" /></>
        : <><path d="M11 5H5v6m16-6h6v6M5 21v6h6m16-6v6h-6" /><path d="m16 10 6 3v7l-6 3-6-3v-7l6-3Z" /><path d="m10 13 6 3 6-3m-6 3v7" /></>}
  </svg>;
}

/** Real destinations; no demo data or additional animation lifecycle. */
export function WorkspaceStart({ locale, onNavigate }: { locale: Locale; onNavigate?: (section: "personal-lab" | "code-workspace") => void }) {
  const copy = workspaceStartCopy(locale);
  return <section className="workspace-start" id="workspace-paths" aria-labelledby="workspace-start-title">
    <div className="workspace-start-intro">
      <h2 id="workspace-start-title">{copy.sectionLabel}</h2>
      <p>{copy.heroNote}</p>
    </div>
    <ul className="workspace-start-list">
      {destinations.map((id, index) => {
        const content = <><span className="workspace-start-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="workspace-start-mark"><WorkflowMark id={id} /></span><span className="workspace-start-text"><strong>{copy.workflows[id].title}</strong><span>{copy.workflows[id].description}</span></span><svg className="workspace-start-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></>;
        return <li key={id}>{id === "reverse-engineering" ? <Link href={`/reverse-engineering?lang=${locale}`} className="workspace-start-action">{content}</Link> : <a href={workspaceHref(id, `lang=${locale}`)} className="workspace-start-action" onClick={event => {
          if (!onNavigate || !isPlainNavigation(event)) return;
          event.preventDefault();
          onNavigate(id);
        }}>{content}</a>}</li>;
      })}
    </ul>
  </section>;
}
