import type { LiveReportKey, LiveReportQuery, LiveReportRange } from './types.js';

const keys: readonly LiveReportKey[] = ['sales','purchase','stock','receivables','payables','profit','cash','expenses','audit'];
const sortKeys = ['date','amount','name','reference'] as const;

export class LiveReportQueryError extends Error {
  constructor(message: string) { super(message); this.name='LiveReportQueryError'; }
}

function dhakaToday(): string {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const field=(type:string)=>parts.find(x=>x.type===type)?.value ?? '';
  return field('year')+'-'+field('month')+'-'+field('day');
}
function validDate(value:string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===value;
}
function dateRange(url:URL): LiveReportRange {
  const today=dhakaToday();
  const from=url.searchParams.get('from')??today.slice(0,8)+'01';
  const to=url.searchParams.get('to')??today;
  if (!validDate(from)||!validDate(to)) throw new LiveReportQueryError('Enter valid YYYY-MM-DD dates.');
  const days=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
  if (days<0 || days>365) throw new LiveReportQueryError('Date range must be ordered and at most 366 days.');
  return {from,to};
}
export function parseLiveReportRange(url: URL): LiveReportRange { return dateRange(url); }

function integer(value:string|null, fallback:number, name:string):number {
  if (value===null) return fallback;
  if(!/^[1-9]\d*$/.test(value)) throw new LiveReportQueryError('Invalid '+name+'.');
  const result=Number(value);
  if(!Number.isSafeInteger(result) || result>10000) throw new LiveReportQueryError('Invalid '+name+'.');
  return result;
}
export function parseLiveReportQuery(url:URL): LiveReportQuery {
  const report=url.searchParams.get('report')??'sales';
  if(!keys.includes(report as LiveReportKey)) throw new LiveReportQueryError('Unknown report.');
  const page=integer(url.searchParams.get('page'),1,'page');
  const size=integer(url.searchParams.get('pageSize'),50,'page size');
  if(size!==50 && size!==100) throw new LiveReportQueryError('Page size must be 50 or 100.');
  const search=(url.searchParams.get('search')??'').trim();
  if(search.length>200) throw new LiveReportQueryError('Search is too long.');
  const sort=url.searchParams.get('sort')??'date';
  if(!sortKeys.includes(sort as LiveReportQuery['sort'])) throw new LiveReportQueryError('Unsupported sort column.');
  const direction=url.searchParams.get('direction')??'desc';
  if(direction!=='asc' && direction!=='desc') throw new LiveReportQueryError('Unsupported sort order.');
  return {report:report as LiveReportKey,...dateRange(url),page,pageSize:size as 50|100,search,
    sort:sort as LiveReportQuery['sort'],direction};
}
