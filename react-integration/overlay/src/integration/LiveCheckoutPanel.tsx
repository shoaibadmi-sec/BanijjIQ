import type { Ref } from 'react';
import { AlertTriangle, ChevronDown, Trash2, UserRound } from 'lucide-react';
import { AmountInWordsDisplay } from '../components/AmountInWordsDisplay';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import type { PosBankAccount, PosBootstrap, PosCustomer, PosSalePayload } from './banijjApi';

/**
 * Source-faithful layout adaptation of the pinned HisabIQ CheckoutPanel.tsx.
 * Keep the genuine Worker/D1 POS model rather than importing the original
 * CustomerPicker/usePosCart, which are backed by demonstration stores.
 *
 * One verified tender: cash, bank, mobile, or full-balance Store Credit.
 * Split tender and cash change remain unsupported.
 */
type PaymentMethod = PosSalePayload['paymentMethod'];
type DiscountMode = 'amount' | 'percent';

type Props = {
  customers: PosBootstrap['customers'];
  selectedCustomer?: PosCustomer;
  accounts: PosBankAccount[];
  customerName: string;
  customerPhone: string;
  fatherName: string;
  address: string;
  detailsOpen: boolean;
  onDetailsOpen: (open: boolean) => void;
  onCustomerName: (value: string) => void;
  onCustomerPhone: (value: string) => void;
  onFatherName: (value: string) => void;
  onAddress: (value: string) => void;
  onSelectCustomer: (value: string, field: 'name' | 'phone') => void;
  subtotal: number;
  discount: string;
  discountMode: DiscountMode;
  discountAmount: number;
  onDiscount: (value: string) => void;
  onDiscountMode: (mode: DiscountMode) => void;
  total: number;
  paid: string;
  paidAmount: number;
  due: number;
  itemCount: number;
  paymentMethod: PaymentMethod;
  bankAccountId: string;
  matchingAccounts: PosBankAccount[];
  requiresAccount: boolean;
  onPaid: (value: string) => void;
  onPaymentMethod: (value: PaymentMethod) => void;
  onBankAccountId: (value: string) => void;
  paidRef: Ref<HTMLInputElement>;
  errors: string[];
  disabled: boolean;
  completed: boolean;
  onClear: () => void;
  onReview: () => void;
};

const taka = (value: number) => '৳' + Number(value || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 });
function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return <div className={'flex items-center justify-between gap-2 text-sm ' + (muted ? 'text-ink-500' : 'text-ink-700')}>
    <span>{label}</span><span className="text-right font-medium text-ink">{value}</span>
  </div>;
}

