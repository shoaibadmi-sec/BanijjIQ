<script setup lang="ts">
import { ref } from 'vue';
import type { SupplierPurchaseOrder } from '../types';
import {
  downloadSupplierPurchaseOrderImage,
  printSupplierPurchaseOrder,
  saveSupplierPurchaseOrderPdf,
  shareSupplierPurchaseOrderImage
} from '../utils/supplierPurchaseOrderOutput';

const props = defineProps<{ order: SupplierPurchaseOrder }>();
const emit = defineEmits<{
  close: [];
  convert: [orderId: string];
}>();

const outputBusy = ref(false);
const outputMessage = ref('');
const outputError = ref('');

function runPrint(): void {
  outputError.value = '';
  try { printSupplierPurchaseOrder(props.order); }
  catch (err) { outputError.value = err instanceof Error ? err.message : 'Could not print order.'; }
}

function runPdf(): void {
  outputError.value = '';
  try {
    saveSupplierPurchaseOrderPdf(props.order);
    outputMessage.value = 'Use the print dialog and choose “Save as PDF”.';
  } catch (err) { outputError.value = err instanceof Error ? err.message : 'Could not open PDF output.'; }
}

async function runImage(): Promise<void> {
  outputBusy.value = true;
  outputError.value = '';
  try {
    await downloadSupplierPurchaseOrderImage(props.order);
    outputMessage.value = 'PNG image created.';
  } catch (err) { outputError.value = err instanceof Error ? err.message : 'Could not create image.'; }
  finally { outputBusy.value = false; }
}

async function runShare(): Promise<void> {
  outputBusy.value = true;
  outputError.value = '';
  try {
    const result = await shareSupplierPurchaseOrderImage(props.order);
    outputMessage.value = result === 'shared' ? 'Share sheet opened.' : 'Sharing is not supported here, so the PNG was downloaded.';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    outputError.value = err instanceof Error ? err.message : 'Could not share image.';
  } finally { outputBusy.value = false; }
}
</script>

<template>
  <div class="modal-overlay supplier-po-overlay" @click.self="emit('close')">
    <div class="modal supplier-po-modal">
      <div class="modal-header">
        <div>
          <h3>Supplier Purchase Order</h3>
          <span class="bn-hint">সাপ্লায়ারকে দেওয়ার অর্ডার কপি</span>
        </div>
        <button class="modal-close" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="supplier-po-paper">
          <div class="supplier-po-head">
            <img v-if="order.shop.logo" :src="order.shop.logo" alt="Shop logo" class="supplier-po-logo" />
            <div class="supplier-po-shop">{{ order.shop.shopName || 'SherERP' }}</div>
            <div v-if="order.shop.shopNameBangla" class="supplier-po-shop-bn">{{ order.shop.shopNameBangla }}</div>
            <div v-if="order.shop.description" class="supplier-po-muted">{{ order.shop.description }}</div>
            <div v-if="order.shop.address" class="supplier-po-muted">{{ order.shop.address }}</div>
            <div v-if="order.shop.phone1 || order.shop.phone2" class="supplier-po-muted">
              {{ [order.shop.phone1, order.shop.phone2].filter(Boolean).join(' / ') }}
            </div>
            <div v-if="order.shop.email" class="supplier-po-muted">{{ order.shop.email }}</div>
          </div>

          <div class="supplier-po-title">PURCHASE ORDER</div>
          <div class="supplier-po-meta">
            <div><strong>Order No:</strong> {{ order.orderNo }}</div>
            <div><strong>Date:</strong> {{ order.orderDate }}</div>
          </div>
          <div class="supplier-po-supplier">
            <span>Supplier</span><br />
            <strong>{{ order.supplierName }}</strong>
          </div>

          <div class="table-scroll">
            <table class="supplier-po-table">
              <thead><tr><th>Product Name</th><th class="num">Quantity</th></tr></thead>
              <tbody>
                <tr v-for="item in order.items" :key="item.productId">
                  <td>{{ item.productName }}</td>
                  <td class="num mono">{{ Math.round(Number(item.quantity || 0)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="bn-hint" style="margin-top:10px;text-align:center;">Supplier copy contains only shop header, supplier, order number/date, product name and quantity.</div>
        <div v-if="outputMessage" class="success-banner" style="margin-top:12px;">{{ outputMessage }}</div>
        <div v-if="outputError" class="field-error" style="margin-top:12px;">{{ outputError }}</div>
      </div>

      <div class="modal-footer supplier-po-actions">
        <button class="btn" @click="runPrint">Print</button>
        <button class="btn" @click="runPdf">PDF</button>
        <button class="btn" :disabled="outputBusy" @click="runImage">PNG Image</button>
        <button class="btn" :disabled="outputBusy" @click="runShare">Share</button>
        <div style="flex:1;"></div>
        <button v-if="order.status === 'Open'" class="btn btn-primary" @click="emit('convert', order.orderId)">Convert to Purchase</button>
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.supplier-po-modal{width:min(920px,96vw);max-height:94vh}.supplier-po-paper{background:#fff;color:#111;border:1px solid #d7d7d7;border-radius:12px;padding:28px;max-width:760px;margin:0 auto}.supplier-po-head{text-align:center;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:18px}.supplier-po-logo{max-height:64px;max-width:130px;object-fit:contain;margin-bottom:6px}.supplier-po-shop{font-size:24px;font-weight:800}.supplier-po-shop-bn{font-size:18px;font-weight:700;margin-top:2px}.supplier-po-muted{font-size:12px;color:#333;margin-top:3px}.supplier-po-title{text-align:center;font-size:18px;font-weight:800;letter-spacing:.08em;margin:16px 0}.supplier-po-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:13px;margin-bottom:16px}.supplier-po-supplier{border:1px solid #bbb;padding:10px 12px;margin-bottom:16px;font-size:14px}.supplier-po-supplier strong{font-size:15px}.supplier-po-table{width:100%;border-collapse:collapse}.supplier-po-table th,.supplier-po-table td{border:1px solid #888;padding:8px}.supplier-po-table th{background:#f3f3f3}.supplier-po-actions{gap:8px;flex-wrap:wrap}@media(max-width:640px){.supplier-po-paper{padding:16px}.supplier-po-meta{grid-template-columns:1fr}.supplier-po-actions .btn{flex:1 1 auto}}
</style>
