import {serverLocale} from '@/lib/server-locale';
import {labExtras} from '@/lib/lab-extras-copy';
import Link from 'next/link';
import {BrandLockup} from '../brand-mark';
export default async function MissingReport(){const locale=await serverLocale();return <main style={{maxWidth:720,margin:'80px auto',padding:24}}><Link href="/" aria-label="HESSARA"><BrandLockup /></Link><h1>{labExtras(locale).unavailable}</h1></main>;}
