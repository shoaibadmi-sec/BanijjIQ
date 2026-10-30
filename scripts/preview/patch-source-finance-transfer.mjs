/** Source-faithful bank transfer connection: changes behavior only, not the upstream UI layout. */
export function patchSourceFinanceTransfer(source){
 const edit=(before,after)=>{
  const n=source.split(before).length-1;
  if(n!==1)throw Error('Finance transfer upstream contract changed: '+before.slice(0,80)+' count='+n);
  source=source.replace(before,after);
 };
 edit("import { usePhase6Finance } from '../integration/usePhase6Finance';",
  "import { usePhase6Finance } from '../integration/usePhase6Finance';\nimport {postBankTransfer,BackendRequestError} from '../integration/banijjApi';\nimport {toVerifiedTransferPost} from '../integration/phase6FinancePosting';");
 edit("sessionOpen,permitted,loading,error}=usePhase6Finance();",
  "sessionOpen,permitted,loading,error,canTransfer,refreshFinance}=usePhase6Finance();");
 edit("const phase6Money=(value:number)=>Number.isFinite(value)?taka(value):'—';",
  "const phase6Money=(value:number)=>Number.isFinite(value)?'৳'+value.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:4}):'—';");
 edit("disabled={phase6ReadOnly && label==='Transfer'}",
  "disabled={label==='Transfer'&&!canTransfer}");
 const open="disabled={phase6ReadOnly} onClick={() => openTransfer()}";
 if(source.split(open).length!==3)throw Error('Finance transfer triggers changed');
 source=source.split(open).join("disabled={!canTransfer} onClick={() => openTransfer()}");
 const transferStart=source.indexOf('function TransferDialog(');
 const transferEnd=source.indexOf('export function Finance(',transferStart);
 if(transferStart<0||transferEnd<0)throw Error('Finance transfer component changed');
 let part=source.slice(transferStart,transferEnd);
 const transferEdit=(a,b)=>{
  if(part.split(a).length!==2)throw Error('Finance TransferDialog changed: '+a.slice(0,80));
  part=part.replace(a,b);
 };
 transferEdit('onSave: (transfer: AccountTransfer) => void;',
  'onSave: (transfer:AccountTransfer,clientRequestId:string)=>Promise<boolean>;');
 transferEdit('  const [reviewTransfer, setReviewTransfer] = useState(false);',
  "  const [reviewTransfer, setReviewTransfer] = useState(false);\n  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);\n  const requestId=React.useRef(crypto.randomUUID());");
 transferEdit('  const save = () => {',"  const save = async () => {\n    if(pending)return;");
 transferEdit("    onSave({\n      id: nextId,\n      date: '06 Oct 2026',",
  "    setPending(true);\n    try{\n    const accepted=await onSave({\n      id: nextId,\n      date: businessToday(),");
 transferEdit("      status: 'Completed'\n    });\n    onOpenChange(false);",
  "      status: 'Completed'\n    },requestId.current);\n    if(accepted){requestId.current=crypto.randomUUID();setUncertain(false);onOpenChange(false);}\n    }catch(e){\n      const unknown=e instanceof BackendRequestError&&(e.status===null||e.status>=500);\n      setUncertain(unknown);\n      toast.error(unknown?'Transfer status unknown. Retry the same request.':e instanceof Error?e.message:'Unable to transfer.');\n    }finally{setPending(false);}");
 transferEdit('<FormSelect className="mt-1.5" value={from}',
  '<FormSelect disabled={pending||uncertain} className="mt-1.5" value={from}');
 transferEdit('<FormSelect className="mt-1.5" value={to}',
  '<FormSelect disabled={pending||uncertain} className="mt-1.5" value={to}');
 transferEdit('<Input value={amount} onChange=',
  '<Input disabled={pending||uncertain} value={amount} onChange=');
 transferEdit('<Input className="mt-1.5" value={reference}',
  '<Input disabled={pending||uncertain} className="mt-1.5" value={reference}');
 transferEdit('<Button variant="outline" onClick={() => onOpenChange(false)}>',
  '<Button variant="outline" disabled={pending||uncertain} onClick={() => onOpenChange(false)}>');
 transferEdit('<Button onClick={save}>','<Button disabled={pending} onClick={save}>');
 source=source.slice(0,transferStart)+part+source.slice(transferEnd);
 const dialogStart=source.indexOf('      <TransferDialog');
 const dialogEnd=source.indexOf('      <ChequeDialog',dialogStart);
 if(dialogStart<0||dialogEnd<0)throw Error('Finance transfer dialog invocation changed');
 let dialog=source.slice(dialogStart,dialogEnd);
 const saveStart=dialog.indexOf('        onSave={(transfer) => {');
 const saveEnd=dialog.indexOf('        }}',saveStart);
 if(saveStart<0||saveEnd<0)throw Error('Finance preview transfer save callback changed');
 dialog=dialog.slice(0,saveStart)+
  "        onSave={async (transfer,clientRequestId) => {\n"+
  "          if(!canTransfer)throw new Error('Not authorized to post bank transfers.');\n"+
  "          const payload=toVerifiedTransferPost(transfer,clientRequestId);\n"+
  "          const response=await postBankTransfer(payload);\n"+
  "          refreshFinance();\n"+
  "          toast.success('Bank transfer posted', {description:response.id});\n"+
  "          return true;\n"+
  "        }}"+dialog.slice(saveEnd+10);
 source=source.slice(0,dialogStart)+dialog+source.slice(dialogEnd);
 return source;
}
