import { JobWorkspace } from "./workspace";
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) { return <JobWorkspace jobId={(await params).jobId} />; }
