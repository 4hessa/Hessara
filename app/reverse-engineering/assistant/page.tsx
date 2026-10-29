import Assistant from "./assistant";
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string; job?: string }> }) { const query = await searchParams; return <Assistant initialProject={query.project} initialJob={query.job} />; }
