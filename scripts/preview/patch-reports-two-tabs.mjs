/**
 * Phase 5 presentation-only two-tab Reports navigation.
 *
 * Applied to the GENERATED React build copy. Never edit the pinned
 * apps/hisabiq-web submodule. Fail closed when source anchors change.
 */
function replaceOnce(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error('Reports source anchor missing or ambiguous: ' + anchor.slice(0, 70));
  }
  return source.replace(anchor, replacement);
}

export function patchReportsNav(source) {
  let next = replaceOnce(
    source,
    'export function ReportsNav({',
    "const primaryScreens = reportScreens.filter(item => item.id === 'overview' || item.id === 'library');\n\nexport function ReportsNav({"
  );
  next = replaceOnce(next, 'reportScreens.map((item, index)', 'primaryScreens.map((item, index)');
  next = replaceOnce(next, 'reportScreens[index-1]', 'primaryScreens[index-1]');
  next = replaceOnce(next, 'reportScreens.length - 1', 'primaryScreens.length - 1');
  next = replaceOnce(next, 'reportScreens.length) %', 'primaryScreens.length) %');
  next = replaceOnce(next, 'reportScreens.length;', 'primaryScreens.length;');
  next = replaceOnce(next, 'onChange(reportScreens[next].id)', 'onChange(primaryScreens[next].id)');
  next = replaceOnce(next, '"reports-screen-" + reportScreens[next].id', '"reports-screen-" + primaryScreens[next].id');
  next = replaceOnce(next,
    '<span>{text(item.en, item.bn)}</span>',
    "<span>{item.id === 'overview' ? text('Dashboard', 'ড্যাশবোর্ড') : text('Report Library', 'রিপোর্ট লাইব্রেরি')}</span>");
  next = replaceOnce(next,
    '{showHelper && <span className="hidden font-bn text-[11px] font-normal text-ink-500 xl:inline">{item.bn}</span>}',
    '{showHelper && <span className="hidden font-bn text-[11px] font-normal text-ink-500 xl:inline">{item.id === "overview" ? "ড্যাশবোর্ড" : "রিপোর্ট লাইব্রেরি"}</span>}');
  return next;
}

export function patchReportsPage(source) {
  let next = replaceOnce(source,
    'const screen=reportScreenFromParams(params);',
    "const requestedScreen=reportScreenFromParams(params);\n const screen=requestedScreen==='overview'?'overview':'library';");
  next = replaceOnce(next,
    "const selectScreen=(nextScreen:ReportScreen)=>{const next=reportDefinition(reportScreens.find(item=>item.id===nextScreen)!.report);setParams(paramsForReportScreen(nextScreen,next.id,{...filters,search:'',category:'',brand:'',product:'',party:'',user:'',account:'',status:'',sort:'date',direction:'desc'},next.columns));setShowBasis(false);setDetail(null);};",
    "const selectScreen=(nextScreen:ReportScreen)=>{const allowedScreen=nextScreen==='overview'?'overview':'library';const reportId=nextScreen==='overview'||nextScreen==='library'?'overview':reportKeyForScreen(nextScreen);const next=reportDefinition(reportId);setParams(paramsForReportScreen(allowedScreen,next.id,{...filters,search:'',category:'',brand:'',product:'',party:'',user:'',account:'',status:'',sort:'date',direction:'desc'},next.columns));setShowBasis(false);setDetail(null);};");

  // Keep the ORIGINAL Reports JSX and navigation; replace only its data model.
  next = replaceOnce(next,
    "import { useReportData } from '../reports/useReportData';",
    "import { emptyLiveReportData, useLiveReportResult } from '../integration/liveReportAdapter';");
  next = replaceOnce(next,
    'const [refresh,setRefresh]=useState(0),data=useReportData(refresh);',
    'const [refresh,setRefresh]=useState(0),data=emptyLiveReportData;');
  next = replaceOnce(next,
    'const result=useMemo(()=>runReport(definition.id,data,filters,assumptions),[definition,data,filters,assumptions]);',
    'const {result,status:liveStatus,reason:liveReason,loading:liveLoading}=useLiveReportResult(definition.id,filters,refresh);');
  // Until source-complete history exists, comparison/charts must not calculate zeros
  // from synthetic browser data. Their ORIGINAL presentation components stay intact.
  next = replaceOnce(next,
    "const previous=filters.compare==='previous'&&",
    "const previous=data.sales.length>0&&filters.compare==='previous'&&");
  next = replaceOnce(next,
    "text('Demo data','ডেমো তথ্য')",
    "text('Real backend','মূল হিসাব')");
  next = replaceOnce(next,
    "text('Current in-browser records · not live accounting','বর্তমান ব্রাউজারের রেকর্ড · লাইভ হিসাব নয়')",
    "liveReason");
  next = replaceOnce(next,
    "toast(text('Preview records refreshed.','প্রিভিউ রেকর্ড আবার পড়া হয়েছে।'))",
    "toast(text('Real backend records requested.','মূল হিসাব আবার পড়া হচ্ছে।'))");
  next = replaceOnce(next,
    'reviewWorkspace?<BusinessReview data={data}/>:<>',
    "reviewWorkspace?(data.sales.length>0?<BusinessReview data={data}/>:<p role=\"status\" className=\"text-sm text-ink-500\">{text('Business Audit needs verified backend source coverage. No demo totals are shown.','অডিটের মূল তথ্য যাচাই হওয়া দরকার। ডেমো হিসাব দেখানো হচ্ছে না।')}</p>):<>");
  next = replaceOnce(next,
    "{screen!=='library'&&screen!=='sales-lab'&&<MagicReportsView key={screen+':'+storageKey} screen={screen} data={data} filters={filters} onFilters={update} onDetail={setDetail} onReport={selectReport} onScreen={selectScreen} scopeKey={storageKey}/>} ",
    "{screen!=='library'&&screen!=='sales-lab'&&(data.sales.length>0?<MagicReportsView key={screen+':'+storageKey} screen={screen} data={data} filters={filters} onFilters={update} onDetail={setDetail} onReport={selectReport} onScreen={selectScreen} scopeKey={storageKey}/>:<p role=\"status\" className=\"text-sm text-ink-500\">{text('Live charts are unavailable until verified detailed source history is connected.','যাচাই করা মূল তথ্য না আসা পর্যন্ত চার্ট দেখানো যাচ্ছে না।')}</p>)} ");
  next = replaceOnce(next,
    "{screen==='library'&&<ReportResults definition={definition}",
    "{screen==='library'&&liveStatus!=='ready'&&<p role=\"status\" data-report-live-source-status=\"\" className=\"text-xs text-ink-500\">{liveLoading?text('Loading real records…','মূল তথ্য আসছে…'):liveReason}</p>}\n      {screen==='library'&&<ReportResults definition={definition}");
  // Never export or print a partial/incomplete/unavailable accounting period.
  const printGuard='disabled={!!definition.unavailable}';
  if(next.split(printGuard).length!==3)throw new Error('Reports print/export button anchors changed');
  next=next.replaceAll(printGuard,"disabled={!!definition.unavailable||liveStatus!=='ready'}");
  return next;
}
