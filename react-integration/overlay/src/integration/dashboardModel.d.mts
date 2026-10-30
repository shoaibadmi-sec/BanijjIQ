export interface ReportMetricInput {key:string;status:string;valueMinor:number|null}
export interface StockInput {status:string;currentStock:number;minimumStock:number}
export interface ReportRowInput {sourceId:string;sourceModule:string;date:string;label:string;amountMinor:number|null;status:string}
export function loadDashboardMetrics(metrics:ReportMetricInput[],products:StockInput[]|null):Record<string,{amount:number|null;note:string}>;
export function visibleSales(rows:ReportRowInput[]):Array<{id:string;customer:string;date:string;amount:number}>;
export function visibleDues(rows:ReportRowInput[]):Array<{id:string;name:string;amount:number}>;
export function recentSalesFrom(today:string):string;