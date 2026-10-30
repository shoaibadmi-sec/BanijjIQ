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
  return next;
}