export function LiveCheckoutPanel(props: Props) {
  return <aside data-pos-checkout aria-label="Live checkout"
    className="flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-card">
    <div className="space-y-3 border-b border-border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">New sale</p>
          <p className="text-[11px] text-ink-500">Counter · বিক্রির টাকা নিন</p>
        </div>
        <button type="button" onClick={props.onClear} disabled={props.disabled}
          className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-ink-500 hover:bg-danger-bg hover:text-danger disabled:opacity-50">
          <Trash2 className="size-3.5" /> Clear · মুছুন
        </button>
      </div>

      <div className="space-y-2" data-pos-live-customer-picker>
        <div className="flex items-center gap-2 text-xs font-medium text-ink-700">
          <UserRound className="size-4 text-teal-600"/> Customer · ক্রেতা
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs text-ink-600">Customer name *
            <Input list="live-pos-customer-names" value={props.customerName}
              onChange={event => props.onCustomerName(event.target.value)}
              onBlur={() => props.onSelectCustomer(props.customerName, 'name')}
              aria-label="Customer name" placeholder="Name · নাম" className="mt-1 h-9" />
          </label>
          <label className="min-w-0 text-xs text-ink-600">Phone *
            <Input list="live-pos-customer-phones" inputMode="tel" value={props.customerPhone}
              onChange={event => props.onCustomerPhone(event.target.value)}
              onBlur={() => props.onSelectCustomer(props.customerPhone, 'phone')}
              aria-label="Customer phone" placeholder="Phone · ফোন" className="mt-1 h-9" />
          </label>
        </div>
        <datalist id="live-pos-customer-names">
          {props.customers.map(customer => <option key={customer.id} value={customer.name} />)}
        </datalist>
        <datalist id="live-pos-customer-phones">
          {props.customers.map(customer => <option key={customer.id} value={customer.phone} />)}
        </datalist>
      </div>
      {props.selectedCustomer && <div data-pos-previous-balance-inline
        className="flex justify-between gap-2 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
        <span>Previous due · আগের বাকি</span>
        <strong>{taka(props.selectedCustomer.currentDue)}</strong>
      </div>}
      {props.selectedCustomer && <div data-pos-store-credit-balance
        className="flex justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 text-xs text-ink-700">
        <span>Store Credit · জমা ক্রেডিট</span>
        <strong>{taka(props.selectedCustomer.storeCreditCents/100)}</strong>
      </div>}
      {props.selectedCustomer?.storeCreditBlocked && <p role="status"
        className="text-xs text-warning">Old credit needs reconciliation · পুরোনো ক্রেডিট যাচাই দরকার</p>}

      <section className="rounded-lg border border-border bg-ink-50/50 dark:bg-ink-100/5">
        <button type="button" data-testid="pos-invoice-details-toggle"
          aria-expanded={props.detailsOpen} aria-controls="live-pos-customer-details"
          onClick={() => props.onDetailsOpen(!props.detailsOpen)}
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500">
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-ink">Invoice customer · ক্রেতার তথ্য</span>
            {!props.detailsOpen && <span className="mt-0.5 block truncate text-[11px] text-ink-500">
              {props.fatherName || props.address ? [props.fatherName, props.address].filter(Boolean).join(' · ') : 'Guardian · Address (optional)'}
            </span>}
          </span>
          <ChevronDown aria-hidden="true"
            className={'size-4 shrink-0 text-ink-500 transition-transform ' + (props.detailsOpen ? 'rotate-180' : '')} />
        </button>
        <div id="live-pos-customer-details" hidden={!props.detailsOpen}
          className="border-t border-border px-3 pb-3 pt-2.5">
          <div data-pos-customer-fields className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-600">Guardian · অভিভাবক
              <Input value={props.fatherName} onChange={event => props.onFatherName(event.target.value)}
                className="mt-1 h-9" />
            </label>
            <label className="text-xs text-ink-600">Address · ঠিকানা
              <Input value={props.address} onChange={event => props.onAddress(event.target.value)}
                className="mt-1 h-9" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">Optional invoice details · ঐচ্ছিক</p>
        </div>
      </section>
    </div>

    <div className="space-y-2 p-3.5">
      <Row label={'Subtotal · ' + props.itemCount + ' items'} value={taka(props.subtotal)} />
      <div className="flex items-center justify-between gap-2 text-sm text-ink-700">
        <span>Discount · ছাড়</span>
        <div className="flex items-center gap-1">
          <div className="flex h-9 shrink-0 rounded-md bg-ink-50 p-0.5" role="radiogroup" aria-label="Discount mode">
            {(['amount', 'percent'] as DiscountMode[]).map(mode =>
              <button type="button" key={mode} role="radio" aria-checked={props.discountMode === mode}
                onClick={() => { props.onDiscountMode(mode); props.onDiscount(''); }}
                className={'w-8 rounded text-xs font-medium ' +
                  (props.discountMode === mode ? 'bg-card text-ink shadow-card' : 'text-ink-500')}>
                {mode === 'amount' ? '৳' : '%'}
              </button>)}
          </div>
          <Input type="number" min="0" max={props.discountMode === 'percent' ? '100' : undefined}
            step="0.01" aria-label="Discount" value={props.discount}
            onChange={event => props.onDiscount(event.target.value)}
            className="h-9 w-24 text-right" />
        </div>
      </div>
      {props.discountAmount > 0 && <Row muted label="Discount applied · ছাড়" value={'−' + taka(props.discountAmount)} />}
    </div>

    <div data-pos-payable className="mx-3.5 rounded-xl border border-teal-200/80 bg-teal-50/50 px-3.5 py-3 text-ink">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-600">Total payable · সর্বমোট</span>
        <p className="ml-auto text-right text-[29px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {taka(props.total)}
        </p>
      </div>
      <AmountInWordsDisplay amount={props.total} variant="compact" />
    </div>

    <div className="space-y-3 p-3.5">
      <div>
        <p className="text-sm font-medium text-ink">Payments · পেমেন্ট</p>
        <p className="text-[10.5px] text-ink-500">One verified payment · একবারে টাকা গ্রহণ</p>
      </div>
      <div className="rounded-lg border border-border bg-ink-50/40 p-2">
        <div className={'grid gap-1.5 ' + (props.requiresAccount ? 'grid-cols-2' : 'grid-cols-1')}>
          <label className="text-xs text-ink-600">Payment method · মাধ্যম
            <select aria-label="Payment method" value={props.paymentMethod}
              onChange={event => props.onPaymentMethod(event.target.value as PaymentMethod)}
              className="mt-1 h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-sm text-ink">
              <option value="Cash">Cash · নগদ</option>
              <option value="Bank">Bank · ব্যাংক</option>
              <option value="Mobile Banking">Mobile Banking · মোবাইল</option>
              <option value="Store Credit">Store Credit · জমা ক্রেডিট</option>
            </select>
          </label>
          {props.requiresAccount && <label className="text-xs text-ink-600">Payment account *
            <select aria-label="Payment account" value={props.bankAccountId}
              onChange={event => props.onBankAccountId(event.target.value)}
              className="mt-1 h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-sm text-ink">
              <option value="">Select account</option>
              {props.matchingAccounts.map(account => <option key={account.id} value={account.id}>
                {account.name}
              </option>)}
            </select>
          </label>}
        </div>
        <div className="mt-2 flex items-end gap-1.5">
          <label className="min-w-0 flex-1 text-xs text-ink-600">
            {props.paymentMethod==='Store Credit'?'Credit to use · ক্রেডিট খরচ':'Amount received · কত টাকা পেলেন'}
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">৳</span>
              <Input ref={props.paidRef} type="number" min="0" step="0.01" inputMode="decimal"
                aria-label={props.paymentMethod==='Store Credit'?'Store Credit used':'Amount received'} value={props.paymentMethod==='Store Credit'?String(props.total):props.paid}
                disabled={props.disabled||props.paymentMethod==='Store Credit'}
                onChange={event => props.onPaid(event.target.value)}
                placeholder="0 — full due" className="h-9 w-full pl-7 text-right" />
            </div>
          </label>
          <button type="button" onClick={() => props.onPaid(String(props.total))}
            disabled={props.total <= 0 || props.disabled || props.paymentMethod==='Store Credit'}
            className="h-9 rounded-md border border-border bg-card px-2 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40">
            Exact · পুরো
          </button>
        </div>
      </div>
      {props.paymentMethod==='Store Credit' && <p data-credit-non-cash-notice
        className="rounded-md bg-teal-50 p-2 text-xs text-teal-800">
        Uses saved customer credit only. No cash is received · নগদ আসবে না।
        Whole payment only · সম্পূর্ণ টাকা ক্রেডিট থেকে।
      </p>}
      <div className="space-y-1.5 rounded-lg bg-ink-50 p-3">
        <Row label={props.paymentMethod==='Store Credit'?'Credit used · ক্রেডিট খরচ':'Paid · জমা'} value={taka(props.paidAmount)} />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-700">Due · বাকি</span>
          <strong className={props.due > 0 ? 'text-danger' : 'text-ink'}>{taka(props.due)}</strong>
        </div>
      </div>
      {props.errors.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-warning-bg p-2.5 text-xs text-warning"
        role="alert"><AlertTriangle className="size-4 shrink-0" />{props.errors[0]}</p>}
      <Button data-erp-workflow-action="complete" className="h-12 w-full text-[15px] font-semibold"
        disabled={props.disabled || props.errors.length > 0 || props.completed}
        onClick={props.onReview}>Review and post real sale</Button>
      <p className="text-center text-[11px] text-ink-500">
        Saves inventory, cash and customer ledger through BanijjIQ backend.
      </p>
    </div>
  </aside>;
}
