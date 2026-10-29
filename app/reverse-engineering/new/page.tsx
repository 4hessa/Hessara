import NewAnalysisWorkflow from "./workflow";
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; engine?: string }> }) { const query = await searchParams; return <NewAnalysisWorkflow initialProject={query.project} initialEngine={query.engine} />; }
