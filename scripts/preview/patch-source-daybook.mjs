/**
 * Phase 6: preserve the original HisabIQ Daybook, replace demo rows with
 * authenticated D1 records; fail closed when upstream JSX changes.
 */
export function patchSourceDaybook(source) {
 const edit=(before,after)=>{
   if(source.split(before).length!==2)
     throw Error('Daybook upstream contract changed: '+before.slice(0,60));
   source=source.replace(before,after);
 };
 edit("import { daybookTransactions } from '../data/daybook';",
   "import { usePhase6Daybook } from '../integration/usePhase6Daybook';\nimport { businessToday } from '../utils/dateRange';");
 edit("from: '2026-10-07',","from: businessToday(),");
 edit("to: '2026-10-07',","to: businessToday(),");
 edit("  const [transactions] = useState<UnifiedTransaction[]>(daybookTransactions);","");
 edit("  const [filters, setFilters] = useState<DaybookFilterState>(() => filtersFromParams(searchParams));",
   "  const [filters, setFilters] = useState<DaybookFilterState>(() => filtersFromParams(searchParams));\n  const {transactions,permitted,loading,error,page,pageSize,setPage,setPageSize,totalPages,totalRows}=usePhase6Daybook(filters,entryDateView);");
 edit("const exportDaybook=()=>downloadReport('hisabiq-daybook.csv',reportHeaders,filtered.map(reportRow));",
   "const exportDaybook=()=>downloadReport('hisabiq-daybook-page-'+page+'.csv',reportHeaders,filtered.map(reportRow));\n  if(!permitted)return <main className=\"p-4\" role=\"alert\">You do not have permission to view Daybook.</main>;");
 edit('description="Money in and money out · টাকা আসা–যাওয়া. UI preview; review changes at the source."',
   'description="Money in and money out · টাকা আসা–যাওয়া. Verified source records, current page."');
 edit('descriptionBn="টাকা আসা-যাওয়ার হিসাব। শুধু প্রিভিউ; সংশোধনের জন্য মূল লেনদেনে যান।"',
   'descriptionBn="টাকা আসা-যাওয়ার মূল হিসাব। সংশোধনের জন্য মূল লেনদেনে যান।"');
 edit('      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">',
   '      {loading && <p role="status">Loading posted transactions…</p>}\n      {error && <p role="alert" className="text-danger">{error}</p>}\n      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">');
 edit("const summary = useMemo(() => cashflowSummary(filtered), [filtered]);",
   "const summary = useMemo(() => cashflowSummary(filtered), [filtered]); // Page-only totals; never label as all-period financial balances.");
 edit('                      transaction={transaction}',
   '                      transaction={transaction}\n                      readOnlyLive');
 edit('        transaction={detail}',
   '        transaction={detail}\n        readOnlyLive');
 edit('          </Table>\n        </div>\n      </div>\n\n      <TransactionDetailsDialog',
   '          </Table>\n        </div>\n        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-xs text-ink-500">\n          <span>{filtered.length} of {totalRows} records · Page {page}/{totalPages} · Current page only</span>\n          <div className="flex items-center gap-2">\n            <select aria-label="Daybook rows per page" value={pageSize} onChange={e=>setPageSize(Number(e.target.value) as 50|100)} className="h-9 rounded-md border border-border bg-card px-2">\n              <option value={50}>50</option><option value={100}>100</option>\n            </select>\n            <Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(n=>Math.max(1,n-1))}>Previous</Button>\n            <Button variant="outline" size="sm" disabled={page>=totalPages} onClick={()=>setPage(n=>n+1)}>Next</Button>\n          </div>\n        </div>\n      </div>\n\n      <TransactionDetailsDialog');
 return source;
}

export function patchSourceDaybookActions(source) {
 const edit=(a,b)=>{
  if(source.split(a).length!==2)throw Error('DaybookActions upstream contract changed: '+a);
  source=source.replace(a,b);
 };
 edit("  onDuplicate\n}: {", "  onDuplicate,\n  readOnlyLive = false\n}: {");
 edit("  transaction: UnifiedTransaction;","  transaction: UnifiedTransaction;\n  readOnlyLive?: boolean;");
 edit("const availability = daybookActionAvailability(transaction.source, demoPermissions);",
  "const availability = readOnlyLive ? {open:true,edit:false,delete:false} : daybookActionAvailability(transaction.source, demoPermissions);");
 edit("{extra.includes('duplicate') && transaction.status !== 'Deleted' &&",
  "{!readOnlyLive && extra.includes('duplicate') && transaction.status !== 'Deleted' &&");
 return source;
}

export function patchSourceDaybookDetails(source) {
 const edit=(a,b)=>{
  if(source.split(a).length!==2)throw Error('DaybookDetails upstream contract changed: '+a);
  source=source.replace(a,b);
 };
 edit("  onDuplicate\n}: {", "  onDuplicate,\n  readOnlyLive = false\n}: {");
 edit("  transaction: UnifiedTransaction | null;", "  transaction: UnifiedTransaction | null;\n  readOnlyLive?: boolean;");
 edit("const availability = daybookActionAvailability(transaction.source, demoPermissions);",
  "const availability = readOnlyLive ? {open:true,edit:false,delete:false} : daybookActionAvailability(transaction.source, demoPermissions);");
 edit("{extras.includes('duplicate') && transaction.status !== 'Deleted' &&",
  "{!readOnlyLive && extras.includes('duplicate') && transaction.status !== 'Deleted' &&");
 return source;
}
