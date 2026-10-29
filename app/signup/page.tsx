import { redirect } from 'next/navigation';
import { serverLocale } from '@/lib/server-locale';
import { safeReturnPath } from '@/lib/return-path';
export const dynamic = 'force-dynamic';
export default async function SignUp({searchParams}:{searchParams:Promise<{lang?:string;next?:string}>}) {
  const query=await searchParams;
  const parameters=new URLSearchParams({mode:'signup',lang:await serverLocale(query.lang),next:safeReturnPath(query.next)});
  redirect(`/signin?${parameters.toString()}`);
}
