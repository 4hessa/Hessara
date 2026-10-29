import {notFound} from 'next/navigation';
import Link from 'next/link';
import {BrandLockup} from '../../brand-mark';
import {labReportService} from '@/lib/lab-reports';
import {serverLocale} from '@/lib/server-locale';
import {isRTL} from '@/lib/i18n';
import {LabReportView} from '../../lab-report-view';
import {labExtras} from '@/lib/lab-extras-copy';
import '../../lab-panel.css';
export const dynamic='force-dynamic';
export const metadata={title:'HESSARA · Report',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function SharedReportPage({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 let shared;
 try{shared=await(await labReportService()).shared(token);}catch{notFound();}
 const locale=await serverLocale(shared.report.experiment.locale),x=labExtras(locale);
 return <main className="lab-panel lab-public-report" lang={locale} dir={isRTL(locale)?'rtl':'ltr'}><Link className="lab-home-link" href="/" aria-label="HESSARA"><BrandLockup /></Link><h1>{x.report}</h1><p>{x.expires}: {new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(shared.expiresAt))}</p><LabReportView report={shared.report} locale={locale}/></main>;
}
